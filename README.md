# The Living Garden — Interactive Gallery Installation

**The Living Garden** is an interactive browser-based installation and shared virtual ecosystem. Visitors scan an on-screen QR code with their mobile device, design a bespoke sculptural flower, attach a personal message in any language, and plant it directly into the 3D garden. A gallery screen navigates through new arrivals, introduces each creator, and gracefully features their words before returning to a composed panoramic tour.

Built with **TypeScript**, **Vite**, **Three.js** (WebGL), and **HTML5/CSS**. Features native **Supabase** persistence and Realtime replication, paired with an offline multi-tab broadcast bus for immediate local development.

---

## 🌸 Architecture & Views

The single web application delivers three responsive views:

1. **`/create` — Visitor Mobile Designer**
   - Designed for portrait smartphones and touch ergonomics.
   - Interactive 3D WebGL flower preview with touch rotation and drag interaction (automatic 2D Canvas fallback if WebGL is unavailable).
   - 3-step tactile flow: **Design → Message → Plant**.
   - Expressive parametric controls:
     - 5 Petal Shapes: `rounded`, `pointed`, `teardrop`, `heart`, and `ruffled`.
     - Petal Count (4–24), Layers (1–3), Length, Width, Curvature, Stem Height, Leaf Count.
     - 6 curated color harmonies + custom Hex color pickers.
     - **Surprise Me** randomizer (preserves entered text) & **Reset** button.
   - Internationalized plain-text input supporting Unicode, complex emojis (grapheme-cluster aware via `Intl.Segmenter`), newlines, and automatic Right-to-Left (RTL) script detection (Arabic, Hebrew, etc.).
   - Local draft persistence in `localStorage`, idempotency key deduplication on network retries, and honest status display (`Planted`, `Awaiting Approval`, or `Error`).

2. **`/garden` — Fullscreen Gallery Display**
   - Procedural rolling terrain generated from an analytical mathematical function ($y = f(x, z)$) with warm golden-hour lighting, sky gradient, and atmospheric depth fog.
   - 3,500 instanced grass blades swaying in the breeze.
   - Deterministic atomic slot allocation based on Fermat's sunflower spiral (Phyllotaxis with bounded jitter): flowers naturally radiate outward as the garden grows and never overlap or shuffle position upon reload.
   - Procedural wind animation and bloom opening transitions without per-frame geometry reallocation.
   - **Camera Choreography**:
     - **Attract Mode**: Gentle continuous cinematic fly-through across meadow vistas.
     - **Reveal Mode**: Smoothly eases camera to a scenic close-up of newly arrived flowers over ~2.0s, triggers bloom opening animation, displays creator name and message card for a configurable hold duration (~6s), then advances to the next queued flower.
     - **Manual Mode**: Dragging the scene, zooming, or selecting a flower immediately interrupts automatic flight and grants full orbit/pan/zoom control. New arrivals continue to queue quietly in the background without stealing the camera until **Resume Auto Mode** is pressed.
   - Unicode-aware search modal matching flower codes (`FLW-XXXX`), creator names, or multilingual substrings with smooth camera focus.
   - Floating QR code card with live test URL, queue length counter, and diagnostic performance metrics.

3. **`/admin` — Moderation & Configuration Panel**
   - Protected operator login (default local passcode: `garden2026`).
   - Moderation table with instant filtering (`All`, `Pending`, `Approved`, `Hidden`) and actions: **Approve**, **Hide**, **Restore**.
   - Live installation toggles:
     - **Approve Before Planting**: Enforces pre-moderation queue so unapproved text never enters the public garden display.
     - **Pause Submissions**: Temporarily halts visitor submissions.
     - **Reveal Hold Duration**: Configurable 3s to 20s hold time.
     - **Catch-up Queue Limit**: Bounds the replay backlog (e.g. max 20 flowers) after manual interruption or network reconnection.
     - **Visitor URL**: Configures the exact public HTTPS domain encoded into the exhibition QR code.
   - Tools: Export garden contributions as JSON, and reset to initial sample garden.

---

## 🚀 Quick Start (Local Prototype)

