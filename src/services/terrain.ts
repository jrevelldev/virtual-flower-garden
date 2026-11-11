import * as THREE from 'three';
import { FlowerPlacement } from '../types/garden';

/**
 * Analytical terrain height function.
 * Used identically across terrain mesh generator, flower placement, and camera collision.
 */
export function getTerrainHeight(x: number, z: number): number {
  // Center is gently sloping meadow, with rolling hills expanding outward
  const d = Math.sqrt(x * x + z * z);
  const falloff = 1.0 - Math.exp(-d * 0.04); // flatter near center (0,0)

  const h1 = Math.sin(x * 0.05 + 0.3) * Math.cos(z * 0.05 - 0.2) * 2.2;
  const h2 = Math.sin(x * 0.12 - 0.7) * Math.sin(z * 0.14 + 0.5) * 1.0;
  const h3 = Math.cos((x + z) * 0.08) * 0.6;
  const outerBowl = (d * 0.02) ** 1.8 * 0.8;

  return (h1 + h2 + h3) * falloff + outerBowl;
}

/**
 * Calculates surface normal on terrain via finite differences.
 */
export function getTerrainNormal(x: number, z: number): THREE.Vector3 {
  const eps = 0.1;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);

  const normal = new THREE.Vector3(hL - hR, 2.0 * eps, hD - hU);
  return normal.normalize();
}

/**
 * Pseudo-random deterministic hash from two integers.
 * Returns float in [0, 1).
 */
export function hash2D(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296.0;
}

/**
 * Calculates deterministic placement for a flower slot index.
 * Uses golden spiral (Fermat's spiral / phyllotaxis) with bounded jitter.
 * Properties:
 * - Slot n placement is 100% deterministic and never changes when new flowers are added.
 * - Naturally expands outward from the center as the garden grows.
 * - Generous spacing (>= 5.0m) prevents petal clipping both in 3D and in camera perspective.
 */
function getRawSlotPosition(slotIndex: number, seed: number): { x: number; z: number } {
  const spacing = 5.2; // Generous distance scaling so flower heads have complete breathing room
  const goldenAngle = 2.39996323; // ~137.50776 degrees in radians

  const baseR = spacing * Math.sqrt(slotIndex + 1.2);
  const baseTheta = (slotIndex + 1) * goldenAngle;

  // Controlled organic jitter
  const jR = (hash2D(slotIndex, seed) - 0.5) * 0.18 * spacing;
  const jTheta = (hash2D(seed, slotIndex) - 0.5) * 0.10;

  const r = Math.max(2.5, baseR + jR);
  const theta = baseTheta + jTheta;

  return {
    x: Math.cos(theta) * r,
    z: Math.sin(theta) * r,
  };
}

export function calculateSlotPlacement(slotIndex: number, seed: number = 42): FlowerPlacement {
  const minClearance = 5.0; // Strict clearance so petals never collide, overlap or clip
  let { x, z } = getRawSlotPosition(slotIndex, seed);

  // Deterministic multi-pass collision clearance check against preceding slots
  if (slotIndex > 0) {
    const maxLookback = Math.min(slotIndex, 100);
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let k = 0; k < maxLookback; k++) {
        const prevPos = getRawSlotPosition(k, 42 + (k % 14) * 101);
        let dx = x - prevPos.x;
        let dz = z - prevPos.z;
        let dist = Math.hypot(dx, dz);
        if (dist < minClearance) {
          if (dist < 0.001) {
            dx = 1.0;
            dz = 0.0;
            dist = 1.0;
          }
          const push = (minClearance - dist) + 0.2;
          x += (dx / dist) * push;
          z += (dz / dist) * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  const y = getTerrainHeight(x, z);

  // Random gentle orientation and scale variation
  const rotationY = hash2D(slotIndex + 101, seed) * Math.PI * 2;
  const scale = 0.88 + hash2D(slotIndex + 202, seed) * 0.22; // 0.88 to 1.10

  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    z: Math.round(z * 100) / 100,
    rotationY: Math.round(rotationY * 100) / 100,
    scale: Math.round(scale * 100) / 100,
    slotIndex,
  };
}

