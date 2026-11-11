import { FlowerDesign, PetalShape } from '../types/garden';

/**
 * Renders a crisp 2D procedural representation of the flower onto an HTML5 Canvas.
 * Used when WebGL is unavailable or for lightweight fallback previews.
 */
export function renderFlower2D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  design: FlowerDesign
): void {
  ctx.clearRect(0, 0, width, height);

  const cx = width * 0.5;
  const cy = height * 0.52;
  const baseScale = Math.min(width, height) * 0.22;

  ctx.save();
  ctx.translate(cx, cy);

  // 1. Draw Stem
  const stemH = design.stemHeight * baseScale * 0.7;
  ctx.beginPath();
  ctx.strokeStyle = design.stemColor || '#3e6b36';
  ctx.lineWidth = Math.max(6, baseScale * 0.08);
  ctx.lineCap = 'round';
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(baseScale * 0.15, stemH * 0.5, 0, stemH);
  ctx.stroke();

  // Leaves
  const leaves = Math.min(4, design.leafCount);
  for (let i = 0; i < leaves; i++) {
    const ly = stemH * (0.3 + i * 0.2);
    const side = i % 2 === 0 ? 1 : -1;
    ctx.save();
    ctx.translate(side * 8, ly);
    ctx.rotate(side * 0.55);
    ctx.fillStyle = '#5a8f42';
    ctx.beginPath();
    const lw = design.leafSize * baseScale * 0.35;
    const lh = design.leafSize * baseScale * 0.18;
    ctx.ellipse(side * lw * 0.5, 0, lw * 0.5, lh * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. Draw Petals (Layers)
  const layers = design.petalLayers;
  const baseCount = design.petalCount;

  for (let l = layers - 1; l >= 0; l--) {
    const count = l === 0 ? baseCount : Math.max(4, Math.round(baseCount * 0.85));
    const layerScale = (1.0 - l * 0.18) * baseScale;
    const pLen = design.petalLength * layerScale;
    const pWid = design.petalWidth * layerScale * 0.5;
    const angleOffset = (l * Math.PI) / baseCount;

    ctx.fillStyle = l === 0 ? design.primaryColor : design.secondaryColor;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1.5;

    for (let p = 0; p < count; p++) {
      const angle = (p / count) * Math.PI * 2 + angleOffset;
      ctx.save();
      ctx.rotate(angle);

      draw2DPetalPath(ctx, design.petalShape, pLen, pWid);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }
  }

  // 3. Draw Center Receptacle
  const centerR = design.petalWidth * baseScale * 0.22;
  const grad = ctx.createRadialGradient(0, -centerR * 0.2, 2, 0, 0, centerR);
  grad.addColorStop(0, '#fff4cc');
  grad.addColorStop(0.3, design.centerColor);
  grad.addColorStop(1, '#8b5a00');

  ctx.beginPath();
  ctx.arc(0, 0, centerR, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Subtle stamen dots
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let d = 0; d < 8; d++) {
    const da = (d / 8) * Math.PI * 2;
    const dr = centerR * 0.55;
    ctx.beginPath();
    ctx.arc(Math.cos(da) * dr, Math.sin(da) * dr, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function draw2DPetalPath(
  ctx: CanvasRenderingContext2D,
  shape: PetalShape,
  length: number,
  halfW: number
): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);

  switch (shape) {
    case 'rounded':
      ctx.bezierCurveTo(halfW * 0.8, -length * 0.3, halfW, -length * 0.7, 0, -length);
      ctx.bezierCurveTo(-halfW, -length * 0.7, -halfW * 0.8, -length * 0.3, 0, 0);
      break;
    case 'pointed':
      ctx.bezierCurveTo(halfW * 0.9, -length * 0.4, halfW * 0.6, -length * 0.75, 0, -length);
      ctx.bezierCurveTo(-halfW * 0.6, -length * 0.75, -halfW * 0.9, -length * 0.4, 0, 0);
      break;
    case 'teardrop':
      ctx.bezierCurveTo(halfW * 0.4, -length * 0.2, halfW * 1.2, -length * 0.7, 0, -length);
      ctx.bezierCurveTo(-halfW * 1.2, -length * 0.7, -halfW * 0.4, -length * 0.2, 0, 0);
      break;
    case 'heart':
      ctx.bezierCurveTo(halfW * 0.9, -length * 0.4, halfW * 1.1, -length * 0.8, halfW * 0.4, -length);
      ctx.quadraticCurveTo(0, -length * 0.85, 0, -length * 0.85);
      ctx.quadraticCurveTo(-halfW * 0.4, -length, -halfW * 0.4, -length);
      ctx.bezierCurveTo(-halfW * 1.1, -length * 0.8, -halfW * 0.9, -length * 0.4, 0, 0);
      break;
    case 'ruffled':
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const wave = Math.sin(t * Math.PI * 4) * (halfW * 0.2);
        const w = Math.sin(t * Math.PI) * halfW + wave;
        ctx.lineTo(w, -t * length);
      }
      for (let i = steps; i >= 0; i--) {
        const t = i / steps;
        const wave = Math.sin(t * Math.PI * 4) * (halfW * 0.2);
        const w = -Math.sin(t * Math.PI) * halfW - wave;
        ctx.lineTo(w, -t * length);
      }
      break;
  }
}

