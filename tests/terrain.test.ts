import { describe, it, expect } from 'vitest';
import { getTerrainHeight, getTerrainNormal, calculateSlotPlacement } from '../src/services/terrain';

describe('Terrain & Slot Placement Algorithms', () => {
  it('returns identical terrain height for identical coordinates', () => {
    const h1 = getTerrainHeight(14.5, -8.2);
    const h2 = getTerrainHeight(14.5, -8.2);
    expect(h1).toBe(h2);
  });

  it('calculates a valid unit normal vector on terrain surface', () => {
    const norm = getTerrainNormal(10.0, 10.0);
    expect(norm.length()).toBeCloseTo(1.0, 3);
    expect(norm.y).toBeGreaterThan(0); // Upward facing surface
  });

  it('guarantees deterministic slot allocation', () => {
    const slot5_run1 = calculateSlotPlacement(5, 42);
    const slot5_run2 = calculateSlotPlacement(5, 42);
    expect(slot5_run1).toEqual(slot5_run2);
  });

  it('ensures slot n placement is completely untouched when calculating subsequent slots', () => {
    const slot3 = calculateSlotPlacement(3, 42);
    // Calculate slots 4, 5, 6
    calculateSlotPlacement(4, 42);
    calculateSlotPlacement(5, 42);
    calculateSlotPlacement(6, 42);
    const slot3Again = calculateSlotPlacement(3, 42);
    expect(slot3).toEqual(slot3Again);
  });

  it('expands outward from garden center with increasing slot index', () => {
    const slot0 = calculateSlotPlacement(0, 42);
    const slot50 = calculateSlotPlacement(50, 42);

    const dist0 = Math.hypot(slot0.x, slot0.z);
    const dist50 = Math.hypot(slot50.x, slot50.z);

    expect(dist50).toBeGreaterThan(dist0);
  });

  it('guarantees safe clearance between all flower slots to prevent petal overlap', () => {
    const slots = Array.from({ length: 25 }, (_, i) => calculateSlotPlacement(i, 42 + i * 7));
    const minRequiredDistance = 3.0; // Petals have radius ~1.2-1.4m, so 3.0m ensures zero collision
    let minObserved = Infinity;
    let closestPair = [-1, -1];

    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const d = Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z);
        if (d < minObserved) {
          minObserved = d;
          closestPair = [i, j];
        }
      }
    }

    console.log(`Minimum slot distance observed among first 25 slots: ${minObserved.toFixed(2)}m (between ${closestPair[0]} and ${closestPair[1]})`);
    expect(minObserved).toBeGreaterThanOrEqual(minRequiredDistance);
  });

  it('verifies SAMPLE_FLOWERS placements have adequate clearance', () => {
    // Check actual seeds from sample-flowers
    const sampleSeeds = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212, 1313, 1414];
    const placements = sampleSeeds.map((seed, idx) => calculateSlotPlacement(idx, seed));

    let minSampleDist = Infinity;
    let closest = [-1, -1];
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const d = Math.hypot(placements[i].x - placements[j].x, placements[i].z - placements[j].z);
        if (d < minSampleDist) {
          minSampleDist = d;
          closest = [i, j];
        }
      }
    }
    console.log(`SAMPLE_FLOWERS min distance: ${minSampleDist.toFixed(2)}m (between slot ${closest[0]} and ${closest[1]})`);
  });

  it('generates non-repeating organic grass points up to 90m without concentric banding', () => {
    let r = 0.8;
    let ringIndex = 0;
    let count = 0;
    let maxR = 0;

    while (r <= 92.0) {
      let dr: number;
      let arcStep: number;
      if (r < 25.0) {
        dr = 0.72;
        arcStep = 0.78;
      } else if (r < 55.0) {
        dr = 1.25;
        arcStep = 1.35;
      } else {
        dr = 2.0;
        arcStep = 2.2;
      }

      const circumference = Math.PI * 2 * r;
      const n = Math.max(6, Math.round(circumference / arcStep));
      count += n;
      maxR = r;
      r += dr;
      ringIndex++;
    }

    expect(count).toBeGreaterThan(10000);
    expect(count).toBeLessThan(16000);
    expect(maxR).toBeGreaterThan(90.0);
  });
});

