import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FlowerDesign, PetalShape } from '../types/garden';

/**
 * Creates 2D curve shape for a single petal based on PetalShape type.
 */
export function createPetalShapePath(
  shape: PetalShape,
  length: number,
  width: number
): THREE.Shape {
  const s = new THREE.Shape();
  const halfW = width * 0.5;

  s.moveTo(0, 0);

  switch (shape) {
    case 'rounded': {
      // Smooth oval/ellipse profile
      s.bezierCurveTo(halfW * 0.8, length * 0.25, halfW, length * 0.65, halfW * 0.4, length * 0.95);
      s.quadraticCurveTo(0, length, -halfW * 0.4, length * 0.95);
      s.bezierCurveTo(-halfW, length * 0.65, -halfW * 0.8, length * 0.25, 0, 0);
      break;
    }

    case 'pointed': {
      // Lanceolate with distinct sharp tip
      s.bezierCurveTo(halfW * 0.9, length * 0.3, halfW * 0.7, length * 0.7, 0, length);
      s.bezierCurveTo(-halfW * 0.7, length * 0.7, -halfW * 0.9, length * 0.3, 0, 0);
      break;
    }

    case 'teardrop': {
      // Narrow base expanding to a bulbous upper half
      s.bezierCurveTo(halfW * 0.3, length * 0.2, halfW * 1.1, length * 0.7, halfW * 0.3, length);
      s.bezierCurveTo(0, length * 1.05, -halfW * 0.3, length, -halfW * 1.1, length * 0.7);
      s.bezierCurveTo(-halfW * 0.3, length * 0.2, 0, 0, 0, 0);
      break;
    }

    case 'heart': {
      // Notched indented apex
      s.bezierCurveTo(halfW * 0.8, length * 0.3, halfW * 1.1, length * 0.8, halfW * 0.5, length);
      s.quadraticCurveTo(halfW * 0.2, length * 1.02, 0, length * 0.88); // Notch dip
      s.quadraticCurveTo(-halfW * 0.2, length * 1.02, -halfW * 0.5, length);
      s.bezierCurveTo(-halfW * 1.1, length * 0.8, -halfW * 0.8, length * 0.3, 0, 0);
      break;
    }

    case 'ruffled': {
      // Sinusoidal scalloped / wavy edge
      const steps = 14;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const wave = Math.sin(t * Math.PI * 6) * (halfW * 0.18);
        const w = (Math.sin(t * Math.PI) * halfW) + wave;
        const y = t * length;
        s.lineTo(w, y);
      }
      for (let i = steps; i >= 0; i--) {
        const t = i / steps;
        const wave = Math.sin(t * Math.PI * 6) * (halfW * 0.18);
        const w = (-Math.sin(t * Math.PI) * halfW) - wave;
        const y = t * length;
        s.lineTo(w, y);
      }
      break;
    }
  }

  return s;
}

/**
 * Builds 3D parametric petal geometry with curvature bending along the Y axis.
 */
export function buildPetalGeometry(
  shape: PetalShape,
  length: number,
  width: number,
  curvature: number,
  imperfection: number = 0.35
): THREE.BufferGeometry {
  const shapePath = createPetalShapePath(shape, length, width);
  // ShapeGeometry with subdivisions
  const baseGeom = new THREE.ShapeGeometry(shapePath, 16);

  // Apply 3D cupping/curvature along Y and X
  const posAttr = baseGeom.attributes.position;
  const count = posAttr.count;

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const normalizedY = Math.min(1.0, Math.max(0.0, y / length));
    const normalizedX = (x / (width * 0.5));

    // Arch along the length: curvature affects Z
    // Positive curvature rolls backward/down; negative cups inward/forward
    const zBend = Math.sin(normalizedY * Math.PI) * (curvature * 0.45 * length);
    // Transverse cup (cross-section curl)
    const crossCurl = (normalizedX * normalizedX) * (curvature * 0.15 * width);

    // Subtle natural organic surface ripple / tissue fluting
    const surfaceRipple = Math.sin(normalizedY * Math.PI * 4.0 + normalizedX * 2.5) * (0.012 * width * imperfection);

    posAttr.setZ(i, zBend + crossCurl + surfaceRipple);
  }

  baseGeom.computeVertexNormals();
  return baseGeom;
}

/**
 * Creates leaf geometry.
 */
