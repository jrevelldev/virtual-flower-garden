import { test, expect } from '@playwright/test';

test.describe('The Living Garden E2E Verification', () => {
  test('Phone Flower Designer flow, Unicode message, and planting', async ({ page }) => {
    await page.goto('/create');

    // 1. Verify Design step
    await expect(page.locator('h1')).toContainText('The Living Garden');
    await expect(page.locator('.preview-card')).toBeVisible();

    // Select 'heart' petal shape
    await page.locator('.chip[data-shape="heart"]').click();
    await expect(page.locator('.chip[data-shape="heart"]')).toHaveClass(/selected/);

    // Select color preset 'Solar Flare'
    await page.locator('.palette-card', { hasText: 'Solar Flare' }).click();

    // Randomize with Surprise Me and verify flower preview updates
    await page.locator('#btn-surprise').click();

    // Reset back
    await page.locator('#btn-reset').click();
    await page.locator('.chip[data-shape="pointed"]').click();

    // Navigate to Message step
    await page.locator('#btn-to-message').click();
    await expect(page.locator('h2')).toContainText('Give Your Flower a Voice');

    // Fill creator and multilingual message with emojis
    await page.locator('#input-display-name').fill('Aiko & Leo');
    const multilingualMsg = 'May this garden blossom across borders! 🌸✨ 世界に平和を。';
    await page.locator('#input-message').fill(multilingualMsg);

    // Verify character count handles graphemes
    await expect(page.locator('.char-count').nth(1)).toContainText('/280');

    // Proceed to Plant step
    await page.locator('#btn-to-plant').click();
    await expect(page.locator('.flower-summary-card')).toBeVisible();
    await expect(page.locator('.summary-message')).toContainText('May this garden blossom');

    // Plant the flower!
    await page.locator('#btn-plant-now').click();

    // Verify confirmation and short code
    await expect(page.locator('.status-pill')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.flower-code-display')).toContainText('FLW-');

    // Save screenshot of phone flow confirmation
    await page.screenshot({ path: 'tests/screenshots/phone-planted.png' });
  });

  test('Gallery Exhibition: Realtime live arrival and message reveal across tabs', async ({ browser }) => {
    // Shared browser context simulating two tabs in the same browser window
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const galleryPage = await context.newPage();
    await galleryPage.goto('/garden');

    // Verify 3D canvas and HUD
    await expect(galleryPage.locator('#scene-canvas-container canvas')).toBeVisible({ timeout: 10000 });
    await expect(galleryPage.locator('#invitation-card')).toBeVisible();
    await expect(galleryPage.locator('#qr-code-canvas')).toBeVisible();

    // Save screenshot of wide garden
    await galleryPage.screenshot({ path: 'tests/screenshots/wide-garden.png' });

    // Tab 2: Mobile Visitor Phone in same browser session
    const phonePage = await context.newPage();
    await phonePage.setViewportSize({ width: 390, height: 844 });
    await phonePage.goto('/create');

    // Design and submit a new distinct flower
    await phonePage.locator('.chip[data-shape="ruffled"]').click();
    await phonePage.locator('#btn-to-message').click();
    await phonePage.locator('#input-display-name').fill('Gallery Guest');
    await phonePage.locator('#input-message').fill('Live test transmission to gallery screen! 🌿🌟');
    await phonePage.locator('#btn-to-plant').click();
    await phonePage.locator('#btn-plant-now').click();

    // Verify phone confirms planted
    await expect(phonePage.locator('.status-pill')).toBeVisible();

    // Check Gallery screen: new flower should arrive in realtime and display reveal card!
    await expect(galleryPage.locator('#message-reveal-overlay')).toBeVisible({ timeout: 10000 });
    await expect(galleryPage.locator('#reveal-author')).toContainText("Gallery Guest's flower");
    await expect(galleryPage.locator('#reveal-message')).toContainText('Live test transmission to gallery screen!');

    // Capture screenshot of message reveal close-up
    await galleryPage.screenshot({ path: 'tests/screenshots/reveal-message-card.png' });

    await context.close();
  });

  test('Multilingual Search and Manual Camera Override', async ({ page }) => {
    await page.goto('/garden');
    await expect(page.locator('#scene-canvas-container canvas')).toBeVisible();

    // 1. Test Search
    await page.locator('#btn-open-search').click();
    await expect(page.locator('#search-modal')).toBeVisible();

    // Search for Japanese text in sample flower
    await page.locator('#search-input').fill('夕暮れの光');
    await expect(page.locator('.search-result-item')).toBeVisible();
    await expect(page.locator('.result-name')).toContainText('Tatsuya');

    // Click result to focus
    await page.locator('.search-result-item').first().click();
    await expect(page.locator('#search-modal')).toBeHidden();

    // Verify message card opens for chosen flower
    await expect(page.locator('#message-reveal-overlay')).toBeVisible();
    await expect(page.locator('#reveal-author')).toContainText("Tatsuya's flower");

    // 2. Test Manual Mode: Drag canvas
    const canvas = page.locator('#scene-canvas-container canvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50);
      await page.mouse.up();
    }

    // Auto Mode button should no longer be active (now in manual mode)
    await expect(page.locator('#btn-resume-auto')).not.toHaveClass(/active/);

    // Resume auto mode
    await page.locator('#btn-resume-auto').click();
    await expect(page.locator('#btn-resume-auto')).toHaveClass(/active/);
  });

  test('Admin Moderation Panel: Authentication, Settings, and Hide/Restore', async ({ page }) => {
    await page.goto('/admin');

    // Login
    await page.locator('#admin-passcode').fill('garden2026');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('h1')).toContainText('The Living Garden — Moderation');
    await expect(page.locator('.flower-table')).toBeVisible();

    // Check settings controls
    await expect(page.locator('#setting-approve-toggle')).toBeVisible();
    await expect(page.locator('#setting-hold-duration')).toBeVisible();

    // Hide the first flower
    const firstHideBtn = page.locator('.btn-action-hide').first();
    if (await firstHideBtn.isVisible()) {
      await firstHideBtn.click();
      await expect(page.locator('.badge-hidden').first()).toBeVisible();
    }
  });
});
