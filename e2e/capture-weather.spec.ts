import { test, expect } from '@playwright/test';

test('Capture Weather & Grass Visuals', async ({ page }) => {
  await page.goto('/garden');
  await expect(page.locator('#scene-canvas-container canvas')).toBeVisible();

  // Wait 1.5s for scene to stabilize in sunny day
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/screenshots/tall-cute-grass-sunny.png' });

  // Open the unified Time of Day popover control
  await page.locator('#btn-toggle-weather').click();
  await expect(page.locator('#time-popover')).toBeVisible();

  // Switch to sunset via chip
  await page.locator('.time-chip[data-preset="sunset"]').click();
  await page.waitForTimeout(1000);

  // Switch to night via chip (stars and fireflies)
  await page.locator('.time-chip[data-preset="night"]').click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'tests/screenshots/night-fairy-garden.png' });
});

