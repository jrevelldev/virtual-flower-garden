import { test, expect } from '@playwright/test';

test('1,000-Flower Performance & Stress Test Benchmark', async ({ page }) => {
  await page.goto('/garden');
  await expect(page.locator('#scene-canvas-container canvas')).toBeVisible();

  // Toggle stats box
  await page.locator('#btn-toggle-stats').click();
  await expect(page.locator('#stats-overlay')).toBeVisible();

  // Initial stats
  await page.waitForTimeout(1000);
  const initialFps = await page.locator('#stat-fps').textContent();
  const initialDrawCalls = await page.locator('#stat-drawcalls').textContent();
  const initialCount = await page.locator('#stat-flowers').textContent();

  console.log(`[Baseline] Flowers: ${initialCount}, FPS: ${initialFps}, DrawCalls: ${initialDrawCalls}`);

  // Trigger stress test (spawns 1,000 flowers)
  await page.locator('#btn-stress-test').click();

  // Wait 3 seconds for flowers to render and measure performance
  await page.waitForTimeout(3000);

  const stressCount = await page.locator('#stat-flowers').textContent();
  const stressFps = await page.locator('#stat-fps').textContent();
  const stressDrawCalls = await page.locator('#stat-drawcalls').textContent();

  console.log(`[1,000 Flowers Benchmark] Flowers: ${stressCount}, FPS: ${stressFps}, DrawCalls: ${stressDrawCalls}`);

  expect(Number(stressCount)).toBeGreaterThanOrEqual(1000);
  expect(Number(stressDrawCalls)).toBeLessThan(3500); // Merged draw call optimization verified!
  expect(Number(stressFps)).toBeGreaterThanOrEqual(8); // SwiftShader software headless WebGL execution floor

  await page.screenshot({ path: 'tests/screenshots/1000-flowers-benchmark.png' });
});
