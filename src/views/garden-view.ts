import QRCode from 'qrcode';
import { PublicFlower, InstallationSettings, GardenWeather } from '../types/garden';
import { GardenScene } from '../garden/garden-scene';
import { dataService, getDefaultVisitorUrl } from '../services/data-service';
import { isRTL } from '../services/text-utils';

export class GardenView {
  private container: HTMLElement;
  private gardenScene: GardenScene | null = null;
  private settings: InstallationSettings | null = null;
  private activeMessageFlower: PublicFlower | null = null;
  private isSearchOpen = false;
  private searchQuery = '';
  private isStatsVisible = false;
  private currentMode = 'attract';
  private currentWeather: GardenWeather = 'auto';
  private queueLength = 0;
  private unsubscribeRealtime: (() => void) | null = null;
  private unsubscribeRemote: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.init();
  }

  private async init(): Promise<void> {
    this.settings = await dataService.getInstallationSettings();
    this.renderLayout();

    // Initialize 3D Scene
    const sceneContainer = this.container.querySelector('#scene-canvas-container') as HTMLElement;
    if (sceneContainer) {
      this.gardenScene = new GardenScene(sceneContainer, {
        onModeChange: (mode) => {
          this.currentMode = mode;
          this.updateHudControls();
        },
        onRevealStart: (flower) => {
          this.showFlowerMessageCard(flower);
        },
        onRevealEnd: () => {
          this.hideFlowerMessageCard();
        },
        onFlowerSelected: (flower) => {
          this.showFlowerMessageCard(flower);
        },
        onQueueUpdate: (len) => {
          this.queueLength = len;
          this.updateQueueBadge();
        },
        onStatsUpdate: (fps, drawCalls, count) => {
          this.updateStatsDisplay(fps, drawCalls, count);
        },
        onWeatherChange: (weather, activeState, hour) => {
          this.currentWeather = weather;
          this.updateWeatherButton(activeState, hour);
        },
      });

      if (this.settings.revealHoldSeconds) {
        this.gardenScene.cameraController.setRevealHoldSeconds(this.settings.revealHoldSeconds);
      }
      if (this.settings.catchUpLimit) {
        this.gardenScene.cameraController.setCatchUpLimit(this.settings.catchUpLimit);
      }
      if (this.settings.qualityPreset) {
        this.gardenScene.setQuality(this.settings.qualityPreset);
      }
    }

    // Populate initial flowers from data service
    const flowers = await dataService.getPublicFlowers();
    this.gardenScene?.syncFlowers(flowers);

    // Subscribe to new arrivals and moderation removals
    this.unsubscribeRealtime = dataService.subscribeToFlowers(
      (newFlower) => {
        // Enqueue reveal for newly arrived flower!
        this.gardenScene?.addFlower(newFlower, true);
      },
      (removedId) => {
        this.gardenScene?.removeFlower(removedId);
        if (this.activeMessageFlower?.id === removedId) {
          this.hideFlowerMessageCard();
        }
      }
    );

    // Generate QR Code
    this.renderQrCode();
    this.bindEvents();
  }

  private getVisitorTargetUrl(): string {
    const raw = this.settings?.visitorUrl;
    if (
      raw &&
      raw.startsWith('http') &&
      !raw.endsWith('.github.io/create') &&
      !raw.endsWith('.github.io/create/') &&
      (!window.location.pathname.includes('/virtual-flower-garden') || raw.includes('/virtual-flower-garden'))
    ) {
      return raw;
    }
    return getDefaultVisitorUrl();
  }

  private renderLayout(): void {
    const isLocalMode = !dataService.isSupabaseConnected;
    const targetUrl = this.getVisitorTargetUrl();

    this.container.innerHTML = `
      <div class="garden-page">
        <!-- 3D WebGL Canvas Holder -->
        <div id="scene-canvas-container" class="scene-container"></div>

        <!-- Discreet Top Status / QR Invitation Card -->
        <aside class="invitation-card" id="invitation-card" aria-label="Join the garden">
          <div class="qr-canvas-holder">
            <canvas id="qr-code-canvas"></canvas>
          </div>
          <div class="invitation-text">
            <h3>The Living Garden</h3>
            <p>Scan to plant a flower</p>
            <a href="${targetUrl}" target="_blank" class="visitor-url-label" id="visitor-link">
              ${this.cleanUrl(targetUrl)}
            </a>
            ${isLocalMode ? '<div class="local-badge" title="Running in multi-tab local broadcast mode">Local Multi-Tab Demo</div>' : ''}
          </div>
        </aside>

        <!-- Active Reveal / Selected Flower Message Card -->
        <div class="message-reveal-overlay hidden" id="message-reveal-overlay">
          <article class="reveal-card" id="reveal-card">
            <header class="reveal-header">
              <span class="reveal-author" id="reveal-author">Maya's flower</span>
              <span class="reveal-code" id="reveal-code">FLW-7X9K</span>
            </header>
            <div class="reveal-body">
              <p class="reveal-message" id="reveal-message"></p>
            </div>
            <footer class="reveal-footer">
              <span class="reveal-timer-bar"><span class="timer-fill" id="reveal-timer-fill"></span></span>
              <button class="btn-dismiss-card" id="btn-dismiss-message" title="Close message">✕</button>
            </footer>
          </article>
        </div>

        <!-- Exhibition HUD Controls -->
        <nav class="garden-hud" aria-label="Installation controls">
          <div class="hud-left">
            <button class="hud-btn" id="btn-explore" title="Orbit and explore the garden freely">
              🧭 Explore
            </button>
            <button class="hud-btn" id="btn-overview" title="Fly to aerial garden vantage">
              🌄 Overview
            </button>
            <button class="hud-btn ${this.currentMode === 'attract' ? 'active' : ''}" id="btn-resume-auto" title="Resume gentle automatic camera tour">
              ▶ Auto Mode
            </button>
            <button class="hud-btn" id="btn-open-search" title="Search flowers by message, creator, or code">
              🔍 Search
            </button>
            <div class="time-control-wrapper" id="time-control-wrapper">
              <button class="hud-btn" id="btn-toggle-weather" title="Adjust time of day and atmosphere">
                ☀️ 12:00
              </button>
              <!-- Single Unified Time of Day Popover Control -->
              <div class="time-popover hidden" id="time-popover">
                <div class="time-popover-header">
                  <span class="time-label-title">Time of Day</span>
                  <span class="time-digital-display" id="time-digital-display">12:00</span>
                </div>
                
                <!-- 24-Hour Interactive Scrubber Slider -->
                <div class="time-slider-container">
                  <input type="range" id="input-time-scrubber" min="0" max="24" step="0.25" value="12" />
                  <div class="time-slider-ticks">
                    <span>00:00</span>
                    <span>06:00</span>
                    <span>12:00</span>
                    <span>18:00</span>
                    <span>24:00</span>
                  </div>
                </div>

                <!-- Quick 1-Click Atmosphere Presets -->
                <div class="time-presets-grid">
                  <button class="time-chip" data-preset="dawn">🌅 Dawn</button>
                  <button class="time-chip active" data-preset="sunny">☀️ Noon</button>
                  <button class="time-chip" data-preset="sunset">🌇 Sunset</button>
                  <button class="time-chip" data-preset="night">🌙 Night</button>
                  <button class="time-chip" data-preset="cloudy">⛅ Cloudy</button>
                  <button class="time-chip" data-preset="auto">⏱️ Auto</button>
                </div>
              </div>
            </div>
            <button class="hud-btn" id="btn-toggle-filament" title="Toggle luminous digital sculpture mode (Reference 2)">
              ✨ Filament
            </button>
          </div>

          <div class="hud-right">
            <div class="queue-indicator ${this.queueLength > 0 ? 'has-items' : ''}" id="queue-indicator" title="Pending reveal queue">
              Queue: <span id="queue-count">0</span>
              ${this.queueLength > 0 ? '<button id="btn-clear-queue" class="btn-clear-queue" title="Clear pending reveals">✕</button>' : ''}
            </div>
            <button class="hud-btn hud-icon-btn" id="btn-toggle-stats" title="Toggle diagnostic metrics">
              📊
            </button>
            <button class="hud-btn hud-icon-btn" id="btn-fullscreen" title="Toggle fullscreen">
              ⛶
            </button>
            <a href="/admin" class="hud-btn hud-icon-btn" title="Gallery Administration">
              ⚙️
            </a>
          </div>
        </nav>

        <!-- Search Modal Dialog -->
        <div class="search-modal-backdrop hidden" id="search-modal">
          <div class="search-modal-content">
            <div class="search-input-wrapper">
              <span class="search-icon">🔍</span>
              <input
                type="text"
                id="search-input"
                placeholder="Search by code (e.g. FLW-), creator, or text in any language..."
                autocomplete="off"
              />
              <button class="btn-close-search" id="btn-close-search">✕</button>
            </div>
            <div class="search-results-list" id="search-results">
              <div class="search-hint">Type to search across all flowers planted in the garden...</div>
            </div>
          </div>
        </div>

        <!-- Diagnostic Stats Box -->
        <div class="stats-overlay hidden" id="stats-overlay">
          <h4>Performance Metrics</h4>
          <div>FPS: <strong id="stat-fps">60</strong></div>
          <div>Draw Calls: <strong id="stat-drawcalls">0</strong></div>
          <div>Total Flowers: <strong id="stat-flowers">0</strong></div>
          <div>Camera Mode: <strong id="stat-mode">${this.currentMode}</strong></div>
          <div class="stress-test-row">
            <button id="btn-stress-test" class="btn-stress">Spawn 1,000 Flowers</button>
          </div>
        </div>
      </div>
    `;
  }

  private cleanUrl(url: string): string {
    return url.replace(/^https?:\/\//, '');
  }

  private async renderQrCode(): Promise<void> {
    const canvas = this.container.querySelector('#qr-code-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const targetUrl = this.getVisitorTargetUrl();
    try {
      await QRCode.toCanvas(canvas, targetUrl, {
        width: 110,
        margin: 1,
        color: {
          dark: '#1e293b',
          light: '#ffffff',
        },
      });
    } catch (err) {
      console.warn('QR Code generation failed:', err);
    }
  }

  private showFlowerMessageCard(flower: PublicFlower): void {
    this.activeMessageFlower = flower;
    const overlay = this.container.querySelector('#message-reveal-overlay');
    const authorEl = this.container.querySelector('#reveal-author');
    const codeEl = this.container.querySelector('#reveal-code');
    const msgEl = this.container.querySelector('#reveal-message') as HTMLElement;
    const timerFill = this.container.querySelector('#reveal-timer-fill') as HTMLElement;

    if (!overlay || !authorEl || !codeEl || !msgEl) return;

    const authorText = flower.displayName && flower.displayName.trim() && flower.displayName !== 'A visitor'
      ? `${flower.displayName}'s flower`
      : "A visitor's flower";

    authorEl.textContent = authorText;
    codeEl.textContent = flower.code;
    msgEl.textContent = flower.message;
    msgEl.dir = isRTL(flower.message) ? 'rtl' : 'auto';

    overlay.classList.remove('hidden');

    // Trigger timer fill animation
    if (timerFill) {
      timerFill.style.transition = 'none';
      timerFill.style.width = '100%';
      void timerFill.offsetWidth; // Force reflow
      const duration = this.settings?.revealHoldSeconds || 6;
      timerFill.style.transition = `width ${duration}s linear`;
      timerFill.style.width = '0%';
    }
  }

  private hideFlowerMessageCard(): void {
    this.activeMessageFlower = null;
    const overlay = this.container.querySelector('#message-reveal-overlay');
    overlay?.classList.add('hidden');
  }

  private updateHudControls(): void {
    const autoBtn = this.container.querySelector('#btn-resume-auto');
    if (autoBtn) {
      if (this.currentMode === 'attract') {
        autoBtn.classList.add('active');
      } else {
        autoBtn.classList.remove('active');
      }
    }
    const statMode = this.container.querySelector('#stat-mode');
    if (statMode) {
      statMode.textContent = this.currentMode;
    }
  }

  private formatTime(hour: number): string {
    const h = Math.floor(hour) % 24;
    const m = Math.floor((hour - Math.floor(hour)) * 60);
    const mStr = m < 10 ? `0${m}` : `${m}`;
    const hStr = h < 10 ? `0${h}` : `${h}`;
    return `${hStr}:${mStr}`;
  }

  private updateWeatherButton(activeState?: 'sunny' | 'cloudy' | 'night' | 'dawn' | 'sunset', hour?: number): void {
    const btn = this.container.querySelector('#btn-toggle-weather');
    const timeDisplay = this.container.querySelector('#time-digital-display');
    const scrubber = this.container.querySelector('#input-time-scrubber') as HTMLInputElement;
    if (!btn) return;

    const currentH = hour !== undefined ? hour : (this.gardenScene ? this.gardenScene.currentHour : 12.0);
    const timeStr = this.formatTime(currentH);

    if (timeDisplay) {
      timeDisplay.textContent = timeStr;
    }
    if (scrubber && document.activeElement !== scrubber) {
      scrubber.value = currentH.toString();
    }

    const state = activeState || (this.gardenScene ? this.gardenScene.activeWeatherState : 'sunny');

    let icon = '☀️';
    if (state === 'dawn') icon = '🌅';
    else if (state === 'sunset') icon = '🌇';
    else if (state === 'night') icon = '🌙';
    else if (state === 'cloudy') icon = '⛅';

    if (this.currentWeather === 'auto') {
      btn.innerHTML = `⏱️ ${timeStr} (${icon})`;
      btn.classList.add('active');
    } else {
      btn.innerHTML = `${icon} ${timeStr}`;
      btn.classList.remove('active');
    }

    // Update active preset chip in popover
    this.container.querySelectorAll('.time-chip').forEach((c) => {
      const chip = c as HTMLElement;
      if (chip.dataset.preset === this.currentWeather) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });
  }

  private updateQueueBadge(): void {
    const badge = this.container.querySelector('#queue-indicator');
    const count = this.container.querySelector('#queue-count');
    if (badge && count) {
      count.textContent = this.queueLength.toString();
      if (this.queueLength > 0) {
        badge.classList.add('has-items');
      } else {
        badge.classList.remove('has-items');
      }
    }
  }

  private updateStatsDisplay(fps: number, drawCalls: number, flowerCount: number): void {
    const fpsEl = this.container.querySelector('#stat-fps');
    const drawEl = this.container.querySelector('#stat-drawcalls');
    const countEl = this.container.querySelector('#stat-flowers');

    if (fpsEl) fpsEl.textContent = fps.toString();
    if (drawEl) drawEl.textContent = drawCalls.toString();
    if (countEl) countEl.textContent = flowerCount.toString();
  }

  private bindEvents(): void {
    // HUD buttons
    this.container.querySelector('#btn-explore')?.addEventListener('click', () => {
      this.gardenScene?.cameraController.cancelActiveTransition();
      // Manual mode allows immediate free exploration
      (this.gardenScene?.cameraController as any).setMode('manual');
      this.currentMode = 'manual';
      this.updateHudControls();
    });

    this.container.querySelector('#btn-overview')?.addEventListener('click', () => {
      this.gardenScene?.cameraController.flyToOverview();
      this.hideFlowerMessageCard();
    });

    this.container.querySelector('#btn-resume-auto')?.addEventListener('click', () => {
      this.gardenScene?.cameraController.resumeAutomaticMode();
      this.hideFlowerMessageCard();
    });

    // Unified Time of Day Popover & Scrubber
    const timeBtn = this.container.querySelector('#btn-toggle-weather');
    const timePopover = this.container.querySelector('#time-popover');
    timeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      timePopover?.classList.toggle('hidden');
    });

    const scrubber = this.container.querySelector('#input-time-scrubber') as HTMLInputElement;
    scrubber?.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.gardenScene?.setTimeOfDay(val, true);
    });

    this.container.querySelectorAll('.time-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        const preset = (e.currentTarget as HTMLElement).dataset.preset as GardenWeather;
        if (preset) {
          this.currentWeather = preset;
          this.gardenScene?.setWeather(preset, true);
        }
      });
    });

    // Dismiss popover when clicking anywhere else
    window.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#time-control-wrapper')) {
        timePopover?.classList.add('hidden');
      }
    });

    this.container.querySelector('#btn-toggle-filament')?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      if (this.gardenScene) {
        const nextMode = this.gardenScene.aestheticMode === 'meadow' ? 'filament' : 'meadow';
        this.gardenScene.setAestheticMode(nextMode);
        if (nextMode === 'filament') {
          btn.innerHTML = '🌸 Meadow';
          btn.classList.add('active');
        } else {
          btn.innerHTML = '✨ Filament';
          btn.classList.remove('active');
        }
      }
    });

    this.container.querySelector('#btn-clear-queue')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.gardenScene?.cameraController.clearQueue();
      this.queueLength = 0;
      this.updateQueueBadge();
    });

    this.container.querySelector('#btn-dismiss-message')?.addEventListener('click', () => {
      this.hideFlowerMessageCard();
    });

    // Fullscreen Toggle
    this.container.querySelector('#btn-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch((err) => {
          console.warn('Fullscreen request denied:', err);
        });
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Toggle Stats
    this.container.querySelector('#btn-toggle-stats')?.addEventListener('click', () => {
      this.isStatsVisible = !this.isStatsVisible;
      const statsBox = this.container.querySelector('#stats-overlay');
      if (this.isStatsVisible) statsBox?.classList.remove('hidden');
      else statsBox?.classList.add('hidden');
    });

    // Stress Test
    this.container.querySelector('#btn-stress-test')?.addEventListener('click', () => {
      this.gardenScene?.generateStressTestFlowers(1000);
    });

    // Search Dialog
    const searchModal = this.container.querySelector('#search-modal');
    const searchInput = this.container.querySelector('#search-input') as HTMLInputElement;

    this.container.querySelector('#btn-open-search')?.addEventListener('click', () => {
      this.isSearchOpen = true;
      searchModal?.classList.remove('hidden');
      searchInput?.focus();
      this.executeSearch(searchInput?.value || '');
    });

    const closeSearch = () => {
      this.isSearchOpen = false;
      searchModal?.classList.add('hidden');
    };

    this.container.querySelector('#btn-close-search')?.addEventListener('click', closeSearch);

    searchModal?.addEventListener('click', (e) => {
      if (e.target === searchModal) closeSearch();
    });

    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      this.executeSearch(this.searchQuery);
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.isSearchOpen) closeSearch();
        else if (this.activeMessageFlower) this.hideFlowerMessageCard();
      } else if (e.key === '/' && !this.isSearchOpen) {
        e.preventDefault();
        this.container.querySelector('#btn-open-search')?.dispatchEvent(new MouseEvent('click'));
      }
    });
  }

  private executeSearch(query: string): void {
    const listEl = this.container.querySelector('#search-results');
    if (!listEl || !this.gardenScene) return;

    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      listEl.innerHTML = `<div class="search-hint">Type to search flowers by code, creator, or message...</div>`;
      return;
    }

    const allFlowers = this.gardenScene.getAllFlowers();
    // Unicode case-insensitive match
    const results = allFlowers.filter((f) => {
      const codeMatch = f.code.toLowerCase().includes(trimmed);
      const nameMatch = f.displayName.toLowerCase().includes(trimmed);
      const msgMatch = f.message.toLowerCase().includes(trimmed);
      return codeMatch || nameMatch || msgMatch;
    });

    if (results.length === 0) {
      listEl.innerHTML = `<div class="search-no-results">No flowers found matching "<strong>${this.escapeHtml(query)}</strong>"</div>`;
      return;
    }

    listEl.innerHTML = results.map((f) => `
      <div class="search-result-item" data-flower-id="${f.id}">
        <div class="result-header">
          <span class="result-name">${this.escapeHtml(f.displayName || "A visitor's flower")}</span>
          <span class="result-code">${f.code}</span>
        </div>
        <p class="result-message" dir="${isRTL(f.message) ? 'rtl' : 'auto'}">${this.escapeHtml(f.message)}</p>
      </div>
    `).join('');

    // Clicking a search result focuses the flower smoothly
    listEl.querySelectorAll('.search-result-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.flowerId;
        const target = this.gardenScene?.getFlowerById(id || '');
        if (target) {
          this.showFlowerMessageCard(target);
          this.gardenScene?.cameraController.flyToFlower(target);
          this.container.querySelector('#search-modal')?.classList.add('hidden');
          this.isSearchOpen = false;
        }
      });
    });
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  public destroy(): void {
    if (this.unsubscribeRealtime) {
      this.unsubscribeRealtime();
    }
    if (this.unsubscribeRemote) {
      this.unsubscribeRemote();
    }
    this.gardenScene?.destroy();
  }
}

