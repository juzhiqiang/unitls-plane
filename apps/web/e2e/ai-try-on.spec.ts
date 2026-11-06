import { expect, test } from '@playwright/test';

const PERSON_UUID = '00000000-0000-4000-8000-000000000001';
const GARMENT_UUID = '00000000-0000-4000-8000-000000000002';
const POSE_UUID = '00000000-0000-4000-8000-000000000003';

test.describe('AI e-commerce try-on workbench', () => {
  test('loads catalogs on demand, keeps cached choices on refresh failure and removes revoked choices', async ({
    page,
  }) => {
    const requests: string[] = [];
    let personState: 'ok' | 'failed' | 'removed' = 'ok';
    await page.route('**/tasks/ai-try-on/references**', async route => {
      const kind = new URL(route.request().url()).searchParams.get('kind')!;
      requests.push(kind);
      if (kind === 'person' && personState === 'failed') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Unavailable' }),
        });
        return;
      }
      const id =
        kind === 'person'
          ? PERSON_UUID
          : kind === 'garment'
            ? GARMENT_UUID
            : POSE_UUID;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          kind === 'person' && personState === 'removed'
            ? []
            : [
                {
                  id,
                  kind,
                  title: kind,
                  tags: [],
                  thumbnailUrl:
                    'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=',
                  sourceUrl: 'https://source.example.test',
                  licenseName: 'CC0',
                  attribution: 'Studio',
                },
              ]
        ),
      });
    });
    await page.goto('/en/image/try-on');
    await expect(
      page.getByRole('button', { name: 'Load inspiration presets' })
    ).toBeVisible();
    expect(requests).toEqual([]);
    await page.getByTestId('person-source-library').click();
    await page.getByTestId('open-library-modal-person').click();
    await page.getByTestId(`library-item-person-${PERSON_UUID}`).click();
    expect(requests).toEqual(['person']);
    await page.getByTestId('mode-inspiration').click();
    await page.getByTestId('open-library-modal-garment').click();
    await page.getByTestId(`library-item-garment-${GARMENT_UUID}`).click();
    await page.getByTestId('open-library-modal-style').click();
    await page.getByTestId('close-library-modal-style').click();
    expect(requests).toEqual(['person', 'garment']);
    personState = 'failed';
    await page
      .locator('#try-on-section-person')
      .getByRole('button', { name: 'Refresh library' })
      .click();
    await expect(
      page.locator('#try-on-section-person').getByRole('alert')
    ).toContainText('Could not refresh');
    await expect(page.getByTestId('selected-summary-person')).toBeVisible();
    await expect(page.getByTestId('try-on-submit')).toBeEnabled();
    personState = 'removed';
    await page
      .locator('#try-on-section-person')
      .getByRole('button', { name: 'Retry loading library' })
      .click();
    await expect(page.getByTestId('library-empty-person')).toBeVisible();
    await expect(
      page.getByText('Some selected assets are no longer available.', {
        exact: false,
      })
    ).toBeVisible();
    await expect(page.getByTestId('try-on-submit')).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: 'artifacts/screenshots/gallery-data-updates-mobile.png',
      fullPage: true,
    });
  });

  test('renders try-on workbench in zh and en with canonical metadata and mode switcher', async ({
    page,
  }) => {
    await page.route('**/tasks/ai-try-on/references**', async route => {
      const url = new URL(route.request().url());
      const kind = url.searchParams.get('kind');
      if (kind === 'person') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: PERSON_UUID,
              kind: 'person',
              title: 'Studio model A',
              tags: ['studio'],
              thumbnailUrl:
                'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=',
              sourceUrl: 'https://source.example.test/person-a',
              licenseName: 'CC0 1.0',
              attribution: 'Utils Plane Studio',
            },
          ]),
        });
        return;
      }
      if (kind === 'garment') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: GARMENT_UUID,
              kind: 'garment',
              title: 'Tailored wool coat',
              tags: ['coat'],
              thumbnailUrl:
                'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=',
              sourceUrl: 'https://source.example.test/garment-1',
              licenseName: 'CC BY 4.0',
              attribution: 'Atelier Archive',
            },
          ]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: POSE_UUID,
            kind: 'pose',
            title: 'Lookbook pose',
            tags: ['lookbook'],
            thumbnailUrl:
              'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=',
            sourceUrl: 'https://source.example.test/pose-1',
            licenseName: 'CC0 1.0',
            attribution: 'Utils Plane Studio',
          },
        ]),
      });
    });

    const zhResponse = await page.goto('/zh/image/try-on');
    expect(zhResponse?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'AI 电商试衣' })
    ).toBeVisible();
    await expect(page.getByTestId('mode-product')).toContainText(
      '真实商品试穿'
    );
    await expect(page.getByTestId('mode-inspiration')).toContainText(
      '穿搭灵感'
    );
    await expect(page.getByTestId('try-on-submit')).toBeDisabled();

    // Switch to inspiration mode and select library person + garment via modals
    await page.getByTestId('mode-inspiration').click();
    await page.getByTestId('person-source-library').click();
    await page.getByTestId('open-library-modal-person').click();
    await page.getByTestId(`library-item-person-${PERSON_UUID}`).click();
    await page.getByTestId('open-library-modal-garment').click();
    await page.getByTestId(`library-item-garment-${GARMENT_UUID}`).click();
    await expect(page.getByTestId('try-on-submit')).toBeEnabled();

    // Verify English route as well
    const enResponse = await page.goto('/en/image/try-on');
    expect(enResponse?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'AI e-commerce try-on' })
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/en\/image\/try-on$/
    );
  });
});
