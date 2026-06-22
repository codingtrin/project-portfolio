import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('has the correct page title', async ({ page }) => {
  await expect(page).toHaveTitle('Leo Nicholas Zotomayor | Portfolio');
});

test('hero has exactly one CTA, linking to the resume', async ({ page }) => {
  const cta = page.locator('.cta');
  await expect(cta).toHaveCount(1);
  await expect(cta).toHaveAttribute('href', 'assets/leo-zotomayor-resume.pdf');
  await expect(cta).toHaveAttribute('target', '_blank');
});

test('Arca attribution is the last element and links to arca.ph', async ({ page }) => {
  const arca = page.locator('.arca-attribution');
  await expect(arca).toBeVisible();
  await expect(arca).toHaveAttribute('href', 'https://arca.ph');
  await expect(arca).toContainText('Made for Arca.ph');

  // It must be the final element with rendered content on the page.
  const isLast = await arca.evaluate((el) => {
    const blocks = Array.from(document.querySelectorAll('body *'))
      .filter((n) => n.getClientRects().length > 0 && !n.querySelector('*'));
    return blocks[blocks.length - 1].closest('.arca-attribution') === el;
  });
  expect(isLast).toBe(true);
});

test('no contact details or social links anywhere', async ({ page }) => {
  const html = await page.content();
  expect(html).not.toMatch(/mailto:|tel:/i);
  expect(html).not.toMatch(/linkedin|x\.com|instagram|facebook|bsky|mastodon|threads/i);
  // No real <a> pointing at a social/email destination
  const badLinks = await page.locator('a').evaluateAll((as) =>
    as.map((a) => a.getAttribute('href') || '')
      .filter((h) => /mailto:|tel:|linkedin|twitter|x\.com|instagram|facebook|github\.com/i.test(h)),
  );
  expect(badLinks).toEqual([]);
});

test('project grid shows all three live-site links', async ({ page }) => {
  const links = page.locator('.view-live');
  await expect(links).toHaveCount(3);
  await expect(page.locator('a[href="https://leonistic.vercel.app/"]')).toBeVisible();
  await expect(page.locator('a[href="https://employmeant.vercel.app/"]')).toBeVisible();
  await expect(page.locator('a[href="https://silogan-ni-soma.vercel.app/"]')).toBeVisible();
});

test('no horizontal scroll at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows).toBe(false);
});