The repository runs out-of-the-box in local multi-tab broadcast mode without requiring external credentials:

```bash
# 1. Install dependencies
npm install

# 2. Start Vite local development server
npm run dev
```

Visit the routes in your browser:
- Gallery screen: [`http://localhost:3000/garden`](http://localhost:3000/garden)
- Mobile phone designer: [`http://localhost:3000/create`](http://localhost:3000/create)
- Moderation panel: [`http://localhost:3000/admin`](http://localhost:3000/admin) *(Passcode: `garden2026`)*

*Tip: Open `/garden` in one browser tab and `/create` in another tab or mobile window side-by-side. Planting a flower immediately updates the gallery screen via `BroadcastChannel` in real time!*

---

## ☁️ Supabase Production Setup

To deploy for an in-person exhibition where real phones connect over Wi-Fi:

1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in Supabase and run the migration script located at:
   [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)
   *This establishes the `submissions` and `public_flowers` tables, Row-Level Security (RLS) policies, atomic slot allocation, and Realtime publications.*
3. Copy `.env.example` to `.env.local` and enter your project credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   VITE_VISITOR_URL=https://your-gallery-domain.com/create
   ```
4. Build and preview:
   ```bash
   npm run build
   npm run preview
   ```

---

## 🧪 Verification & Benchmark Results

### 1. Automated Test Suites
- **Unit & Algorithmic Tests (Vitest)**:
  - `tests/text-utils.test.ts`: Grapheme cluster parsing, multi-codepoint emojis (ZWJ family `👨‍👩‍👧‍👦`, skin tones `👋🏽`, combining accents), 280/40 character boundaries, RTL detection, code generation.
  - `tests/terrain.test.ts`: Mathematical surface continuity, surface normals, deterministic slot allocation, spiral radial distribution.
  - `tests/flower-generator.test.ts`: 3D geometry construction for all 5 petal shapes, memory disposal.
- **End-to-End Browser Tests (Playwright)**:
  - Phone creation flow, multilingual text submission, draft persistence.
  - Realtime phone-to-gallery live arrival and sequential reveal card presentation.
  - Multilingual search across Japanese, Arabic, and Latin text with smooth focus.
  - Dragging the canvas triggers Manual mode; new arrivals queue quietly without stealing the camera.
  - Admin login, moderation status toggling (`hidden` / `approved`), and real-time removal.

Run all tests:
```bash
npm test        # Runs Vitest unit tests (17 passed)
npm run test:e2e # Runs Playwright browser tests (8 passed across Desktop & Mobile)
```

### 2. 1,000-Flower Performance Benchmark
- **Test environment**: Apple M-series (macOS arm64), Chromium Headless with SwiftShader WebGL CPU software emulation.
- **Optimizations implemented**:
  - Petal geometry merging via `BufferGeometryUtils.mergeGeometries`, reducing mesh draw calls from 14–25 down to 2–3 per flower.
  - Instanced rendering for 3,500 meadow grass tufts.
  - Distance-based shadow culling for outer flowers beyond the 40m sunlight shadow frustum.
- **Measured Results**:
  - **Baseline (4 flowers + grass)**: 27 Draw Calls, 60 FPS (Hardware GPU) / 18 FPS (SwiftShader Headless).
  - **1,000 Flowers Density**: **2,582 Draw Calls** (reduced from 13,721 unmerged calls — an **81.2% reduction**). Steady real-time rendering with zero memory leaks.

---

## 🎨 Proposed Phase 2 Enhancements

1. **Luminous Filament Sculpture Mode** *(Inspired by Reference 2)*:
   - Wireframe/filament close-up mode during flower reveal, rendering petals as glowing bezier contours with additive blending and bloom post-processing shaders.
2. **Organic Petal Curling & Vein Normal Maps**:
   - Parametric vein displacement mapping and organic dual-frequency flutter in breeze.
3. **Dedicated Tablet Operator Controller**:
   - Secondary companion tablet interface allowing gallery docents to trigger curated spotlights, pause camera choreography, or adjust lighting time-of-day (sunrise, golden hour, midnight bioluminescence).

