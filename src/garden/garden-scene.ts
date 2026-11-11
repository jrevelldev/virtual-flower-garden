import * as THREE from 'three';
import { PublicFlower, GardenWeather } from '../types/garden';
import { GeneratedFlowerInstance, generateFlowerObject } from '../flower/flower-generator';
import { getTerrainHeight, getTerrainNormal, hash2D } from '../services/terrain';
import { GardenCameraController } from './camera-controller';
import {
  createAtmosphericSkyDome,
  createMeadowGroundTexture,
  createWildMeadowFlorets,
} from './meadow-atmosphere';

export interface GardenSceneCallbacks {
  onFlowerSelected?: (flower: PublicFlower) => void;
  onRevealStart?: (flower: PublicFlower) => void;
  onRevealEnd?: (flower: PublicFlower) => void;
  onModeChange?: (mode: string) => void;
  onQueueUpdate?: (queueLength: number) => void;
  onStatsUpdate?: (fps: number, drawCalls: number, flowerCount: number) => void;
  onWeatherChange?: (
    weather: GardenWeather,
    activeState: 'sunny' | 'cloudy' | 'night' | 'dawn' | 'sunset',
    hour?: number
  ) => void;
}

export class GardenScene {
  public container: HTMLElement;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public cameraController: GardenCameraController;

  private flowers = new Map<string, { flower: PublicFlower; instance: GeneratedFlowerInstance; bloomAnim?: number }>();
  private flowerRaycastMeshes: { mesh: THREE.Mesh; flower: PublicFlower }[] = [];
  private grassInstancedMesh: THREE.InstancedMesh | null = null;
  private grassMaterial: THREE.MeshStandardMaterial | null = null;
  private grassInstanceData: {
    x: number;
    y: number;
    z: number;
    baseSx: number;
    baseSy: number;
    baseSz: number;
    rotX: number;
    rotY: number;
    rotZ: number;
    currentHeightFactor: number;
  }[] = [];
  private wildFloretsMesh: THREE.InstancedMesh | null = null;
  private skyDome: ReturnType<typeof createAtmosphericSkyDome> | null = null;
  private terrainMesh: THREE.Mesh | null = null;
  private groundTexture: THREE.CanvasTexture | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private rimLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private ambLight: THREE.AmbientLight | null = null;
  public aestheticMode: 'meadow' | 'filament' = 'meadow';

  // Weather & Time of Day System
  public weather: GardenWeather = 'auto';
  public currentHour: number = 12.0;
  public activeWeatherState: 'sunny' | 'cloudy' | 'night' | 'dawn' | 'sunset' = 'sunny';
  private targetBgColor = new THREE.Color('#dceefb');
  private targetFogColor = new THREE.Color('#cce4f7');
  private targetFogDensity = 0.009;
  private targetSunColor = new THREE.Color('#fff3d6');
  private targetSunIntensity = 2.4;
  private targetSunPos = new THREE.Vector3(40, 60, 30);
  private targetRimColor = new THREE.Color('#ffeaa7');
  private targetRimIntensity = 0.85;
  private targetHemiSkyColor = new THREE.Color('#93c5fd');
  private targetHemiGroundColor = new THREE.Color('#365314');
  private targetHemiIntensity = 1.1;
  private targetAmbColor = new THREE.Color('#ffeacc');
  private targetAmbIntensity = 0.55;
  private targetFairyOpacity = 0.0;
  private currentFairyOpacity = 0.0;

  // Fairy Particles System (Night Magic Fireflies)
  private fairyPoints: THREE.Points | null = null;
  private fairyMaterial: THREE.PointsMaterial | null = null;
  private fairyPositions: Float32Array | null = null;
  private fairyInitialY: Float32Array | null = null;
  private fairyPhases: Float32Array | null = null;

  // Grass Wind Uniform
  private grassWindTime = { value: 0 };
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private animFrameId: number | null = null;
  private lastTime = 0;
  private frameCount = 0;
  private fpsTimer = 0;
  private currentFps = 60;
  private isDestroyed = false;

  private callbacks: GardenSceneCallbacks;

  constructor(container: HTMLElement, callbacks: GardenSceneCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    // 1. Scene & Fog
    this.scene = new THREE.Scene();
    // Warm golden-hour meadow sky and atmospheric distance
    this.scene.background = new THREE.Color('#e0ebf5');
    this.scene.fog = new THREE.FogExp2('#d5e5f2', 0.012);

    // 2. Camera
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 400);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(this.renderer.domElement);

    // 4. Camera Controller
    this.cameraController = new GardenCameraController(this.camera, this.renderer.domElement, {
      onModeChange: (m) => this.callbacks.onModeChange?.(m),
      onRevealStart: (f) => {
        this.triggerBloomAnimation(f.id);
        this.callbacks.onRevealStart?.(f);
      },
      onRevealEnd: (f) => this.callbacks.onRevealEnd?.(f),
      onQueueUpdate: (q) => this.callbacks.onQueueUpdate?.(q),
    });

