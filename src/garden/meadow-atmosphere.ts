import * as THREE from 'three';

/**
 * Generates an organic seamless meadow ground texture using HTML5 canvas.
 * Creates rich moss, grass blades, and soil speckles.
 */
export function createMeadowGroundTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Base lush grass tone
  ctx.fillStyle = '#3a6b28';
  ctx.fillRect(0, 0, size, size);

  // Layer 1: Mossy soft patches
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 8 + Math.random() * 25;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const alpha = 0.12 + Math.random() * 0.18;
    const isGold = Math.random() > 0.6;
    grad.addColorStop(0, isGold ? `rgba(90, 145, 45, ${alpha})` : `rgba(35, 75, 25, ${alpha})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Layer 2: Organic micro grass strokes
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 2500; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 3 + Math.random() * 6;
    const angle = (Math.random() - 0.5) * 0.8 - Math.PI * 0.5;
    const isBright = Math.random() > 0.5;

    ctx.strokeStyle = isBright ? 'rgba(125, 185, 60, 0.35)' : 'rgba(25, 55, 18, 0.4)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(24, 24);
  return texture;
}

/**
 * Creates a celestial atmospheric Sky Dome with vertical gradient and sun glow.
 */
export function createAtmosphericSkyDome(): {
  mesh: THREE.Mesh;
  setMode: (mode: 'dawn' | 'sunny' | 'sunset' | 'night' | 'cloudy') => void;
  setTimeOfDay: (hour: number, isCloudy?: boolean) => void;
  update: (timeSec: number) => void;
  starsPoints: THREE.Points;
} {
  const geom = new THREE.SphereGeometry(320, 32, 24);

  // Custom vertex & fragment shader for panoramic atmospheric sky
  const uniforms = {
    uTopColor: { value: new THREE.Color('#1e6091') },
    uMidColor: { value: new THREE.Color('#72a9db') },
    uBottomColor: { value: new THREE.Color('#fff2d1') },
    uSunPos: { value: new THREE.Vector3(40, 60, 30).normalize() },
    uSunColor: { value: new THREE.Color('#fff7e6') },
    uSunGlow: { value: 1.0 },
    uTime: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uBottomColor;
      uniform vec3 uSunPos;
      uniform vec3 uSunColor;
      uniform float uSunGlow;
      varying vec3 vWorldPosition;

      void main() {
        vec3 dir = normalize(vWorldPosition);
        float y = dir.y;

        // Celestial vertical gradient
        vec3 skyColor;
        if (y > 0.0) {
          float t = clamp(y * 1.5, 0.0, 1.0);
          skyColor = mix(uMidColor, uTopColor, t);
          float tHorizon = clamp(1.0 - y * 3.5, 0.0, 1.0);
          skyColor = mix(skyColor, uBottomColor, tHorizon);
        } else {
          skyColor = uBottomColor;
        }

        // Atmospheric sun glow disk
        float sunDot = max(0.0, dot(dir, uSunPos));
        float sunDisc = pow(sunDot, 650.0);
        float sunCorona = pow(sunDot, 18.0) * 0.45 * uSunGlow;

        vec3 finalColor = skyColor + uSunColor * (sunDisc + sunCorona);
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geom, mat);

  // Celestial Starfield (visible at night)
  const starCount = 1200;
  const starGeom = new THREE.BufferGeometry();
  const starPositions = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i++) {
    // Upper hemisphere only
    const u = Math.random();
    const v = Math.random() * 0.75 + 0.15;
    const theta = u * Math.PI * 2;
    const phi = Math.acos(v);

    const r = 310;
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.cos(phi);
    starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const isWarm = Math.random() > 0.5;
    starColors[i * 3] = isWarm ? 1.0 : 0.85;
    starColors[i * 3 + 1] = isWarm ? 0.95 : 0.9;
    starColors[i * 3 + 2] = 1.0;
  }

  starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

  const starMat = new THREE.PointsMaterial({
    size: 1.8,
    vertexColors: true,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const starsPoints = new THREE.Points(starGeom, starMat);

  const targetTop = new THREE.Color('#1e6091');
  const targetMid = new THREE.Color('#72a9db');
  const targetBottom = new THREE.Color('#fff2d1');
  const targetSun = new THREE.Color('#fff7e6');
  let targetSunGlow = 1.0;
  let targetStarOpacity = 0.0;

  const setMode = (mode: 'dawn' | 'sunny' | 'sunset' | 'night' | 'cloudy') => {
    if (mode === 'dawn') {
      targetTop.set('#1e3a5f');
      targetMid.set('#d97706');
      targetBottom.set('#fed7aa');
      targetSun.set('#f59e0b');
      targetSunGlow = 1.25;
      targetStarOpacity = 0.2;
      uniforms.uSunPos.value.set(-50, 20, 25).normalize();
    } else if (mode === 'sunset') {
      targetTop.set('#2e1065');
      targetMid.set('#c026d3');
      targetBottom.set('#ea580c');
      targetSun.set('#fb923c');
      targetSunGlow = 1.4;
      targetStarOpacity = 0.35;
      uniforms.uSunPos.value.set(50, 18, -20).normalize();
    } else if (mode === 'night') {
      targetTop.set('#040714');
      targetMid.set('#081026');
      targetBottom.set('#111836');
      targetSun.set('#818cf8'); // Cool lunar glow
      targetSunGlow = 0.45;
      targetStarOpacity = 0.95;
      uniforms.uSunPos.value.set(20, 50, -30).normalize();
    } else if (mode === 'cloudy') {
      targetTop.set('#576574');
      targetMid.set('#8395a7');
      targetBottom.set('#c8d6e5');
      targetSun.set('#e2e8f0');
      targetSunGlow = 0.2;
      targetStarOpacity = 0.0;
      uniforms.uSunPos.value.set(30, 50, 20).normalize();
    } else {
      // Sunny golden daylight
      targetTop.set('#1e6091');
      targetMid.set('#72a9db');
      targetBottom.set('#fff2d1');
      targetSun.set('#fff7e6');
      targetSunGlow = 1.0;
      targetStarOpacity = 0.0;
      uniforms.uSunPos.value.set(40, 60, 30).normalize();
    }
  };

  const setTimeOfDay = (hour: number, isCloudy = false) => {
    if (isCloudy) {
      setMode('cloudy');
      return;
    }

    if (hour >= 5.5 && hour < 8.5) {
      setMode('dawn');
    } else if (hour >= 8.5 && hour < 16.5) {
      setMode('sunny');
    } else if (hour >= 16.5 && hour < 20.0) {
      setMode('sunset');
    } else {
      setMode('night');
    }

    // Continuous 24h orbital arc across the horizon
    if (hour >= 5.5 && hour <= 19.5) {
      // Day / Dawn / Sunset: Sun rises in East, peaks at noon, sets in West
      const progress = (hour - 5.5) / 14.0; // 0.0 at dawn, 0.5 at noon, 1.0 at dusk
      const angle = progress * Math.PI;
      const x = -Math.cos(angle) * 70;
      const y = Math.sin(angle) * 65; // Peaks high at noon, meets horizon at 5.5 & 19.5
      const z = 30;
      uniforms.uSunPos.value.set(x, y, z).normalize();
      targetSunGlow = Math.min(1.4, Math.sin(angle) * 1.5 + 0.2);
    } else {
      // Night: Sun is below the horizon; no sun disk in night sky
      targetSunGlow = 0.0;
      uniforms.uSunPos.value.set(20, 50, -30).normalize();
    }
  };

  const update = (timeSec: number) => {
    uniforms.uTime.value = timeSec;
    // Smooth transition lerp
    uniforms.uTopColor.value.lerp(targetTop, 0.04);
    uniforms.uMidColor.value.lerp(targetMid, 0.04);
    uniforms.uBottomColor.value.lerp(targetBottom, 0.04);
    uniforms.uSunColor.value.lerp(targetSun, 0.04);
    uniforms.uSunGlow.value += (targetSunGlow - uniforms.uSunGlow.value) * 0.04;

    starMat.opacity += (targetStarOpacity - starMat.opacity) * 0.04;
    // Twinkle effect
    if (starMat.opacity > 0.05) {
      starMat.size = 1.6 + Math.sin(timeSec * 4.0) * 0.4;
    }
  };

  return {
    mesh,
    setMode,
    setTimeOfDay,
    update,
    starsPoints,
  };
}

/**
 * Generates charming wild meadow florets (buttercups, daisies, clovers) scattered among the grass.
 * Uses organic stratified jitter up to 75m, avoiding flower clearances and eliminating banding.
 */
export function createWildMeadowFlorets(
  count: number = 1600,
  getTerrainHeight: (x: number, z: number) => number,
  getTerrainNormal: (x: number, z: number) => THREE.Vector3,
  isNearFlower?: (x: number, z: number, clearance: number) => boolean
): THREE.InstancedMesh {
  // Simple cute 5-petal star floret geometry
  const petalShape = new THREE.Shape();
  petalShape.moveTo(0, 0);
  for (let i = 0; i < 5; i++) {
    const a1 = (i / 5) * Math.PI * 2;
    const a2 = ((i + 0.5) / 5) * Math.PI * 2;
    const rOuter = 0.075;
    const rInner = 0.025;
    petalShape.lineTo(Math.cos(a1) * rOuter, Math.sin(a1) * rOuter);
    petalShape.lineTo(Math.cos(a2) * rInner, Math.sin(a2) * rInner);
  }
  const geom = new THREE.ShapeGeometry(petalShape);
  geom.rotateX(-Math.PI * 0.4);

  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.4,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(geom, mat, count);
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const colors = [
    new THREE.Color('#ffffff'), // White alpine daisy
    new THREE.Color('#fcd34d'), // Golden buttercup
    new THREE.Color('#f472b6'), // Wild pink clover
    new THREE.Color('#fef08a'), // Pale yellow
  ];

  let placed = 0;
  let ringR = 2.0;
  let ringIdx = 0;

  while (placed < count && ringR < 80.0) {
    const dR = ringR < 25.0 ? 1.6 : 2.5;
    const arc = ringR < 25.0 ? 1.8 : 3.0;
    const n = Math.max(4, Math.round((Math.PI * 2 * ringR) / arc));
    const startAngle = ((ringIdx * 43) % 100) * 0.0628;

    for (let j = 0; j < n && placed < count; j++) {
      const angleJitter = (((ringIdx * 31 + j * 17) % 79) / 79 - 0.5) * 0.8;
      const theta = startAngle + ((j + angleJitter) / n) * Math.PI * 2;
      const rJitter = (((j * 53 + ringIdx * 29) % 67) / 67 - 0.5) * dR * 0.8;
      const finalR = ringR + rJitter;

      let x = Math.cos(theta) * finalR;
      let z = Math.sin(theta) * finalR;

      // Low frequency organic warp
      x += Math.sin(x * 0.18 + z * 0.22) * 0.4;
      z += Math.cos(x * 0.12 - z * 0.16) * 0.4;

      if (isNearFlower && isNearFlower(x, z, 0.75)) {
        continue; // Keep flower beds clean
      }

      const y = getTerrainHeight(x, z) + 0.35 + (placed % 4) * 0.15;
      const norm = getTerrainNormal(x, z);

      dummy.position.set(x, y, z);
      const s = 0.85 + (placed % 4) * 0.2;
      dummy.scale.set(s, s, s);
      dummy.rotation.set(norm.z * 0.4, (placed * 1.3) % (Math.PI * 2), -norm.x * 0.4);
      dummy.updateMatrix();

      mesh.setMatrixAt(placed, dummy.matrix);
      mesh.setColorAt(placed, colors[placed % colors.length]);
      placed++;
    }

    ringR += dR;
    ringIdx++;
  }

  // If any remaining instances, set scale to 0
  while (placed < count) {
    dummy.position.set(0, -999, 0);
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return mesh;
}

