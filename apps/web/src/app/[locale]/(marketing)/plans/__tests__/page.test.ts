import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../../../../messages/en.json';
import zh from '../../../../../../messages/zh.json';

const pagePath = join(
  process.cwd(),
  'src/app/[locale]/(marketing)/plans/page.tsx'
);

describe('public plans page', () => {
  it('uses the localized metadata and public-page routing pattern', () => {
    const source = readFileSync(pagePath, 'utf8');

    expect(source).toContain("namespace: 'PublicSite.plans.metadata'");
    expect(source).toContain("getTranslations('PublicSite.plans')");
    expect(source).toContain('setRequestLocale(locale)');
    expect(source).toContain('getPublicSiteBaseUrl()');
    expect(source).toContain('alternates:');
    expect(source).toContain('const canonical =');
  });

  it.each([
    ['zh', zh],
    ['en', en],
  ])('provides plan labels and notes in %s', (_, messages) => {
    const plans = messages.PublicSite.plans;

    expect(plans.metadata.title).toBeTruthy();
    expect(plans.metadata.description).toBeTruthy();
    expect(plans.eyebrow).toBeTruthy();
    expect(plans.title).toBeTruthy();
    expect(plans.intro).toBeTruthy();
    expect(plans.betaNote).toBeTruthy();
    expect(Object.keys(plans.planLabels)).toHaveLength(6);
    expect(Object.keys(plans.planNotes)).toHaveLength(6);
    expect(plans.columns.plan).toBeTruthy();
    expect(plans.columns.uploadLimit).toBeTruthy();
    expect(plans.columns.imageGenerate).toBeTruthy();
    expect(plans.columns.unavailable).toBeTruthy();
    expect(plans.columns.notes).toBeTruthy();
  });
});