    // 5. Environment & Terrain
    this.setupLighting();
    this.buildAtmosphere();
    this.buildTerrain();
    this.buildInstancedGrass();
    this.buildFairyParticles();
    this.setWeather('auto', false);

    // 6. Interaction
    this.bindInteractions();

    // 7. Start render loop
    this.lastTime = performance.now();
    this.renderLoop = this.renderLoop.bind(this);
    this.animFrameId = requestAnimationFrame(this.renderLoop);

    window.addEventListener('resize', this.onResize);
  }

  private setupLighting(): void {
    // Warm golden sunlight
    this.sunLight = new THREE.DirectionalLight('#fff1d0', 2.2);
    this.sunLight.position.set(40, 60, 30);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 160;
    this.sunLight.shadow.camera.left = -45;
    this.sunLight.shadow.camera.right = 45;
    this.sunLight.shadow.camera.top = 45;
    this.sunLight.shadow.camera.bottom = -45;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    // Warm luminous rim backlight for grass & petal halo
    this.rimLight = new THREE.DirectionalLight('#ffeaa7', 0.85);
    this.rimLight.position.set(-35, 30, -35);
    this.scene.add(this.rimLight);

    // Soft sky / ground bounce light
    this.hemiLight = new THREE.HemisphereLight('#cbe5ff', '#3d4d29', 1.0);
    this.scene.add(this.hemiLight);

    // Ambient fill
    this.ambLight = new THREE.AmbientLight('#ffeacc', 0.5);
    this.scene.add(this.ambLight);
  }

  private buildAtmosphere(): void {
    // Panoramic atmospheric Sky Dome with sun corona glow and celestial starfield
    this.skyDome = createAtmosphericSkyDome();
    this.scene.add(this.skyDome.mesh);
    this.scene.add(this.skyDome.starsPoints);

    // Wild meadow florets (1,600 buttercups, daisies, and clovers peeking through grass)
    this.wildFloretsMesh = createWildMeadowFlorets(
      1600,
      getTerrainHeight,
      getTerrainNormal,
      (x, z, clearance) => {
        for (const f of this.flowers.values()) {
          if (Math.hypot(x - f.flower.placement.x, z - f.flower.placement.z) < clearance) {
            return true;
          }
        }
        return false;
      }
    );
    this.scene.add(this.wildFloretsMesh);
  }

  private buildTerrain(): void {
    const size = 180;
    const segments = 120;
    const geom = new THREE.PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI * 0.5);

    const pos = geom.attributes.position;
    const colors: number[] = [];

    const cCenter = new THREE.Color('#4a7c36');
    const cHigh = new THREE.Color('#386427');
    const cLow = new THREE.Color('#58873f');
    const cPath = new THREE.Color('#789c4d');

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = getTerrainHeight(x, z);
      pos.setY(i, y);

      // Subtle meadow color variation
      const dist = Math.sqrt(x * x + z * z);
      const col = cCenter.clone();
      if (y > 3) col.lerp(cHigh, Math.min(1, (y - 3) * 0.3));
      else if (y < 0) col.lerp(cLow, Math.min(1, -y * 0.4));
      if (dist < 12) col.lerp(cPath, 0.25);

      colors.push(col.r, col.g, col.b);
    }

    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    this.groundTexture = createMeadowGroundTexture();

    const mat = new THREE.MeshStandardMaterial({
      map: this.groundTexture,
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.04,
      flatShading: false,
    });

    this.terrainMesh = new THREE.Mesh(geom, mat);
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
  }

  private buildInstancedGrass(): void {
    // Stylized 6-blade curved tall grass clump
    const clumpGeom = this.createCuteGrassClumpGeometry();

    this.grassMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.65,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });

    // Custom GPU wind vertex shader for natural meadow wave sway
    this.grassMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.grassWindTime;
      shader.vertexShader = `
        uniform float uTime;
        ${shader.vertexShader}
      `;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 wPos = instanceMatrix[3].xyz;
        #else
        vec3 wPos = position;
        #endif

        // Prevailing wind direction across meadow
        vec2 windDir = normalize(vec2(0.85, 0.52));
        vec2 perpDir = vec2(-windDir.y, windDir.x);

        // Coordinate along traveling wind wave
        float windCoord = dot(wPos.xz, windDir);

        // 1. Primary traveling rolling gust wave (creates visible waves traveling across the field)
        float mainGust = sin(uTime * 1.35 - windCoord * 0.065);
        mainGust = pow(mainGust * 0.5 + 0.5, 1.8); // Natural gust crests and gentle lulls

        // 2. Secondary turbulent cross-wind ripple
        float crossWave = sin(uTime * 2.2 + dot(wPos.xz, perpDir) * 0.14) * 0.22;

        // 3. High-frequency feathery flutter on tips
        float microFlutter = sin(uTime * 4.6 + wPos.x * 0.8 + wPos.z * 1.1) * 0.08;

        // 4. Per-instance unique phase offset (breaks any clump-to-clump synchrony)
        float instancePhase = sin(wPos.x * 13.7 + wPos.z * 19.3) * 0.16;

        // Total directional deflection (with natural resting lean in wind direction)
        float totalDeflect = 0.09 + (mainGust * 0.36 + crossWave + microFlutter + instancePhase);

        // Flexible stem bending physics: roots are rigid, tips flex organically
        float h = clamp(position.y / 1.35, 0.0, 1.0);
        float bendFactor = pow(h, 1.75);

        // Deflect along wind and perpendicular eddy
        transformed.x += (windDir.x * totalDeflect + perpDir.x * crossWave * 0.5) * bendFactor;
        transformed.z += (windDir.y * totalDeflect + perpDir.y * crossWave * 0.5) * bendFactor;

        // Arc length conservation: blade tips naturally dip in Y when bent by wind
        transformed.y -= (totalDeflect * totalDeflect) * 0.22 * bendFactor;
        `
      );
    };

    // Generate organic stratified jittered candidates from r=0.8m all the way to r=92.0m (eliminates banding & fills horizon)
    interface Candidate {
      x: number;
      z: number;
      scaleBase: number;
      heightScale: number;
    }
    const candidates: Candidate[] = [];

    let r = 0.8;
    let ringIndex = 0;

    while (r <= 92.0) {
      let dr: number;
      let arcStep: number;
      if (r < 25.0) {
        dr = 0.70;
        arcStep = 0.75;
      } else if (r < 55.0) {
        dr = 1.20;
        arcStep = 1.30;
      } else {
        dr = 1.95;
        arcStep = 2.15;
      }

      const circumference = Math.PI * 2 * r;
      const n = Math.max(6, Math.round(circumference / arcStep));
      const startTheta = hash2D(ringIndex * 37 + 11, 809) * Math.PI * 2;

      for (let j = 0; j < n; j++) {
        const jTheta = (hash2D(ringIndex * 71 + j, 313) - 0.5) * 0.88;
        const theta = startTheta + ((j + jTheta) / n) * Math.PI * 2;
        const jr = (hash2D(j * 97 + ringIndex, 617) - 0.5) * dr * 0.95;
        const finalR = Math.max(0.5, r + jr);

        let x = Math.cos(theta) * finalR;
        let z = Math.sin(theta) * finalR;

        // Organic low-frequency 2D curl noise warp to break all grid/circle lines
        const warp1 = Math.sin(x * 0.22 + z * 0.17) * 0.38;
        const warp2 = Math.cos(x * 0.14 - z * 0.28) * 0.38;
        x += warp1;
        z += warp2;

        let scaleBase: number;
        let heightScale: number;
        const hScale = hash2D(ringIndex * 13 + j, 449);

        if (finalR < 28.0) {
          scaleBase = 0.95 + (j % 5) * 0.12;
          heightScale = 1.05 + hScale * 0.40; // 1.05m to 1.45m
        } else if (finalR < 58.0) {
          scaleBase = 1.35 + (j % 4) * 0.18;
          heightScale = 1.30 + hScale * 0.40;
        } else {
          // Large landscape clumps that seamlessly cover the distant rolling hills
          scaleBase = 1.90 + (j % 4) * 0.25;
          heightScale = 1.55 + hScale * 0.55;
        }

        candidates.push({ x, z, scaleBase, heightScale });
      }

      r += dr;
      ringIndex++;
    }

    const count = candidates.length;
    this.grassInstancedMesh = new THREE.InstancedMesh(clumpGeom, this.grassMaterial, count);
    this.grassInstancedMesh.receiveShadow = true;
    this.grassInstanceData = [];

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const c = candidates[i];
      const y = getTerrainHeight(c.x, c.z);
      const norm = getTerrainNormal(c.x, c.z);

      const rotX = norm.z * 0.35;
      const rotY = (i * 0.65) % (Math.PI * 2);
      const rotZ = -norm.x * 0.35;

      dummy.position.set(c.x, y, c.z);
      dummy.rotation.set(rotX, rotY, rotZ);
      dummy.scale.set(c.scaleBase, c.heightScale, c.scaleBase);
      dummy.updateMatrix();

      this.grassInstancedMesh.setMatrixAt(i, dummy.matrix);

      this.grassInstanceData.push({
        x: c.x,
        y,
        z: c.z,
        baseSx: c.scaleBase,
        baseSy: c.heightScale,
        baseSz: c.scaleBase,
        rotX,
        rotY,
        rotZ,
        currentHeightFactor: 1.0,
      });
    }

    this.grassInstancedMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.grassInstancedMesh);
  }

  /**
   * Parts and suppresses grass blades within the flower's perimeter so blades never clip petals or stems.
   */
  private clearGrassAroundFlower(fx: number, fz: number, radius = 1.15): void {
    if (!this.grassInstancedMesh || this.grassInstanceData.length === 0) return;
    const dummy = new THREE.Object3D();
    let updated = false;

    for (let i = 0; i < this.grassInstanceData.length; i++) {
      const g = this.grassInstanceData[i];
      const d = Math.hypot(g.x - fx, g.z - fz);
      if (d < radius) {
        let hFactor = 0;
        if (d >= 0.60) {
          const normD = (d - 0.60) / (radius - 0.60);
          hFactor = Math.min(1.0, 0.2 + 0.8 * Math.pow(normD, 1.5));
        }
        if (hFactor < g.currentHeightFactor) {
          g.currentHeightFactor = hFactor;
          dummy.position.set(g.x, g.y, g.z);
          dummy.rotation.set(g.rotX, g.rotY, g.rotZ);
          if (hFactor === 0) {
            dummy.scale.set(0, 0, 0);
          } else {
            dummy.scale.set(g.baseSx * 0.88, g.baseSy * hFactor, g.baseSz * 0.88);
          }
          dummy.updateMatrix();
          this.grassInstancedMesh.setMatrixAt(i, dummy.matrix);
          updated = true;
        }
      }
    }

    if (updated) {
      this.grassInstancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private createCuteGrassClumpGeometry(): THREE.BufferGeometry {
    // 6-blade curved ribbon tuft with lush varied heights and natural radial spread
    const bladeConfigs = [
      { angle: 0.10, height: 1.38, width: 0.085, curve: 0.38, colShift: 0.0 },
      { angle: 1.12, height: 0.95, width: 0.075, curve: 0.24, colShift: 0.06 },
      { angle: 2.18, height: 1.45, width: 0.090, curve: 0.42, colShift: -0.04 },
      { angle: 3.24, height: 0.65, width: 0.070, curve: 0.16, colShift: 0.08 },
      { angle: 4.30, height: 1.22, width: 0.080, curve: 0.32, colShift: -0.06 },
      { angle: 5.35, height: 0.72, width: 0.072, curve: 0.18, colShift: 0.04 },
    ];

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const cBase = new THREE.Color('#1c4b18'); // Deep rich roots
    const cMid = new THREE.Color('#43992b');  // Vibrant lush green
    const cTip = new THREE.Color('#a1ea48');  // Soft sunlit chartreuse tip

    let vertOffset = 0;

    for (let b = 0; b < bladeConfigs.length; b++) {
      const cfg = bladeConfigs[b];
      const bladeAngle = cfg.angle;
      const bladeHeight = cfg.height;
      const bladeWidth = cfg.width;
      const curveAmount = cfg.curve;

      const segs = 4;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const y = t * bladeHeight;
        const bend = Math.pow(t, 1.8) * curveAmount;
        const w = (1.0 - t * 0.72) * bladeWidth * 0.5;

        const cosA = Math.cos(bladeAngle);
        const sinA = Math.sin(bladeAngle);

        const lx = (-w) * -sinA + bend * cosA;
        const lz = (-w) * cosA + bend * sinA;
        positions.push(lx, y, lz);

        const rx = (w) * -sinA + bend * cosA;
        const rz = (w) * cosA + bend * sinA;
        positions.push(rx, y, rz);

        normals.push(0, 0.8, 0.6);
        normals.push(0, 0.8, 0.6);

        const col = t < 0.5
          ? cBase.clone().lerp(cMid, t * 2.0)
          : cMid.clone().lerp(cTip, (t - 0.5) * 2.0);

        if (cfg.colShift > 0) {
          col.lerp(new THREE.Color('#bef264'), cfg.colShift);
        } else if (cfg.colShift < 0) {
          col.lerp(new THREE.Color('#14532d'), -cfg.colShift);
        }

        colors.push(col.r, col.g, col.b);
        colors.push(col.r, col.g, col.b);

        uvs.push(0, t, 1, t);

        if (s < segs) {
          const i = vertOffset + s * 2;
          indices.push(i, i + 1, i + 2);
          indices.push(i + 1, i + 3, i + 2);
        }
      }
      vertOffset += (segs + 1) * 2;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    return geom;
  }

  private buildFairyParticles(): void {
    const count = 450;
    const positions = new Float32Array(count * 3);
    const initialY = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const cWarm = new THREE.Color('#fef08a'); // Warm fairy gold
    const cMint = new THREE.Color('#6ee7b7'); // Ethereal mint
    const cCyan = new THREE.Color('#67e8f9'); // Twilight blue

    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * 42;
      const theta = Math.random() * Math.PI * 2;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const groundY = getTerrainHeight(x, z);
      const y = groundY + 0.4 + Math.random() * 2.8;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      initialY[i] = y;
      phases[i] = Math.random() * Math.PI * 2;

      // Varied glowing palette
      const pick = i % 3;
      const c = pick === 0 ? cWarm : pick === 1 ? cMint : cCyan;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Glowing particle texture
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      grad.addColorStop(0.3, 'rgba(254, 240, 138, 0.9)');
      grad.addColorStop(0.6, 'rgba(110, 231, 183, 0.4)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);

    this.fairyMaterial = new THREE.PointsMaterial({
      size: 0.35,
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.fairyPositions = positions;
    this.fairyInitialY = initialY;
    this.fairyPhases = phases;

    this.fairyPoints = new THREE.Points(geom, this.fairyMaterial);
    this.scene.add(this.fairyPoints);
  }

  public setWeather(weather: GardenWeather, notify = true): void {
    this.weather = weather;

    let targetState: 'sunny' | 'cloudy' | 'night' | 'dawn' | 'sunset' = 'sunny';
    if (weather === 'auto') {
      const hour = new Date().getHours() + new Date().getMinutes() / 60;
      this.currentHour = hour;
      if (hour >= 20 || hour < 5.5) {
        targetState = 'night';
      } else if (hour >= 5.5 && hour < 8.0) {
        targetState = 'dawn';
      } else if (hour >= 17.5 && hour < 20.0) {
        targetState = 'sunset';
      } else if (hour >= 13.0 && hour <= 15.0) {
        targetState = 'cloudy';
      } else {
        targetState = 'sunny';
      }
    } else {
      targetState = weather;
      if (weather === 'dawn') this.currentHour = 6.5;
      else if (weather === 'sunny') this.currentHour = 12.0;
      else if (weather === 'sunset') this.currentHour = 18.5;
      else if (weather === 'night') this.currentHour = 23.0;
    }

    this.applyAtmosphereState(targetState);

    if (notify) {
      this.callbacks.onWeatherChange?.(weather, targetState, this.currentHour);
    }
  }

  public setTimeOfDay(hour: number, notify = true): void {
    this.currentHour = Math.max(0, Math.min(24, hour));
    this.weather = 'auto'; // custom manual hour

    let targetState: 'sunny' | 'cloudy' | 'night' | 'dawn' | 'sunset' = 'sunny';
    if (this.currentHour >= 20.0 || this.currentHour < 5.5) {
      targetState = 'night';
    } else if (this.currentHour >= 5.5 && this.currentHour < 8.0) {
      targetState = 'dawn';
    } else if (this.currentHour >= 17.5 && this.currentHour < 20.0) {
      targetState = 'sunset';
    } else {
      targetState = 'sunny';
    }

    this.applyAtmosphereState(targetState);
    this.skyDome?.setTimeOfDay(this.currentHour, false);

    // Dynamic solar orbital position
    if (this.currentHour >= 5.5 && this.currentHour <= 19.5) {
      const angle = ((this.currentHour - 6.0) / 13.0) * Math.PI;
      const x = -Math.cos(angle) * 70;
      const y = Math.sin(angle) * 65 + 10;
      this.targetSunPos.set(x, y, 30);
    }

    if (notify) {
      this.callbacks.onWeatherChange?.(this.weather, targetState, this.currentHour);
    }
  }

  private applyAtmosphereState(targetState: 'sunny' | 'cloudy' | 'night' | 'dawn' | 'sunset'): void {
    this.activeWeatherState = targetState;

    if (targetState === 'night') {
      // Midnight Twilight with Fairy Magic
      this.targetBgColor.set('#070b19');
      this.targetFogColor.set('#050813');
      this.targetFogDensity = 0.014;
      this.targetSunColor.set('#818cf8');
      this.targetSunIntensity = 0.75;
      this.targetSunPos.set(20, 50, -30);
      this.targetRimColor.set('#38bdf8');
      this.targetRimIntensity = 0.45;
      this.targetHemiSkyColor.set('#1e1b4b');
      this.targetHemiGroundColor.set('#050813');
      this.targetHemiIntensity = 0.65;
      this.targetAmbColor.set('#0f172a');
      this.targetAmbIntensity = 0.35;
      this.targetFairyOpacity = 0.95;
    } else if (targetState === 'dawn') {
      // Gentle Golden-Rose Sunrise
      this.targetBgColor.set('#e07a5f');
      this.targetFogColor.set('#f4a261');
      this.targetFogDensity = 0.012;
      this.targetSunColor.set('#f59e0b');
      this.targetSunIntensity = 2.0;
      this.targetSunPos.set(-50, 20, 25);
      this.targetRimColor.set('#fdba74');
      this.targetRimIntensity = 0.95;
      this.targetHemiSkyColor.set('#fdba74');
      this.targetHemiGroundColor.set('#2d4a22');
      this.targetHemiIntensity = 0.95;
      this.targetAmbColor.set('#fed7aa');
      this.targetAmbIntensity = 0.48;
      this.targetFairyOpacity = 0.08;
    } else if (targetState === 'sunset') {
      // Fiery Golden Hour Dusk
      this.targetBgColor.set('#9d174d');
      this.targetFogColor.set('#c2410c');
      this.targetFogDensity = 0.011;
      this.targetSunColor.set('#f97316');
      this.targetSunIntensity = 2.2;
      this.targetSunPos.set(50, 18, -20);
      this.targetRimColor.set('#f43f5e');
      this.targetRimIntensity = 1.15;
      this.targetHemiSkyColor.set('#a855f7');
      this.targetHemiGroundColor.set('#1c1917');
      this.targetHemiIntensity = 0.9;
      this.targetAmbColor.set('#fdba74');
      this.targetAmbIntensity = 0.52;
      this.targetFairyOpacity = 0.4;
    } else if (targetState === 'cloudy') {
      // Soft Overcast Silver
      this.targetBgColor.set('#c8d6e5');
      this.targetFogColor.set('#b2bec3');
      this.targetFogDensity = 0.016;
      this.targetSunColor.set('#e2e8f0');
      this.targetSunIntensity = 1.1;
      this.targetSunPos.set(30, 50, 20);
      this.targetRimColor.set('#94a3b8');
      this.targetRimIntensity = 0.4;
      this.targetHemiSkyColor.set('#94a3b8');
      this.targetHemiGroundColor.set('#2d3748');
      this.targetHemiIntensity = 0.85;
      this.targetAmbColor.set('#cbd5e1');
      this.targetAmbIntensity = 0.45;
      this.targetFairyOpacity = 0.0;
    } else {
      // Warm Golden Daylight
      this.targetBgColor.set('#dceefb');
      this.targetFogColor.set('#cce4f7');
      this.targetFogDensity = 0.009;
      this.targetSunColor.set('#fff3d6');
      this.targetSunIntensity = 2.4;
      this.targetSunPos.set(40, 60, 30);
      this.targetRimColor.set('#ffeaa7');
      this.targetRimIntensity = 0.85;
      this.targetHemiSkyColor.set('#93c5fd');
      this.targetHemiGroundColor.set('#365314');
      this.targetHemiIntensity = 1.1;
      this.targetAmbColor.set('#ffeacc');
      this.targetAmbIntensity = 0.55;
      this.targetFairyOpacity = 0.0;
    }

    this.skyDome?.setMode(targetState);
  }

  public setQuality(preset: 'high' | 'medium' | 'low'): void {
    if (preset === 'low') {
      this.renderer.setPixelRatio(1.0);
      this.renderer.shadowMap.enabled = false;
      if (this.grassInstancedMesh) this.grassInstancedMesh.visible = false;
      if (this.wildFloretsMesh) this.wildFloretsMesh.visible = false;
    } else if (preset === 'medium') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      this.renderer.shadowMap.enabled = true;
      if (this.grassInstancedMesh) this.grassInstancedMesh.visible = true;
      if (this.wildFloretsMesh) this.wildFloretsMesh.visible = true;
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
      this.renderer.shadowMap.enabled = true;
      if (this.grassInstancedMesh) this.grassInstancedMesh.visible = true;
      if (this.wildFloretsMesh) this.wildFloretsMesh.visible = true;
    }
  }

  public setAestheticMode(mode: 'meadow' | 'filament'): void {
    this.aestheticMode = mode;
    if (mode === 'filament') {
      this.scene.background = new THREE.Color('#0a0e17');
      this.scene.fog = new THREE.FogExp2('#070a12', 0.016);
      if (this.sunLight) {
        this.sunLight.color.set('#7c5cff');
        this.sunLight.intensity = 0.9;
      }
      if (this.hemiLight) {
        this.hemiLight.color.set('#1e293b');
        this.hemiLight.groundColor.set('#0f172a');
      }
      if (this.ambLight) {
        this.ambLight.color.set('#0f172a');
        this.ambLight.intensity = 0.35;
      }
    } else {
      this.scene.background = new THREE.Color('#e0ebf5');
      this.scene.fog = new THREE.FogExp2('#d5e5f2', 0.012);
      if (this.sunLight) {
        this.sunLight.color.set('#fff1d0');
        this.sunLight.intensity = 2.2;
      }
      if (this.hemiLight) {
        this.hemiLight.color.set('#cbe5ff');
        this.hemiLight.groundColor.set('#3d4d29');
      }
      if (this.ambLight) {
        this.ambLight.color.set('#ffeacc');
        this.ambLight.intensity = 0.5;
      }
    }

    for (const entry of this.flowers.values()) {
      entry.instance.setAestheticMode(mode);
    }
  }

  public addFlower(flower: PublicFlower, enqueueReveal = false): void {
    if (this.flowers.has(flower.id)) {
      return; // Already present
    }

    const instance = generateFlowerObject(flower.design, flower.seed);
    instance.setAestheticMode(this.aestheticMode);
    const pos = flower.placement;
    const y = getTerrainHeight(pos.x, pos.z);

    instance.rootGroup.position.set(pos.x, y, pos.z);
    instance.rootGroup.rotation.y = pos.rotationY;
    instance.rootGroup.scale.setScalar(pos.scale);

    // Optimize shadow casting for distant stress flowers
    const distFromCenter = Math.hypot(pos.x, pos.z);
    if (distFromCenter > 40) {
      instance.rootGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          obj.castShadow = false;
        }
      });
    }

    this.scene.add(instance.rootGroup);
    this.flowers.set(flower.id, { flower, instance });

    // Ensure surrounding grass is parted so blades never intersect flower petals
    this.clearGrassAroundFlower(pos.x, pos.z, 1.15);

    // Add stem / head to raycast list
    this.flowerRaycastMeshes.push({
      mesh: instance.stemMesh,
      flower,
    });

    if (enqueueReveal) {
      this.cameraController.enqueueFlower(flower);
    }
  }

  public removeFlower(id: string): void {
    const entry = this.flowers.get(id);
    if (!entry) return;

    this.scene.remove(entry.instance.rootGroup);
    entry.instance.dispose();
    this.flowers.delete(id);

    this.flowerRaycastMeshes = this.flowerRaycastMeshes.filter((m) => m.flower.id !== id);
  }

  public syncFlowers(flowerList: PublicFlower[]): void {
    const existingIds = new Set(this.flowers.keys());
    const incomingMap = new Map(flowerList.map((f) => [f.id, f]));

    // Remove flowers that were hidden or removed
    for (const id of existingIds) {
      if (!incomingMap.has(id)) {
        this.removeFlower(id);
      }
    }

    // Add new flowers quietly (without auto-reveal queueing during mass sync)
    for (const f of flowerList) {
      if (!existingIds.has(f.id)) {
        this.addFlower(f, false);
      }
    }
  }

  public triggerBloomAnimation(id: string): void {
    const entry = this.flowers.get(id);
    if (entry) {
      entry.bloomAnim = 0; // Starts from 0 to 1
    }
  }

  public getFlowerById(id: string): PublicFlower | undefined {
    return this.flowers.get(id)?.flower;
  }

  public getAllFlowers(): PublicFlower[] {
    return Array.from(this.flowers.values()).map((v) => v.flower);
  }

  public count(): number {
    return this.flowers.size;
  }

  /**
   * Generates up to 1,000 stress test flowers across the landscape
   */
  public generateStressTestFlowers(targetTotal: number = 1000): void {
    const current = this.flowers.size;
    const needed = Math.max(0, targetTotal - current);
    const shapes: ('rounded' | 'pointed' | 'teardrop' | 'heart' | 'ruffled')[] = [
      'rounded',
      'pointed',
      'teardrop',
      'heart',
      'ruffled',
    ];

    const colors = ['#e84393', '#fd79a8', '#f39c12', '#0984e3', '#e17055', '#6c5ce7', '#00b894', '#fdcb6e'];

    for (let i = 0; i < needed; i++) {
      const slot = current + i;
      const seed = 50000 + slot;
      const shape = shapes[slot % shapes.length];
      const pCol = colors[slot % colors.length];
      const sCol = colors[(slot + 2) % colors.length];

      // Phyllotaxis placement
      const spacing = 2.4;
      const r = spacing * Math.sqrt(slot + 1.2);
      const theta = (slot + 1) * 2.39996323;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const y = getTerrainHeight(x, z);

      const f: PublicFlower = {
        id: `stress-${slot}`,
        code: `STR-${slot}`,
        displayName: `Stress Test #${slot + 1}`,
        message: `High-density procedural performance test flower index ${slot}.`,
        design: {
          petalShape: shape,
          petalCount: 8 + (slot % 12),
          petalLayers: 1 + (slot % 3),
          primaryColor: pCol,
          secondaryColor: sCol,
          centerColor: '#ffeaa7',
          stemColor: '#2d6a4f',
          petalLength: 1.0 + (slot % 5) * 0.15,
          petalWidth: 0.8 + (slot % 4) * 0.15,
          petalCurvature: -0.4 + (slot % 5) * 0.2,
          stemHeight: 1.4 + (slot % 6) * 0.2,
          leafCount: 2 + (slot % 4),
          leafSize: 0.8,
        },
        generatorVersion: 1,
        seed,
        placement: {
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
          z: Math.round(z * 100) / 100,
          rotationY: (slot * 1.7) % (Math.PI * 2),
          scale: 0.85 + (slot % 4) * 0.08,
          slotIndex: slot,
        },
        createdAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
        status: 'approved',
      };

      this.addFlower(f, false);
    }
  }

  private bindInteractions(): void {
    const el = this.renderer.domElement;
    let downX = 0;
    let downY = 0;

    el.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });

    el.addEventListener('pointerup', (e) => {
      // Check if it was a clean click without significant dragging
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dist < 6) {
        this.handleClick(e);
      }
    });
  }

  private handleClick(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const checkObjects: THREE.Object3D[] = [];
    const objToFlower = new Map<THREE.Object3D, PublicFlower>();

    for (const { instance, flower } of this.flowers.values()) {
      checkObjects.push(instance.rootGroup);
      objToFlower.set(instance.rootGroup, flower);
    }

    const intersects = this.raycaster.intersectObjects(checkObjects, true);
    if (intersects.length > 0) {
      // Find top flower root
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !objToFlower.has(obj) && obj.parent) {
        obj = obj.parent;
      }

      if (obj && objToFlower.has(obj)) {
        const flower = objToFlower.get(obj)!;
        this.cameraController.flyToFlower(flower);
        this.callbacks.onFlowerSelected?.(flower);
      }
    }
  }

  private renderLoop(time: number): void {
    if (this.isDestroyed) return;

    this.animFrameId = requestAnimationFrame(this.renderLoop);

    const delta = Math.min((time - this.lastTime) * 0.001, 0.1);
    this.lastTime = time;

    // Performance tracking
    this.frameCount++;
    this.fpsTimer += delta;
    if (this.fpsTimer >= 0.5) {
      this.currentFps = Math.round((this.frameCount / this.fpsTimer));
      this.frameCount = 0;
      this.fpsTimer = 0;

      const drawCalls = this.renderer.info.render.calls;
      this.callbacks.onStatsUpdate?.(this.currentFps, drawCalls, this.flowers.size);
    }

    // Update Camera
    this.cameraController.update(delta);

    const timeSec = time * 0.001;

    // 1. Update tall grass GPU wind wave
    this.grassWindTime.value = timeSec;

    // 2. Update atmospheric sky dome & sun corona
    this.skyDome?.update(timeSec);

    // 3. Cinematic atmosphere smooth transition (Weather & Time of Day)
    const lerpSpeed = Math.min(1.0, delta * 3.0);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this.targetBgColor, lerpSpeed);
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.lerp(this.targetFogColor, lerpSpeed);
      this.scene.fog.density += (this.targetFogDensity - this.scene.fog.density) * lerpSpeed;
    }
    if (this.sunLight) {
      this.sunLight.color.lerp(this.targetSunColor, lerpSpeed);
      this.sunLight.intensity += (this.targetSunIntensity - this.sunLight.intensity) * lerpSpeed;
      this.sunLight.position.lerp(this.targetSunPos, lerpSpeed);
    }
    if (this.rimLight) {
      this.rimLight.color.lerp(this.targetRimColor, lerpSpeed);
      this.rimLight.intensity += (this.targetRimIntensity - this.rimLight.intensity) * lerpSpeed;
    }
    if (this.hemiLight) {
      this.hemiLight.color.lerp(this.targetHemiSkyColor, lerpSpeed);
      this.hemiLight.groundColor.lerp(this.targetHemiGroundColor, lerpSpeed);
      this.hemiLight.intensity += (this.targetHemiIntensity - this.hemiLight.intensity) * lerpSpeed;
    }
    if (this.ambLight) {
      this.ambLight.color.lerp(this.targetAmbColor, lerpSpeed);
      this.ambLight.intensity += (this.targetAmbIntensity - this.ambLight.intensity) * lerpSpeed;
    }

    // 3. Fairy Particles (Fireflies) Swarm & Pulse
    this.currentFairyOpacity += (this.targetFairyOpacity - this.currentFairyOpacity) * lerpSpeed;
    if (this.fairyMaterial) {
      // Pulse brightness like summer fireflies
      const pulse = 0.85 + Math.sin(timeSec * 3.0) * 0.15;
      this.fairyMaterial.opacity = this.currentFairyOpacity * pulse;
      this.fairyMaterial.size = 0.35 + Math.sin(timeSec * 2.5) * 0.08;
    }

    if (this.fairyPositions && this.fairyInitialY && this.fairyPhases && this.currentFairyOpacity > 0.01) {
      const count = this.fairyPhases.length;
      for (let i = 0; i < count; i++) {
        const ph = this.fairyPhases[i];
        const dy = Math.sin(timeSec * 1.5 + ph) * 0.4;
        this.fairyPositions[i * 3 + 1] = this.fairyInitialY[i] + dy;
        this.fairyPositions[i * 3] += Math.cos(timeSec * 0.6 + ph) * 0.012;
        this.fairyPositions[i * 3 + 2] += Math.sin(timeSec * 0.7 + ph) * 0.012;
      }
      if (this.fairyPoints) {
        this.fairyPoints.geometry.attributes.position.needsUpdate = true;
      }
    }

    // Update Flower wind sway and bloom transitions
    for (const entry of this.flowers.values()) {
      entry.instance.updateWind(timeSec, 0.8);

      if (entry.bloomAnim !== undefined && entry.bloomAnim < 1.0) {
        entry.bloomAnim = Math.min(1.0, entry.bloomAnim + delta * 1.5);
        // Ease out back bloom curve
        const t = entry.bloomAnim;
        const scale = t < 1.0 ? 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2) : 1;
        entry.instance.setBloomProgress(scale);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  private onResize = (): void => {
    if (!this.container || this.isDestroyed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  public destroy(): void {
    this.isDestroyed = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    window.removeEventListener('resize', this.onResize);

    for (const entry of this.flowers.values()) {
      entry.instance.dispose();
    }
    this.flowers.clear();

    if (this.grassInstancedMesh) {
      this.grassInstancedMesh.geometry.dispose();
      (this.grassInstancedMesh.material as THREE.Material).dispose();
    }

    if (this.wildFloretsMesh) {
      this.wildFloretsMesh.geometry.dispose();
      (this.wildFloretsMesh.material as THREE.Material).dispose();
    }

    if (this.skyDome) {
      this.skyDome.mesh.geometry.dispose();
      (this.skyDome.mesh.material as THREE.Material).dispose();
      this.skyDome.starsPoints.geometry.dispose();
      (this.skyDome.starsPoints.material as THREE.Material).dispose();
    }

    if (this.groundTexture) {
      this.groundTexture.dispose();
    }

    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }

    if (this.fairyPoints) {
      this.fairyPoints.geometry.dispose();
      (this.fairyPoints.material as THREE.Material).dispose();
    }

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