function createLeafGeometry(size: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const w = size * 0.35;
  const l = size;

  s.moveTo(0, 0);
  s.bezierCurveTo(w, l * 0.3, w * 0.8, l * 0.7, 0, l);
  s.bezierCurveTo(-w * 0.8, l * 0.7, -w, l * 0.3, 0, 0);

  const geom = new THREE.ShapeGeometry(s, 10);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const ny = y / l;
    // Leaf gentle droop
    pos.setZ(i, -Math.sin(ny * Math.PI * 0.8) * 0.15 * size);
  }
  geom.computeVertexNormals();
  return geom;
}

export interface GeneratedFlowerInstance {
  rootGroup: THREE.Group;
  headGroup: THREE.Group;
  stemMesh: THREE.Mesh;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  height: number;
  dispose: () => void;
  updateWind: (time: number, windStrength?: number) => void;
  setBloomProgress: (progress: number) => void;
  setAestheticMode: (mode: 'meadow' | 'filament') => void;
}

/**
 * Generates a complete 3D flower deterministically from FlowerDesign.
 */
export function generateFlowerObject(
  design: FlowerDesign,
  seed: number = 1
): GeneratedFlowerInstance {
  const rootGroup = new THREE.Group();
  rootGroup.name = `flower_seed_${seed}`;

  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  // Seeded PRNG for subtle natural deviations
  let localSeed = seed;
  const random = () => {
    localSeed = (localSeed * 1664525 + 1013904223) % 4294967296;
    return localSeed / 4294967296;
  };

  const imperfection = design.imperfection !== undefined ? design.imperfection : 0.35;

  const primaryColor = new THREE.Color(design.primaryColor);
  const secondaryColor = new THREE.Color(design.secondaryColor);
  const centerColor = new THREE.Color(design.centerColor);
  const stemColor = new THREE.Color(design.stemColor || '#3e6b36');

  // Petal Material with subtle sheen and double-sided rendering
  const petalMaterial = new THREE.MeshStandardMaterial({
    color: primaryColor,
    roughness: 0.38,
    metalness: 0.08,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  });
  materials.push(petalMaterial);

  // Secondary layer / inner petal material with blended color
  const innerPetalMaterial = new THREE.MeshStandardMaterial({
    color: primaryColor.clone().lerp(secondaryColor, 0.45),
    roughness: 0.35,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  materials.push(innerPetalMaterial);

  // Center / Stamen Material with warm emissive touch
  const centerMaterial = new THREE.MeshStandardMaterial({
    color: centerColor,
    roughness: 0.5,
    metalness: 0.1,
    emissive: centerColor.clone().multiplyScalar(0.18),
  });
  materials.push(centerMaterial);

  // Stem & Leaves Material
  const stemMaterial = new THREE.MeshStandardMaterial({
    color: stemColor,
    roughness: 0.6,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  materials.push(stemMaterial);

  // Leaf Material
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: stemColor.clone().lerp(new THREE.Color('#5a8f42'), 0.3),
    roughness: 0.45,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  materials.push(leafMaterial);

  // 1. Build Stem
  const stemHeight = Math.max(0.6, design.stemHeight);
  const stemPoints: THREE.Vector3[] = [];
  const segments = 12;

  // Gentle organic lean and meandering curvature based on imperfection
  const leanAngle = (random() - 0.5) * (0.2 + 0.3 * imperfection);
  const leanDir = random() * Math.PI * 2;
  const leanX = Math.cos(leanDir) * leanAngle;
  const leanZ = Math.sin(leanDir) * leanAngle;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t * stemHeight;
    // S-curve slight bend with natural organic wave
    const bend = (Math.sin(t * Math.PI) + Math.sin(t * Math.PI * 2) * 0.25 * imperfection) * 0.12;
    const x = t * leanX + bend * Math.cos(leanDir);
    const z = t * leanZ + bend * Math.sin(leanDir);
    stemPoints.push(new THREE.Vector3(x, y, z));
  }

  const stemCurve = new THREE.CatmullRomCurve3(stemPoints);
  const stemRadius = 0.038 * Math.min(1.2, stemHeight);
  const stemGeom = new THREE.TubeGeometry(stemCurve, 16, stemRadius, 8, false);
  geometries.push(stemGeom);

  const stemMesh = new THREE.Mesh(stemGeom, stemMaterial);
  stemMesh.castShadow = true;
  stemMesh.receiveShadow = true;
  rootGroup.add(stemMesh);

  // 2. Build Leaves along the stem (merged into single mesh)
  const leafCount = Math.max(0, Math.min(6, design.leafCount));
  const baseLeafGeom = createLeafGeometry(design.leafSize || 0.8);
  const leafGeoms: THREE.BufferGeometry[] = [];

  for (let i = 0; i < leafCount; i++) {
    const t = 0.22 + (i / Math.max(1, leafCount)) * 0.55;
    const point = stemCurve.getPointAt(t);
    const leafAngle = (i * 2.4) + random() * 0.4;
    const rotX = 0.6 + random() * 0.25;
    const rotZ = (random() - 0.5) * 0.2;
    const leafScale = 0.7 + random() * 0.4;

    const lGeom = baseLeafGeom.clone();
    lGeom.scale(leafScale, leafScale, leafScale);
    lGeom.rotateX(rotX);
    lGeom.rotateZ(rotZ);
    lGeom.rotateY(leafAngle);
    lGeom.translate(point.x, point.y, point.z);
    leafGeoms.push(lGeom);
  }

  baseLeafGeom.dispose();
  if (leafGeoms.length > 0) {
    const mergedLeaves = BufferGeometryUtils.mergeGeometries(leafGeoms, false);
    geometries.push(mergedLeaves);
    leafGeoms.forEach((g) => g.dispose());

    const leavesMesh = new THREE.Mesh(mergedLeaves, leafMaterial);
    leavesMesh.castShadow = true;
    rootGroup.add(leavesMesh);
  }

  // 3. Flower Head (positioned at top of stem)
  const headGroup = new THREE.Group();
  const topPoint = stemCurve.getPointAt(1.0);
  headGroup.position.copy(topPoint);

  // Receptacle / Center disk & dome
  const centerRadius = 0.14 * design.petalWidth;
  const centerGeom = new THREE.SphereGeometry(centerRadius, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  geometries.push(centerGeom);

  const centerMesh = new THREE.Mesh(centerGeom, centerMaterial);
  centerMesh.position.y = 0.02;
  headGroup.add(centerMesh);

  // Secondary stamen ring / center detail
  const ringGeom = new THREE.TorusGeometry(centerRadius * 0.7, centerRadius * 0.18, 8, 16);
  geometries.push(ringGeom);
  const ringMesh = new THREE.Mesh(ringGeom, centerMaterial);
  ringMesh.rotation.x = Math.PI * 0.5;
  ringMesh.position.y = 0.04;
  headGroup.add(ringMesh);

  // Filament mode group (Reference 2 digital sculpture elements)
  const filamentGroup = new THREE.Group();
  filamentGroup.name = 'filament_sculpture_elements';
  filamentGroup.visible = false;
  headGroup.add(filamentGroup);

  // Floating bioluminescent ember particles
  const emberCount = 20;
  const emberGeom = new THREE.BufferGeometry();
  const emberPositions = new Float32Array(emberCount * 3);
  for (let e = 0; e < emberCount; e++) {
    const angle = random() * Math.PI * 2;
    const r = random() * centerRadius * 1.8;
    emberPositions[e * 3] = Math.cos(angle) * r;
    emberPositions[e * 3 + 1] = 0.05 + random() * 0.4;
    emberPositions[e * 3 + 2] = Math.sin(angle) * r;
  }
  emberGeom.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  geometries.push(emberGeom);

  const emberMaterial = new THREE.PointsMaterial({
    color: '#ffeaa7',
    size: 0.06,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
  });
  materials.push(emberMaterial);

  const emberPoints = new THREE.Points(emberGeom, emberMaterial);
  filamentGroup.add(emberPoints);
  const basePetalGeom = buildPetalGeometry(
    design.petalShape,
    design.petalLength,
    design.petalWidth,
    design.petalCurvature,
    imperfection
  );

  const layers = Math.max(1, Math.min(3, design.petalLayers));
  const baseCount = Math.max(4, Math.min(24, design.petalCount));

  for (let layer = 0; layer < layers; layer++) {
    const layerMat = layer === 0 ? petalMaterial : innerPetalMaterial;
    const scaleFactor = 1.0 - layer * 0.18;
    const heightOffset = layer * 0.025;
    const angleOffset = (layer * Math.PI) / baseCount;
    const pitchOffset = layer * 0.14;
    const petalsInLayer = layer === 0 ? baseCount : Math.max(4, Math.round(baseCount * 0.85));

    const layerPetalGeoms: THREE.BufferGeometry[] = [];

    for (let p = 0; p < petalsInLayer; p++) {
      const angle = (p / petalsInLayer) * Math.PI * 2 + angleOffset;
      const baseTilt = 0.95 - pitchOffset;

      // Deterministic natural organic perturbations
      const jitterAngle = (random() - 0.5) * 0.16 * imperfection;
      const jitterTilt = (random() - 0.5) * 0.32 * imperfection;
      const jitterRoll = (random() - 0.5) * 0.22 * imperfection;
      const jitterScale = 1.0 + (random() - 0.5) * 0.22 * imperfection;
      const jitterHeight = (random() - 0.5) * 0.03 * imperfection;

      const pGeom = basePetalGeom.clone();
      // Apply transforms with organic variety
      const s = scaleFactor * jitterScale;
      pGeom.scale(s, s, s);
      pGeom.rotateZ(jitterRoll);
      pGeom.rotateX(baseTilt + jitterTilt);
      pGeom.translate(0, heightOffset + jitterHeight, centerRadius * 0.75);
      pGeom.rotateY(angle + jitterAngle);

      layerPetalGeoms.push(pGeom);
    }

    if (layerPetalGeoms.length > 0) {
      const mergedPetals = BufferGeometryUtils.mergeGeometries(layerPetalGeoms, false);
      geometries.push(mergedPetals);
      layerPetalGeoms.forEach((g) => g.dispose());

      const layerMesh = new THREE.Mesh(mergedPetals, layerMat);
      layerMesh.castShadow = true;
      layerMesh.receiveShadow = true;
      headGroup.add(layerMesh);

      // Create luminous wireframe filament contour
      const wireGeom = new THREE.WireframeGeometry(mergedPetals);
      geometries.push(wireGeom);
      const wireMat = new THREE.LineBasicMaterial({
        color: (layer === 0 ? primaryColor : secondaryColor).clone().offsetHSL(0, 0.1, 0.25),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      });
      materials.push(wireMat);
      const wireLines = new THREE.LineSegments(wireGeom, wireMat);
      filamentGroup.add(wireLines);
    }
  }

  basePetalGeom.dispose();

  // Natural gentle forward nod so flower face is oriented beautifully toward viewer
  const baseHeadTiltX = 0.22;
  headGroup.rotation.x = baseHeadTiltX;
  headGroup.rotation.z = leanZ * 0.3;

  rootGroup.add(headGroup);

  // Animation controller
  const phase = seed * 1.337;
  const updateWind = (time: number, windStrength: number = 1.0) => {
    const t = time * 1.5 + phase;
    // Gentle sway on root and head
    const swayX = (Math.sin(t) * 0.045 + Math.sin(t * 2.3) * 0.02) * windStrength;
    const swayZ = (Math.cos(t * 0.9) * 0.045 + Math.cos(t * 1.7) * 0.02) * windStrength;

    rootGroup.rotation.x = swayX;
    rootGroup.rotation.z = swayZ;

    headGroup.rotation.x = baseHeadTiltX + swayX * 0.5;
    headGroup.rotation.z = (leanZ * 0.3) + swayZ * 0.5;
  };

  const setAestheticMode = (mode: 'meadow' | 'filament') => {
    if (mode === 'filament') {
      filamentGroup.visible = true;
      petalMaterial.transparent = true;
      petalMaterial.opacity = 0.55;
      petalMaterial.roughness = 0.12;
      petalMaterial.metalness = 0.85;
      petalMaterial.emissive.copy(primaryColor).multiplyScalar(0.4);

      innerPetalMaterial.transparent = true;
      innerPetalMaterial.opacity = 0.5;
      innerPetalMaterial.emissive.copy(secondaryColor).multiplyScalar(0.4);

      centerMaterial.emissive.copy(centerColor).multiplyScalar(0.9);
      stemMaterial.emissive.setHex(0x1a331a);
    } else {
      filamentGroup.visible = false;
      petalMaterial.transparent = false;
      petalMaterial.opacity = 1.0;
      petalMaterial.roughness = 0.38;
      petalMaterial.metalness = 0.08;
      petalMaterial.emissive.setHex(0x000000);

      innerPetalMaterial.transparent = false;
      innerPetalMaterial.opacity = 1.0;
      innerPetalMaterial.emissive.setHex(0x000000);

      centerMaterial.emissive.copy(centerColor).multiplyScalar(0.18);
      stemMaterial.emissive.setHex(0x000000);
    }
    petalMaterial.needsUpdate = true;
    innerPetalMaterial.needsUpdate = true;
    centerMaterial.needsUpdate = true;
    stemMaterial.needsUpdate = true;
  };

  const setBloomProgress = (progress: number) => {
    // 0 = closed bud / tiny, 1 = fully bloomed
    const p = Math.max(0.01, Math.min(1.0, progress));
    headGroup.scale.set(p, p, p);
  };

  const dispose = () => {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  };

  return {
    rootGroup,
    headGroup,
    stemMesh,
    materials,
    geometries,
    height: stemHeight + design.petalLength * 0.6,
    dispose,
    updateWind,
    setBloomProgress,
    setAestheticMode,
  };
}
