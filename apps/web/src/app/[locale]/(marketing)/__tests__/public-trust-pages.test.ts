import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../../../messages/en.json';
import zh from '../../../../../messages/zh.json';

type PublicPage = {
  operator: string;
  sections: Array<{ id: string; items?: string[] }>;
};

type PublicSiteMessages = {
  privacy: PublicPage;
  terms: PublicPage;
  beta: PublicPage;
};

function publicSite(messages: unknown): PublicSiteMessages {
  return (messages as { PublicSite: PublicSiteMessages }).PublicSite;
}

function serverRetentionLabel(messages: unknown): string {
  return (
    messages as {
      ToolShell: { trust: { retention: { 'server-24h': string } } };
    }
  ).ToolShell.trust.retention['server-24h'];
}

function anonymousRetentionCopy(messages: unknown): string {
  const site = publicSite(messages);

  return [site.privacy, site.beta]
    .flatMap(
      page =>
        page.sections.find(section => section.id === 'retention')?.items ?? []
    )
    .join('\n');
}

function betaAnonymousRetentionCopy(messages: unknown): string {
  const retentionSection = publicSite(messages).beta.sections.find(
    section => section.id === 'retention'
  );

  return retentionSection?.items?.[0] ?? '';
}

describe('public trust pages', () => {
  it.each(['privacy', 'terms', 'beta'])(
    'wires the %s page to localized content, support, and canonical metadata',
    page => {
      const source = readFileSync(
        join(process.cwd(), `src/app/[locale]/(marketing)/${page}/page.tsx`),
        'utf8'
      );

      expect(source).toContain(`namespace: 'PublicSite.${page}.metadata'`);
      expect(source).toContain(`getTranslations('PublicSite.${page}')`);
      expect(source).toContain('setRequestLocale(locale)');
      expect(source).toContain('getSupportEmail()');
      expect(source).toContain('getPublicSiteBaseUrl()');
      expect(source).toContain('alternates:');
      expect(source).toContain('const canonical =');
      expect(source).toMatch(/alternates:\s*{\s*canonical,/);
    }
  );

  it.each([
    ['zh', zh],
    ['en', en],
  ])(
    'provides complete %s privacy, terms, and beta sections',
    (_, messages) => {
      const site = publicSite(messages);

      expect(site.privacy.sections.length).toBeGreaterThanOrEqual(6);
      expect(site.terms.sections.length).toBeGreaterThanOrEqual(5);
      expect(site.beta.sections.length).toBeGreaterThanOrEqual(4);
    }
  );

  it.each([
    ['zh', zh],
    ['en', en],
  ])('identifies the same operating team in %s', (_, messages) => {
    const site = publicSite(messages);

    for (const page of [site.privacy, site.terms, site.beta]) {
      expect(page.operator).toBe('Utils Plane 项目团队');
    }
  });

  it.each([
    ['zh', zh],
    ['en', en],
  ])('covers the required trust topics in %s', (_, messages) => {
    const site = publicSite(messages);

    expect(site.privacy.sections.map(section => section.id)).toEqual(
      expect.arrayContaining([
        'local-processing',
        'server-processing',
        'account-cookies',
        'retention',
        'account-rights',
        'telemetry-ai',
        'network-warning',
        'operator-support',
      ])
    );
    expect(site.terms.sections.map(section => section.id)).toEqual(
      expect.arrayContaining([
        'beta-service',
        'content-responsibility',
        'prohibited-use',
        'result-review',
        'availability',
        'termination',
        'operator-support',
      ])
    );
    expect(site.beta.sections.map(section => section.id)).toEqual(
      expect.arrayContaining([
        'local-tools',
        'signed-in-enhancements',
        'retention',
        'network-warning',
        'support',
      ])
    );
  });

  it('distinguishes 24-hour anonymous expiry from scheduled deletion', () => {
    expect(serverRetentionLabel(zh)).toBe('24 小时后过期');
    expect(anonymousRetentionCopy(zh)).toContain('24 小时后过期');
    expect(anonymousRetentionCopy(zh)).toContain('定时清理');
    expect(anonymousRetentionCopy(zh)).not.toContain('最长 24 小时');

    expect(serverRetentionLabel(en)).toBe('Expires after 24 hours');
    expect(anonymousRetentionCopy(en)).toContain('expire after 24 hours');
    expect(anonymousRetentionCopy(en)).toContain('scheduled cleanup');
    expect(anonymousRetentionCopy(en)).not.toContain('no more than 24 hours');
  });

  it('limits beta 24-hour expiry claims to anonymous input and output files', () => {
    expect(betaAnonymousRetentionCopy(zh)).toContain(
      '匿名服务端任务的输入与输出文件在 24 小时后过期'
    );
    expect(betaAnonymousRetentionCopy(zh)).not.toContain(
      '匿名服务端任务在 24 小时后'
    );

    expect(betaAnonymousRetentionCopy(en)).toContain(
      'Inputs and outputs for anonymous server tasks expire after 24 hours'
    );
    expect(betaAnonymousRetentionCopy(en)).not.toContain(
      'Anonymous server tasks expire after 24 hours'
    );
  });

  it('removes dead documentation and repository links from the footer', () => {
    const layout = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(marketing)/layout.tsx'),
      'utf8'
    );

    expect(layout).not.toContain('href="/docs"');
    expect(layout).not.toContain('href="/github"');
    for (const path of ['/privacy', '/terms', '/beta']) {
      expect(layout).toMatch(new RegExp(`<Link\\s+href="${path}"`));
    }
    expect(layout).toMatch(/<Link\s+href="\/changelog"/);
    expect(layout).toContain("t('footer.changelog')");
    expect(layout).toContain('mailto:${supportEmail}');
    expect(layout).toContain('getSupportEmail');
  });
});
