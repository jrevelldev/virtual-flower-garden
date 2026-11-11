import { describe, it, expect } from 'vitest';
import { PetalShape } from '../src/types/garden';
import { buildPetalGeometry, generateFlowerObject } from '../src/flower/flower-generator';

describe('Procedural Flower Generator', () => {
  const shapes: PetalShape[] = ['rounded', 'pointed', 'teardrop', 'heart', 'ruffled'];

  shapes.forEach((shape) => {
    it(`builds valid 3D geometry for ${shape} petal shape`, () => {
      const geom = buildPetalGeometry(shape, 1.4, 0.8, -0.2);
      expect(geom.attributes.position.count).toBeGreaterThan(0);
      expect(geom.attributes.normal.count).toBeGreaterThan(0);
      geom.dispose();
    });
  });

  it('generates a complete flower hierarchy with stem, leaves, and petals', () => {
    const flower = generateFlowerObject(
      {
        petalShape: 'heart',
        petalCount: 12,
        petalLayers: 2,
        primaryColor: '#e84393',
        secondaryColor: '#fd79a8',
        centerColor: '#ffeaa7',
        stemColor: '#2d6a4f',
        petalLength: 1.3,
        petalWidth: 0.9,
        petalCurvature: -0.2,
        stemHeight: 1.8,
        leafCount: 4,
        leafSize: 0.8,
      },
      777
    );

    expect(flower.rootGroup.children.length).toBeGreaterThan(1);
    expect(flower.headGroup).toBeDefined();
    expect(flower.stemMesh).toBeDefined();

    // Verify wind update does not throw
    expect(() => flower.updateWind(1.5, 0.8)).not.toThrow();

    // Verify bloom progress update does not throw
    expect(() => flower.setBloomProgress(0.5)).not.toThrow();

    // Clean disposal
    expect(() => flower.dispose()).not.toThrow();
  });
});

