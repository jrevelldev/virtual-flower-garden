import { test, expect } from '@playwright/test';

test('Capture Non-Overlapping Flower Layout', async ({ page }) => {
  await page.goto('/garden');
  await expect(page.locator('#scene-canvas-container canvas')).toBeVisible();

  // Wait 2.0s for garden and sample flowers to load
  await page.waitForTimeout(2000);

  // Take full sunny garden view
  await page.screenshot({ path: 'tests/screenshots/wide-garden-nonoverlapping.png' });

  // Click Overview button to view from above
  await page.locator('#btn-overview').click();
  await page.waitForTimeout(2500);

  await page.screenshot({ path: 'tests/screenshots/overview-flower-spacing.png' });
});

