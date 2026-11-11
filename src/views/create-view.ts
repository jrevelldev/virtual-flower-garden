import * as THREE from 'three';
import { FlowerDesign, PetalShape, SubmissionDraft } from '../types/garden';
import { GeneratedFlowerInstance, generateFlowerObject } from '../flower/flower-generator';
import { renderFlower2D } from '../flower/canvas-preview';
import { countGraphemes, isRTL, sanitizePlainMessage, truncateGraphemes } from '../services/text-utils';
import { dataService } from '../services/data-service';

const DEFAULT_DESIGN: FlowerDesign = {
  petalShape: 'rounded',
  petalCount: 8,
  petalLayers: 1,
  primaryColor: '#e84393',
  secondaryColor: '#fd79a8',
  centerColor: '#ffeaa7',
  stemColor: '#2d6a4f',
  petalLength: 1.2,
  petalWidth: 0.8,
  petalCurvature: -0.15,
  stemHeight: 1.6,
  leafCount: 3,
  leafSize: 0.85,
  imperfection: 0.35,
};

const COLOR_PRESETS = [
  { name: 'Dawn Rose', primary: '#e84393', secondary: '#fd79a8', center: '#ffeaa7' },
  { name: 'Solar Flare', primary: '#f39c12', secondary: '#f1c40f', center: '#6c3483' },
  { name: 'Sky Orchid', primary: '#0984e3', secondary: '#74b9ff', center: '#fab1a0' },
  { name: 'Velvet Plum', primary: '#6c5ce7', secondary: '#a29bfe', center: '#ffeaa7' },
  { name: 'Wild Amber', primary: '#e17055', secondary: '#fab1a0', center: '#ffeaa7' },
  { name: 'Luminous Mint', primary: '#00b894', secondary: '#55efc4', center: '#2d3436' },
];

export class CreateView {
  private container: HTMLElement;
  private currentStep: 'design' | 'message' | 'plant' = 'design';
  private design: FlowerDesign = { ...DEFAULT_DESIGN };
  private displayName = '';
  private message = '';
  private idempotencyKey = '';
  private submittedCode = '';
  private submissionStatus: 'idle' | 'submitting' | 'planted' | 'awaiting_approval' | 'error' = 'idle';
  private errorMessage = '';

