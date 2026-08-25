import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION_LABEL } from '@utils-plane/utils';
import en from '../../../../../../messages/en.json';
import zh from '../../../../../../messages/zh.json';

const pagePath = join(
  process.cwd(),
  'src/app/[locale]/(marketing)/changelog/page.tsx'
);

describe('public changelog page', () => {
  it('uses the localized metadata and public-page routing pattern', () => {
    const source = readFileSync(pagePath, 'utf8');

    expect(source).toContain("namespace: 'PublicSite.changelog.metadata'");
    expect(source).toContain("getTranslations('PublicSite.changelog')");
    expect(source).toContain('setRequestLocale(locale)');
    expect(source).toContain('getPublicSiteBaseUrl()');
    expect(source).toContain('alternates:');
    expect(source).toContain('const canonical =');
  });

  it.each([
    ['zh', zh],
    ['en', en],
  ])('provides a curated latest release entry in %s', (_, messages) => {
    const changelog = messages.PublicSite.changelog;
    const entry = changelog.entries[0];

    expect(entry.version).toBe(APP_VERSION_LABEL);
    expect(entry.date).toBe('2026-08-25');
    expect(entry.groups).toHaveLength(3);
    expect(entry.groups.every(group => group.items.length > 0)).toBe(true);
  });
});
