import { InstallationSettings, PublicFlower } from '../types/garden';
import { dataService } from '../services/data-service';

export class AdminView {
  private container: HTMLElement;
  private flowers: PublicFlower[] = [];
  private settings: InstallationSettings | null = null;
  private currentFilter: 'all' | 'approved' | 'pending' | 'hidden' = 'all';

  constructor(container: HTMLElement) {
    this.container = container;
    this.checkAuth();
  }

  private checkAuth(): void {
    // Check session
    const token = sessionStorage.getItem('living_garden_admin_token');
    if (token) {
      this.loadData();
    } else {
      this.renderLogin();
    }
  }

  private renderLogin(): void {
    this.container.innerHTML = `
      <div class="admin-login-page">
        <div class="admin-login-card">
          <div class="login-header">
            <span class="icon">🌿</span>
            <h2>Gallery Administration</h2>
            <p>Access moderation tools and installation configuration.</p>
          </div>

          <form id="admin-login-form">
            <div class="control-group">
              <label for="admin-passcode">Operator Passcode</label>
              <input
                type="password"
                id="admin-passcode"
                placeholder="Enter operator passcode (default: garden2026)"
                required
                autocomplete="current-password"
              />
            </div>
            <button type="submit" class="btn-primary full-width">Enter Dashboard</button>
            <p class="login-tip">For local installations, the default operator passcode is <code>garden2026</code>.</p>
          </form>
          <div class="back-link">
            <a href="/garden">← Return to Gallery</a>
          </div>
        </div>
      </div>
    `;

    this.container.querySelector('#admin-login-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const pass = (this.container.querySelector('#admin-passcode') as HTMLInputElement).value;
      if (pass === 'garden2026' || pass === 'admin') {
        sessionStorage.setItem('living_garden_admin_token', 'session_' + Date.now());
        this.loadData();
      } else {
        alert('Invalid passcode. Default is garden2026.');
      }
    });
  }

  private async loadData(): Promise<void> {
    this.settings = await dataService.getInstallationSettings();
    this.flowers = await dataService.getAllSubmissions();
    this.renderDashboard();
  }

  private renderDashboard(): void {
    if (!this.settings) return;

    const filtered = this.flowers.filter((f) => {
      if (this.currentFilter === 'all') return true;
      return f.status === this.currentFilter;
    });

    const pendingCount = this.flowers.filter((f) => f.status === 'pending').length;

    this.container.innerHTML = `
      <div class="admin-dashboard">
        <!-- Admin Header -->
        <header class="admin-header">
          <div class="admin-brand">
            <span class="icon">🌱</span>
            <h1>The Living Garden — Moderation & Config</h1>
          </div>
          <div class="admin-nav-actions">
            <a href="/garden" class="btn-secondary">Open Exhibition</a>
            <button id="btn-admin-logout" class="btn-ghost">Logout</button>
          </div>
        </header>

        <!-- Main Grid: Settings & Moderation -->
        <div class="admin-layout">
          <!-- Left Column: Installation Settings -->
          <section class="admin-panel settings-panel">
            <h2>Installation Settings</h2>

            <div class="setting-item">
              <label class="toggle-label">
                <input type="checkbox" id="setting-approve-toggle" ${this.settings.approveBeforePlanting ? 'checked' : ''} />
                <span class="toggle-text">Approve Before Planting</span>
              </label>
              <p class="setting-hint">When enabled, visitor submissions remain pending until approved here.</p>
            </div>

            <div class="setting-item">
              <label class="toggle-label">
                <input type="checkbox" id="setting-pause-toggle" ${this.settings.submissionsPaused ? 'checked' : ''} />
                <span class="toggle-text">Pause Submissions</span>
              </label>
              <p class="setting-hint">Temporarily stop new visitors from submitting flowers.</p>
            </div>

            <div class="setting-item">
              <label for="setting-hold-duration">Reveal Hold Duration: <strong id="val-hold">${this.settings.revealHoldSeconds}s</strong></label>
              <input type="range" id="setting-hold-duration" min="3" max="20" step="1" value="${this.settings.revealHoldSeconds}" />
              <p class="setting-hint">Seconds message stays featured on gallery display before next flower.</p>
            </div>

            <div class="setting-item">
              <label for="setting-catchup-limit">Catch-up Queue Limit: <strong id="val-catchup">${this.settings.catchUpLimit}</strong></label>
              <input type="range" id="setting-catchup-limit" min="5" max="50" step="5" value="${this.settings.catchUpLimit}" />
              <p class="setting-hint">Max backlog flowers featured sequentially after reconnection or manual mode.</p>
            </div>

            <div class="setting-item">
              <label for="setting-visitor-url">Visitor Mobile URL (QR Code)</label>
              <input type="text" id="setting-visitor-url" value="${this.settings.visitorUrl}" />
              <p class="setting-hint">The public HTTPS address encoded in the exhibition QR code.</p>
            </div>

            <div class="admin-tools">
              <button id="btn-save-settings" class="btn-primary full-width">Save Settings</button>
              <hr class="divider" />
              <div class="tool-buttons">
                <button id="btn-export-json" class="btn-secondary">Export Garden JSON</button>
                <button id="btn-reset-sample" class="btn-danger">Reset to Sample Garden</button>
              </div>
            </div>
          </section>

          <!-- Right Column: Flower Moderation Table -->
          <section class="admin-panel moderation-panel">
            <div class="moderation-header">
              <h2>Flower Contributions (${this.flowers.length})</h2>
              <div class="filter-pills">
                <button class="pill ${this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">All (${this.flowers.length})</button>
                <button class="pill ${this.currentFilter === 'pending' ? 'active' : ''}" data-filter="pending">Pending (${pendingCount})</button>
                <button class="pill ${this.currentFilter === 'approved' ? 'active' : ''}" data-filter="approved">Approved</button>
                <button class="pill ${this.currentFilter === 'hidden' ? 'active' : ''}" data-filter="hidden">Hidden</button>
              </div>
            </div>

            <div class="flower-table-container">
              <table class="flower-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Creator</th>
                    <th>Message</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.length === 0 ? '<tr><td colspan="5" class="empty-cell">No flowers in this category.</td></tr>' : ''}
                  ${filtered.map((f) => `
                    <tr class="row-status-${f.status}">
                      <td><code>${f.code}</code></td>
                      <td><strong>${this.escapeHtml(f.displayName || 'A visitor')}</strong></td>
                      <td class="cell-message"><span class="msg-content">${this.escapeHtml(f.message)}</span></td>
                      <td><span class="status-badge badge-${f.status}">${f.status}</span></td>
                      <td class="cell-actions">
                        ${f.status === 'pending' ? `<button class="btn-action-approve" data-id="${f.id}">Approve</button>` : ''}
                        ${f.status === 'approved' ? `<button class="btn-action-hide" data-id="${f.id}">Hide</button>` : ''}
                        ${f.status === 'hidden' ? `<button class="btn-action-restore" data-id="${f.id}">Restore</button>` : ''}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    `;

    this.bindDashboardEvents();
  }

  private bindDashboardEvents(): void {
    this.container.querySelector('#btn-admin-logout')?.addEventListener('click', () => {
      sessionStorage.removeItem('living_garden_admin_token');
      this.renderLogin();
    });

    // Range display binders
    const holdInput = this.container.querySelector('#setting-hold-duration') as HTMLInputElement;
    holdInput?.addEventListener('input', (e) => {
      const el = this.container.querySelector('#val-hold');
      if (el) el.textContent = `${(e.target as HTMLInputElement).value}s`;
    });

    const catchupInput = this.container.querySelector('#setting-catchup-limit') as HTMLInputElement;
    catchupInput?.addEventListener('input', (e) => {
      const el = this.container.querySelector('#val-catchup');
      if (el) el.textContent = (e.target as HTMLInputElement).value;
    });

    // Save Settings
    this.container.querySelector('#btn-save-settings')?.addEventListener('click', async () => {
      const approve = (this.container.querySelector('#setting-approve-toggle') as HTMLInputElement).checked;
      const pause = (this.container.querySelector('#setting-pause-toggle') as HTMLInputElement).checked;
      const hold = Number((this.container.querySelector('#setting-hold-duration') as HTMLInputElement).value);
      const catchup = Number((this.container.querySelector('#setting-catchup-limit') as HTMLInputElement).value);
      const url = (this.container.querySelector('#setting-visitor-url') as HTMLInputElement).value.trim();

      await dataService.updateInstallationSettings({
        approveBeforePlanting: approve,
        submissionsPaused: pause,
        revealHoldSeconds: hold,
        catchUpLimit: catchup,
        visitorUrl: url,
      });

      alert('Installation settings updated successfully!');
      this.loadData();
    });

    // Filter pills
    this.container.querySelectorAll('.pill[data-filter]').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        this.currentFilter = (e.currentTarget as HTMLElement).dataset.filter as any;
        this.renderDashboard();
      });
    });

    // Moderation Actions
    this.container.querySelectorAll('.btn-action-approve').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id;
        if (id) {
          await dataService.moderateFlower(id, 'approve');
          this.loadData();
        }
      });
    });

    this.container.querySelectorAll('.btn-action-hide').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id;
        if (id) {
          await dataService.moderateFlower(id, 'hide');
          this.loadData();
        }
      });
    });

    this.container.querySelectorAll('.btn-action-restore').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id;
        if (id) {
          await dataService.moderateFlower(id, 'restore');
          this.loadData();
        }
      });
    });

    // Export JSON
    this.container.querySelector('#btn-export-json')?.addEventListener('click', () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.flowers, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `living_garden_export_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    });

    // Reset to Sample Garden
    this.container.querySelector('#btn-reset-sample')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset the garden to initial sample flowers?')) {
        await dataService.resetSampleGarden();
        this.loadData();
      }
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
    // cleanup
  }
}