  // 3D Preview (retained persistently across option changes)
  private previewScene: THREE.Scene | null = null;
  private previewCamera: THREE.PerspectiveCamera | null = null;
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewFlowerInstance: GeneratedFlowerInstance | null = null;
  private previewAnimId: number | null = null;
  private isWebGLSupported = true;
  private fallbackCanvas: HTMLCanvasElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Touch rotation in preview
  private previewRotationY = 0;
  private isPreviewDragging = false;
  private lastDragX = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.loadDraft();
    this.initShell();
    this.initPreview();
    this.renderControls();
  }

  private loadDraft(): void {
    try {
      const saved = localStorage.getItem('living_garden_draft');
      if (saved) {
        const draft: SubmissionDraft = JSON.parse(saved);
        if (draft.design) this.design = { ...DEFAULT_DESIGN, ...draft.design };
        if (draft.displayName) this.displayName = draft.displayName;
        if (draft.message) this.message = draft.message;
        if (draft.idempotencyKey) this.idempotencyKey = draft.idempotencyKey;
      }
    } catch {
      // ignore
    }

    if (!this.idempotencyKey) {
      this.idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  private saveDraft(): void {
    const draft: SubmissionDraft = {
      design: this.design,
      displayName: this.displayName,
      message: this.message,
      idempotencyKey: this.idempotencyKey,
    };
    localStorage.setItem('living_garden_draft', JSON.stringify(draft));
  }

  /**
   * Builds the stable outer DOM shell once so the preview canvas is never wiped out.
   */
  private initShell(): void {
    this.container.innerHTML = `
      <div class="create-page">
        <!-- Top Navigation Header -->
        <header class="create-header">
          <div class="header-branding">
            <span class="garden-icon">🌱</span>
            <h1>The Living Garden</h1>
          </div>
          <nav class="create-steps" id="create-steps-nav">
            <button class="step-btn active" data-step="design">
              <span class="step-num">1</span> Design
            </button>
            <button class="step-btn" data-step="message">
              <span class="step-num">2</span> Message
            </button>
            <button class="step-btn" data-step="plant" disabled>
              <span class="step-num">3</span> Plant
            </button>
          </nav>
        </header>

        <!-- Main Content Area -->
        <main class="create-main">
          <!-- Live Preview Card (Persistent DOM) -->
          <div class="preview-card">
            <div class="preview-canvas-holder" id="flower-preview-holder"></div>
            <div class="preview-badge">
              <span>Interactive 3D Preview (drag to rotate)</span>
            </div>
          </div>

          <!-- Dynamic Controls Panel -->
          <div class="controls-panel" id="controls-panel"></div>
        </main>
      </div>
    `;

    // Bind step buttons in header
    this.container.querySelector('#create-steps-nav')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.step-btn') as HTMLButtonElement;
      if (!btn || btn.disabled) return;
      const step = btn.dataset.step as any;
      if (step && step !== this.currentStep) {
        this.currentStep = step;
        this.renderControls();
      }
    });
  }

  /**
   * Updates only the step contents without recreating the 3D canvas holder.
   */
  public renderControls(): void {
    const panel = this.container.querySelector('#controls-panel');
    if (!panel) return;

    // Update Header Step Navigation
    const nav = this.container.querySelector('#create-steps-nav');
    if (nav) {
      nav.querySelectorAll('.step-btn').forEach((b) => {
        const btn = b as HTMLButtonElement;
        const step = btn.dataset.step;
        if (step === this.currentStep) btn.classList.add('active');
        else btn.classList.remove('active');

        if (step === 'plant') {
          btn.disabled = !this.message.trim();
        }
      });
    }

    const messageGraphemes = countGraphemes(this.message);
    const nameGraphemes = countGraphemes(this.displayName);
    const rtl = isRTL(this.message);

    panel.innerHTML = this.renderStepContent(messageGraphemes, nameGraphemes, rtl);

    this.bindControlEvents();
  }

  private renderStepContent(msgLen: number, nameLen: number, rtl: boolean): string {
    if (this.currentStep === 'design') {
      return `
        <div class="step-section">
          <div class="step-actions-top">
            <button id="btn-surprise" class="btn-secondary" title="Randomize flower design">
              🎲 Surprise Me
            </button>
            <button id="btn-reset" class="btn-ghost" title="Reset to default">
              ↺ Reset
            </button>
          </div>

          <!-- Petal Shapes -->
          <div class="control-group">
            <label class="group-label">Petal Shape</label>
            <div class="shape-chips">
              ${(['rounded', 'pointed', 'teardrop', 'heart', 'ruffled'] as PetalShape[]).map((shape) => `
                <button class="chip ${this.design.petalShape === shape ? 'selected' : ''}" data-shape="${shape}">
                  ${shape.charAt(0).toUpperCase() + shape.slice(1)}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Color Palettes -->
          <div class="control-group">
            <label class="group-label">Color Harmony Presets</label>
            <div class="palette-grid">
              ${COLOR_PRESETS.map((p, i) => `
                <button class="palette-card ${this.design.primaryColor === p.primary && this.design.secondaryColor === p.secondary ? 'selected' : ''}" data-preset-idx="${i}">
                  <div class="palette-swatches">
                    <span class="swatch" style="background:${p.primary}"></span>
                    <span class="swatch" style="background:${p.secondary}"></span>
                    <span class="swatch" style="background:${p.center}"></span>
                  </div>
                  <span class="palette-name">${p.name}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Core Sliders -->
          <div class="control-group">
            <div class="slider-row">
              <label for="input-petal-count">Petal Count: <strong id="val-petal-count">${this.design.petalCount}</strong></label>
              <input type="range" id="input-petal-count" min="4" max="24" step="1" value="${this.design.petalCount}" />
            </div>

            <div class="slider-row">
              <label for="input-petal-layers">Petal Layers: <strong id="val-petal-layers">${this.design.petalLayers}</strong></label>
              <input type="range" id="input-petal-layers" min="1" max="3" step="1" value="${this.design.petalLayers}" />
            </div>

            <div class="slider-row">
              <label for="input-stem-height">Stem Height: <strong id="val-stem-height">${this.design.stemHeight.toFixed(1)}m</strong></label>
              <input type="range" id="input-stem-height" min="0.8" max="2.8" step="0.1" value="${this.design.stemHeight}" />
            </div>
          </div>

          <!-- Collapsible Advanced Controls -->
          <details class="advanced-details">
            <summary class="advanced-summary">Advanced Customization</summary>
            <div class="advanced-content">
              <div class="color-picker-row">
                <div class="color-picker-item">
                  <label for="custom-primary">Primary Petal</label>
                  <input type="color" id="custom-primary" value="${this.design.primaryColor}" />
                </div>
                <div class="color-picker-item">
                  <label for="custom-secondary">Inner Layer</label>
                  <input type="color" id="custom-secondary" value="${this.design.secondaryColor}" />
                </div>
                <div class="color-picker-item">
                  <label for="custom-center">Center Receptacle</label>
                  <input type="color" id="custom-center" value="${this.design.centerColor}" />
                </div>
              </div>

              <div class="slider-row">
                <label for="input-petal-length">Petal Length: <strong id="val-petal-length">${this.design.petalLength.toFixed(1)}</strong></label>
                <input type="range" id="input-petal-length" min="0.6" max="2.0" step="0.05" value="${this.design.petalLength}" />
              </div>

              <div class="slider-row">
                <label for="input-petal-width">Petal Width: <strong id="val-petal-width">${this.design.petalWidth.toFixed(1)}</strong></label>
                <input type="range" id="input-petal-width" min="0.4" max="1.8" step="0.05" value="${this.design.petalWidth}" />
              </div>

              <div class="slider-row">
                <label for="input-petal-curvature">Petal Arch: <strong id="val-petal-curvature">${this.design.petalCurvature < 0 ? 'Cupped' : this.design.petalCurvature > 0 ? 'Rolled' : 'Flat'}</strong></label>
                <input type="range" id="input-petal-curvature" min="-0.8" max="0.8" step="0.05" value="${this.design.petalCurvature}" />
              </div>

              <div class="slider-row">
                <label for="input-leaf-count">Leaf Count: <strong id="val-leaf-count">${this.design.leafCount}</strong></label>
                <input type="range" id="input-leaf-count" min="1" max="6" step="1" value="${this.design.leafCount}" />
              </div>

              <div class="slider-row">
                <label for="input-imperfection">Organic Variety (Natural Touch): <strong id="val-imperfection">${Math.round((this.design.imperfection ?? 0.35) * 100)}%</strong></label>
                <input type="range" id="input-imperfection" min="0" max="1" step="0.05" value="${this.design.imperfection ?? 0.35}" />
              </div>
            </div>
          </details>

          <!-- Navigation CTA -->
          <div class="step-footer">
            <button id="btn-to-message" class="btn-primary full-width">
              Continue to Message →
            </button>
          </div>
        </div>
      `;
    }

    if (this.currentStep === 'message') {
      return `
        <div class="step-section">
          <h2>Give Your Flower a Voice</h2>
          <p class="section-desc">Share a thought, wish, greeting, or memory. It will accompany your flower permanently in the gallery.</p>

          <div class="control-group">
            <div class="input-header">
              <label for="input-display-name">Creator Name (Optional)</label>
              <span class="char-count ${nameLen > 40 ? 'over-limit' : ''}">${nameLen}/40</span>
            </div>
            <input
              type="text"
              id="input-display-name"
              placeholder="e.g. Maya, Anonymous, Grandma Elena"
              value="${this.displayName}"
              maxlength="60"
            />
          </div>

          <div class="control-group">
            <div class="input-header">
              <label for="input-message">Message (Required)</label>
              <span class="char-count ${msgLen > 280 ? 'over-limit' : ''}">${msgLen}/280</span>
            </div>
            <textarea
              id="input-message"
              rows="4"
              dir="${rtl ? 'rtl' : 'auto'}"
              placeholder="Write in any language... (Arabic, Japanese, Spanish, Hindi, Emojis 🌸✨)"
            >${this.message}</textarea>
          </div>

          <div class="public-disclaimer">
            <span class="info-icon">ℹ️</span>
            <span>Your name and message will be publicly displayed on the gallery screen. No personal data or email is collected.</span>
          </div>

          <div class="step-footer split-buttons">
            <button id="btn-back-to-design" class="btn-secondary">← Back to Design</button>
            <button id="btn-to-plant" class="btn-primary" ${!this.message.trim() || msgLen > 280 ? 'disabled' : ''}>
              Ready to Plant 🌱
            </button>
          </div>
        </div>
      `;
    }

    // Step: 'plant'
    return `
      <div class="step-section plant-summary">
        ${this.renderPlantState()}
      </div>
    `;
  }

  private renderPlantState(): string {
    if (this.submissionStatus === 'submitting') {
      return `
        <div class="submission-card in-flight">
          <div class="spinner"></div>
          <h3>Planting your flower in the gallery...</h3>
          <p>Allocating permanent placement on the meadow terrain.</p>
        </div>
      `;
    }

    if (this.submissionStatus === 'planted') {
      return `
        <div class="submission-card success">
          <div class="success-icon">🌸</div>
          <h2>Your Flower is Planted!</h2>
          <p class="flower-code-display">Flower Code: <strong>${this.submittedCode}</strong></p>
          <div class="status-pill status-planted">Status: Permanent In Garden</div>
          <p class="reveal-note">
            The gallery screen travels to new arrivals. Keep an eye on the large display to see your flower bloom and share its message!
          </p>

          <div class="submission-actions">
            <a href="/garden" class="btn-primary link-btn">Open Gallery Display 🌿</a>
            <button id="btn-plant-another" class="btn-secondary">Design Another Flower</button>
          </div>
        </div>
      `;
    }

    if (this.submissionStatus === 'awaiting_approval') {
      return `
        <div class="submission-card pending">
          <div class="pending-icon">⏳</div>
          <h2>Flower Submitted for Review</h2>
          <p class="flower-code-display">Flower Code: <strong>${this.submittedCode}</strong></p>
          <div class="status-pill status-pending">Status: Awaiting Gallery Approval</div>
          <p class="reveal-note">
            The installation operator has pre-moderation enabled. Once approved, your flower will automatically appear on the gallery display.
          </p>

          <div class="submission-actions">
            <a href="/garden" class="btn-secondary link-btn">View Garden</a>
            <button id="btn-plant-another" class="btn-ghost">Design Another Flower</button>
          </div>
        </div>
      `;
    }

    if (this.submissionStatus === 'error') {
      return `
        <div class="submission-card error">
          <div class="error-icon">⚠️</div>
          <h3>Planting Failed</h3>
          <p class="error-text">${this.errorMessage || 'Network connection failed. Your draft has been safely saved.'}</p>
          <div class="submission-actions">
            <button id="btn-retry-plant" class="btn-primary">Try Planting Again</button>
            <button id="btn-back-to-message" class="btn-secondary">Edit Message</button>
          </div>
        </div>
      `;
    }

    // Default 'idle' confirmation state before tapping plant
    return `
      <h2>Confirm & Plant</h2>
      <div class="flower-summary-card">
        <p class="summary-creator"><strong>Creator:</strong> ${this.displayName.trim() || 'A visitor'}</p>
        <p class="summary-message" dir="${isRTL(this.message) ? 'rtl' : 'auto'}">“${this.message}”</p>
        <div class="summary-details">
          <span>${this.design.petalShape} petals (${this.design.petalCount})</span> •
          <span>${this.design.petalLayers} ${this.design.petalLayers === 1 ? 'layer' : 'layers'}</span>
        </div>
      </div>

      <div class="step-footer split-buttons">
        <button id="btn-back-to-message" class="btn-secondary">Edit Details</button>
        <button id="btn-plant-now" class="btn-primary btn-large">Plant My Flower 🌱</button>
      </div>
    `;
  }

  private initPreview(): void {
    const holder = document.getElementById('flower-preview-holder');
    if (!holder) return;

    // Check WebGL availability
    try {
      const testCanvas = document.createElement('canvas');
      const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
      if (!gl) {
        throw new Error('WebGL not supported');
      }
    } catch {
      this.isWebGLSupported = false;
    }

    if (!this.isWebGLSupported) {
      this.setup2DFallback(holder);
      return;
    }

    const width = holder.clientWidth || 320;
    const height = holder.clientHeight || 260;

    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color('#f0f5fa');

    this.previewCamera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);
    this.previewCamera.position.set(0, 3.2, 4.5);
    this.previewCamera.lookAt(0, 1.2, 0);

    this.previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.previewRenderer.setSize(width, height);
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.previewRenderer.shadowMap.enabled = true;

    holder.innerHTML = '';
    holder.appendChild(this.previewRenderer.domElement);

    // Watch for size changes to keep aspect ratio perfect across screen sizes
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0 && this.previewRenderer && this.previewCamera) {
          this.previewCamera.aspect = w / h;
          this.previewCamera.updateProjectionMatrix();
          this.previewRenderer.setSize(w, h, false);
        }
      }
    });
    this.resizeObserver.observe(holder);

    // Lights
    const keyLight = new THREE.DirectionalLight('#fff5e6', 2.0);
    keyLight.position.set(3, 5, 4);
    this.previewScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight('#d0e8ff', 1.0);
    fillLight.position.set(-3, 2, -2);
    this.previewScene.add(fillLight);

    const amb = new THREE.AmbientLight('#ffffff', 0.6);
    this.previewScene.add(amb);

    // Ground circle disk
    const discGeom = new THREE.CircleGeometry(1.2, 32);
    discGeom.rotateX(-Math.PI * 0.5);
    const discMat = new THREE.MeshStandardMaterial({ color: '#e2ebf3', roughness: 0.9 });
    const disc = new THREE.Mesh(discGeom, discMat);
    this.previewScene.add(disc);

    // Interactive Drag to Rotate Preview
    this.bindPreviewDrag(this.previewRenderer.domElement);

    // Animation Loop
    let lastTime = performance.now();
    const animate = (time: number) => {
      this.previewAnimId = requestAnimationFrame(animate);
      const delta = (time - lastTime) * 0.001;
      lastTime = time;

      if (this.previewFlowerInstance) {
        if (!this.isPreviewDragging) {
          // Slow continuous rotation
          this.previewRotationY += delta * 0.45;
        }
        this.previewFlowerInstance.rootGroup.rotation.y = this.previewRotationY;
        this.previewFlowerInstance.updateWind(time * 0.001, 0.5);
      }

      if (this.previewRenderer && this.previewScene && this.previewCamera) {
        this.previewRenderer.render(this.previewScene, this.previewCamera);
      }
    };

    this.previewAnimId = requestAnimationFrame(animate);
    this.updatePreviewObject();
  }

  private setup2DFallback(holder: HTMLElement): void {
    holder.innerHTML = '';
    this.fallbackCanvas = document.createElement('canvas');
    this.fallbackCanvas.width = holder.clientWidth || 320;
    this.fallbackCanvas.height = holder.clientHeight || 260;
    this.fallbackCanvas.style.width = '100%';
    this.fallbackCanvas.style.height = '100%';
    holder.appendChild(this.fallbackCanvas);

    this.updatePreviewObject();
  }

  private updatePreviewObject(): void {
    if (!this.isWebGLSupported && this.fallbackCanvas) {
      const ctx = this.fallbackCanvas.getContext('2d');
      if (ctx) {
        renderFlower2D(ctx, this.fallbackCanvas.width, this.fallbackCanvas.height, this.design);
      }
      return;
    }

    if (!this.previewScene) return;

    if (this.previewFlowerInstance) {
      this.previewScene.remove(this.previewFlowerInstance.rootGroup);
      this.previewFlowerInstance.dispose();
      this.previewFlowerInstance = null;
    }

    this.previewFlowerInstance = generateFlowerObject(this.design, 1);
    this.previewFlowerInstance.rootGroup.position.set(0, 0, 0);
    this.previewFlowerInstance.rootGroup.rotation.y = this.previewRotationY;
    // Graceful forward tilt toward camera so viewer sees into the flower face
    this.previewFlowerInstance.headGroup.rotation.x = 0.28;
    this.previewScene.add(this.previewFlowerInstance.rootGroup);

    // Frame the flower with a flattering beauty angle and generous headroom
    if (this.previewCamera) {
      const flowerHeight = this.previewFlowerInstance.height || 1.8;
      // Center the camera focus on the middle of the whole plant
      const targetY = flowerHeight * 0.50;
      // Flattering downward beauty angle with ample headroom on all sides
      const camY = flowerHeight * 0.72;
      const camDist = Math.max(4.6, flowerHeight * 1.55 + this.design.petalLength * 1.0);

      this.previewCamera.position.set(0, camY, camDist);
      this.previewCamera.lookAt(0, targetY, 0);
    }
  }

  private bindPreviewDrag(domElement: HTMLElement): void {
    domElement.addEventListener('pointerdown', (e) => {
      this.isPreviewDragging = true;
      this.lastDragX = e.clientX;
      domElement.setPointerCapture(e.pointerId);
    });

    domElement.addEventListener('pointermove', (e) => {
      if (!this.isPreviewDragging) return;
      const dx = e.clientX - this.lastDragX;
      this.previewRotationY += dx * 0.015;
      this.lastDragX = e.clientX;
    });

    const stopDrag = (e: PointerEvent) => {
      if (this.isPreviewDragging) {
        this.isPreviewDragging = false;
        try {
          domElement.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
    };

    domElement.addEventListener('pointerup', stopDrag);
    domElement.addEventListener('pointercancel', stopDrag);
  }

  private bindControlEvents(): void {
    const panel = this.container.querySelector('#controls-panel');
    if (!panel) return;

    // Step 1: Shape chips
    panel.querySelectorAll('.chip[data-shape]').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        const shape = (e.currentTarget as HTMLElement).dataset.shape as PetalShape;
        this.design.petalShape = shape;
        this.saveDraft();
        // Update selected class without wiping DOM
        panel.querySelectorAll('.chip[data-shape]').forEach((c) => c.classList.remove('selected'));
        (e.currentTarget as HTMLElement).classList.add('selected');
        this.updatePreviewObject();
      });
    });

    // Step 1: Preset Palettes
    panel.querySelectorAll('.palette-card[data-preset-idx]').forEach((card) => {
      card.addEventListener('click', (e) => {
        const idx = Number((e.currentTarget as HTMLElement).dataset.presetIdx);
        const preset = COLOR_PRESETS[idx];
        if (preset) {
          this.design.primaryColor = preset.primary;
          this.design.secondaryColor = preset.secondary;
          this.design.centerColor = preset.center;
          this.saveDraft();
          // Update selected palette
          panel.querySelectorAll('.palette-card').forEach((c) => c.classList.remove('selected'));
          (e.currentTarget as HTMLElement).classList.add('selected');
          this.updatePreviewObject();
        }
      });
    });

    // Step 1: Surprise Me
    panel.querySelector('#btn-surprise')?.addEventListener('click', () => {
      this.randomizeDesign();
    });

    // Step 1: Reset
    panel.querySelector('#btn-reset')?.addEventListener('click', () => {
      this.design = { ...DEFAULT_DESIGN };
      this.saveDraft();
      this.renderControls();
      this.updatePreviewObject();
    });

    // Sliders
    this.bindRangeInput('input-petal-count', (v) => {
      this.design.petalCount = parseInt(v);
      const el = document.getElementById('val-petal-count');
      if (el) el.textContent = v;
    });

    this.bindRangeInput('input-petal-layers', (v) => {
      this.design.petalLayers = parseInt(v);
      const el = document.getElementById('val-petal-layers');
      if (el) el.textContent = v;
    });

    this.bindRangeInput('input-stem-height', (v) => {
      this.design.stemHeight = parseFloat(v);
      const el = document.getElementById('val-stem-height');
      if (el) el.textContent = `${parseFloat(v).toFixed(1)}m`;
    });

    this.bindRangeInput('input-petal-length', (v) => {
      this.design.petalLength = parseFloat(v);
      const el = document.getElementById('val-petal-length');
      if (el) el.textContent = parseFloat(v).toFixed(1);
    });

    this.bindRangeInput('input-petal-width', (v) => {
      this.design.petalWidth = parseFloat(v);
      const el = document.getElementById('val-petal-width');
      if (el) el.textContent = parseFloat(v).toFixed(1);
    });

    this.bindRangeInput('input-petal-curvature', (v) => {
      const val = parseFloat(v);
      this.design.petalCurvature = val;
      const el = document.getElementById('val-petal-curvature');
      if (el) el.textContent = val < 0 ? 'Cupped' : val > 0 ? 'Rolled' : 'Flat';
    });

    this.bindRangeInput('input-leaf-count', (v) => {
      this.design.leafCount = parseInt(v);
      const el = document.getElementById('val-leaf-count');
      if (el) el.textContent = v;
    });

    this.bindRangeInput('input-imperfection', (v) => {
      const val = parseFloat(v);
      this.design.imperfection = val;
      const el = document.getElementById('val-imperfection');
      if (el) el.textContent = `${Math.round(val * 100)}%`;
    });

    // Custom Color pickers
    const bindColor = (id: string, prop: keyof FlowerDesign) => {
      const el = panel.querySelector(`#${id}`) as HTMLInputElement;
      el?.addEventListener('input', (e) => {
        (this.design as any)[prop] = (e.target as HTMLInputElement).value;
        this.saveDraft();
        this.updatePreviewObject();
      });
    };
    bindColor('custom-primary', 'primaryColor');
    bindColor('custom-secondary', 'secondaryColor');
    bindColor('custom-center', 'centerColor');

    // Navigation buttons
    panel.querySelector('#btn-to-message')?.addEventListener('click', () => {
      this.currentStep = 'message';
      this.renderControls();
    });

    panel.querySelector('#btn-back-to-design')?.addEventListener('click', () => {
      this.currentStep = 'design';
      this.renderControls();
    });

    panel.querySelector('#btn-to-plant')?.addEventListener('click', () => {
      if (this.message.trim().length > 0) {
        this.currentStep = 'plant';
        this.renderControls();
      }
    });

    panel.querySelector('#btn-back-to-message')?.addEventListener('click', () => {
      this.currentStep = 'message';
      this.renderControls();
    });

    // Inputs in Step 2
    const nameInput = panel.querySelector('#input-display-name') as HTMLInputElement;
    nameInput?.addEventListener('input', (e) => {
      this.displayName = (e.target as HTMLInputElement).value;
      this.saveDraft();
      const countEl = panel.querySelector('.input-header .char-count');
      if (countEl) {
        countEl.textContent = `${countGraphemes(this.displayName)}/40`;
      }
    });

    const msgInput = panel.querySelector('#input-message') as HTMLTextAreaElement;
    msgInput?.addEventListener('input', (e) => {
      this.message = (e.target as HTMLTextAreaElement).value;
      this.saveDraft();
      const msgLen = countGraphemes(this.message);
      const countEl = panel.querySelectorAll('.input-header .char-count')[1];
      if (countEl) {
        countEl.textContent = `${msgLen}/280`;
        if (msgLen > 280) countEl.classList.add('over-limit');
        else countEl.classList.remove('over-limit');
      }

      const plantBtn = panel.querySelector('#btn-to-plant') as HTMLButtonElement;
      if (plantBtn) {
        plantBtn.disabled = !this.message.trim() || msgLen > 280;
      }
    });

    // Step 3 Actions
    panel.querySelector('#btn-plant-now')?.addEventListener('click', () => {
      this.executePlant();
    });

    panel.querySelector('#btn-retry-plant')?.addEventListener('click', () => {
      this.executePlant();
    });

    panel.querySelector('#btn-plant-another')?.addEventListener('click', () => {
      this.idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      this.message = '';
      this.displayName = '';
      this.submissionStatus = 'idle';
      this.currentStep = 'design';
      this.saveDraft();
      this.renderControls();
      this.updatePreviewObject();
    });
  }

  private bindRangeInput(id: string, onChange: (val: string) => void): void {
    const el = this.container.querySelector(`#${id}`) as HTMLInputElement;
    if (!el) return;
    el.addEventListener('input', (e) => {
      const val = (e.target as HTMLInputElement).value;
      onChange(val);
      this.saveDraft();
      this.updatePreviewObject();
    });
  }

  private randomizeDesign(): void {
    const shapes: PetalShape[] = ['rounded', 'pointed', 'teardrop', 'heart', 'ruffled'];
    const randomShape = shapes[Math.floor(Math.random() * shapes.length)];
    const randomPreset = COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)];

    this.design = {
      petalShape: randomShape,
      petalCount: 6 + Math.floor(Math.random() * 16),
      petalLayers: 1 + Math.floor(Math.random() * 3),
      primaryColor: randomPreset.primary,
      secondaryColor: randomPreset.secondary,
      centerColor: randomPreset.center,
      stemColor: '#2d6a4f',
      petalLength: 0.8 + Math.random() * 0.9,
      petalWidth: 0.6 + Math.random() * 0.8,
      petalCurvature: -0.5 + Math.random() * 1.0,
      stemHeight: 1.2 + Math.random() * 1.2,
      leafCount: 2 + Math.floor(Math.random() * 4),
      leafSize: 0.7 + Math.random() * 0.5,
      imperfection: 0.2 + Math.random() * 0.45,
    };

    this.saveDraft();
    this.renderControls();
    this.updatePreviewObject();
  }

  private async executePlant(): Promise<void> {
    this.submissionStatus = 'submitting';
    this.errorMessage = '';
    this.renderControls();

    const draft: SubmissionDraft = {
      design: this.design,
      displayName: sanitizePlainMessage(this.displayName),
      message: truncateGraphemes(sanitizePlainMessage(this.message), 280),
      idempotencyKey: this.idempotencyKey,
    };

    try {
      const res = await dataService.submitFlower(draft);
      if (res.success) {
        this.submissionStatus = res.status === 'awaiting_approval' ? 'awaiting_approval' : 'planted';
        this.submittedCode = res.code || (res.flower ? res.flower.code : 'FLW-LIVE');
        localStorage.removeItem('living_garden_draft');
      } else {
        this.submissionStatus = 'error';
        this.errorMessage = res.message || 'Submission was not accepted.';
      }
    } catch (err: unknown) {
      this.submissionStatus = 'error';
      this.errorMessage = err instanceof Error ? err.message : 'Network error. Please try again.';
    }

    this.renderControls();
  }

  public destroy(): void {
    if (this.previewAnimId !== null) {
      cancelAnimationFrame(this.previewAnimId);
    }
    if (this.previewFlowerInstance) {
      this.previewFlowerInstance.dispose();
    }
    if (this.previewRenderer) {
      this.previewRenderer.dispose();
    }
  }
}
