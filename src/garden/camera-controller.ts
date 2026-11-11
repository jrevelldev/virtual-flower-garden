import * as THREE from 'three';
import { PublicFlower } from '../types/garden';
import { getTerrainHeight } from '../services/terrain';

export type CameraMode = 'attract' | 'reveal' | 'manual';

export interface CameraControllerOptions {
  onModeChange?: (mode: CameraMode) => void;
  onRevealStart?: (flower: PublicFlower) => void;
  onRevealEnd?: (flower: PublicFlower) => void;
  onQueueUpdate?: (queueLength: number) => void;
}

export class GardenCameraController {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraMode = 'attract';
  private domElement: HTMLElement;
  private options: CameraControllerOptions;

  // Reveal queue
  private revealQueue: PublicFlower[] = [];
  private currentRevealingFlower: PublicFlower | null = null;
  private revealTimer: number | null = null;
  private revealHoldSeconds = 6;
  private catchUpLimit = 20;

  // Manual interaction variables (Orbit / Pan / Zoom)
  private isPointerDown = false;
  private hasPointerMovedSignificantly = false;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private pointerCurrentX = 0;
  private pointerCurrentY = 0;
  private spherical = new THREE.Spherical(35, Math.PI * 0.32, 0.4);
  private target = new THREE.Vector3(0, 2, 0);

  // Transition interpolation
  private isTransitioning = false;
  private transitionStartPos = new THREE.Vector3();
  private transitionEndPos = new THREE.Vector3();
  private transitionStartTarget = new THREE.Vector3();
  private transitionEndTarget = new THREE.Vector3();
  private transitionProgress = 0;
  private transitionDuration = 2.0; // seconds
  private onTransitionComplete: (() => void) | null = null;

  // Attract mode motion parameters
  private attractTime = 0;
  private attractCenter = new THREE.Vector3(0, 0, 0);

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    options: CameraControllerOptions = {}
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.options = options;

    this.bindEvents();
    this.updateCameraTransform();
  }

  public setRevealHoldSeconds(seconds: number): void {
    this.revealHoldSeconds = Math.max(2, seconds);
  }

  public setCatchUpLimit(limit: number): void {
    this.catchUpLimit = Math.max(1, limit);
  }

  public getQueueLength(): number {
    return this.revealQueue.length;
  }

  public clearQueue(): void {
    this.revealQueue = [];
    if (this.options.onQueueUpdate) {
      this.options.onQueueUpdate(0);
    }
    if (this.mode === 'reveal') {
      this.cancelActiveTransition();
      this.setMode('attract');
    }
  }

  public enqueueFlower(flower: PublicFlower): void {
    // Avoid duplicate enqueues
    if (
      this.currentRevealingFlower?.id === flower.id ||
      this.revealQueue.some((f) => f.id === flower.id)
    ) {
      return;
    }

    // Apply catch-up limit if queue grows too large (keep most recent)
    if (this.revealQueue.length >= this.catchUpLimit) {
      this.revealQueue.shift();
    }

    this.revealQueue.push(flower);
    this.options.onQueueUpdate?.(this.revealQueue.length);

    // If currently idling in attract mode, start revealing immediately
    if (this.mode === 'attract' && !this.isTransitioning) {
      this.processNextInQueue();
    }
  }

  public resumeAutomaticMode(): void {
    this.cancelActiveTransition();
    if (this.revealQueue.length > 0) {
      this.processNextInQueue();
    } else {
      this.setMode('attract');
      // Smoothly transition from current manual angle back to pleasant attract orbit
      this.transitionTo(
        new THREE.Vector3(Math.sin(this.attractTime * 0.1) * 35, 12, Math.cos(this.attractTime * 0.1) * 35),
        new THREE.Vector3(0, 2, 0),
        2.2
      );
    }
  }

  public flyToFlower(flower: PublicFlower, onSettled?: () => void): void {
    this.cancelActiveTransition();
    this.setMode('manual');

    const fx = flower.placement.x;
    const fz = flower.placement.z;
    const fy = flower.placement.y;
    const flowerHeight = flower.design.stemHeight || 1.6;

    // Face the front of the flower with a graceful 25° downward beauty angle
    const viewAngle = flower.placement.rotationY;
    const dist = 5.0;
    const camX = fx + Math.sin(viewAngle) * dist;
    const camZ = fz + Math.cos(viewAngle) * dist;
    const minGroundY = getTerrainHeight(camX, camZ) + 1.2;
    const camY = Math.max(minGroundY, fy + flowerHeight + 1.2);

    const targetPos = new THREE.Vector3(fx, fy + flowerHeight * 0.65, fz);

    this.transitionTo(new THREE.Vector3(camX, camY, camZ), targetPos, 1.8, () => {
      // Synchronize spherical coordinates with final position
      this.target.copy(targetPos);
      const offset = this.camera.position.clone().sub(this.target);
      this.spherical.setFromVector3(offset);
      onSettled?.();
    });
  }

  public flyToOverview(): void {
    this.cancelActiveTransition();
    this.setMode('manual');

    const highCam = new THREE.Vector3(0, 38, 48);
    const centerTarget = new THREE.Vector3(0, 1, 0);

    this.transitionTo(highCam, centerTarget, 2.0, () => {
      this.target.copy(centerTarget);
      const offset = this.camera.position.clone().sub(this.target);
      this.spherical.setFromVector3(offset);
    });
  }

  public update(delta: number): void {
    // 1. Process active camera transition
    if (this.isTransitioning) {
      this.transitionProgress += delta / this.transitionDuration;
      if (this.transitionProgress >= 1.0) {
        this.transitionProgress = 1.0;
        this.isTransitioning = false;

        this.camera.position.copy(this.transitionEndPos);
        this.target.copy(this.transitionEndTarget);
        this.camera.lookAt(this.target);

        const cb = this.onTransitionComplete;
        this.onTransitionComplete = null;
        cb?.();
      } else {
        // Smooth cubic ease-in-out
        const t = this.transitionProgress;
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        this.camera.position.lerpVectors(this.transitionStartPos, this.transitionEndPos, ease);
        const curTarget = new THREE.Vector3().lerpVectors(
          this.transitionStartTarget,
          this.transitionEndTarget,
          ease
        );
        this.camera.lookAt(curTarget);
      }

      this.clampCameraAboveTerrain();
      return;
    }

    // 2. Mode-specific updates
    if (this.mode === 'attract') {
      this.attractTime += delta * 0.12;
      const radius = 32 + Math.sin(this.attractTime * 0.4) * 8;
      const angle = this.attractTime * 0.35;
      const cx = Math.cos(angle) * radius;
      const cz = Math.sin(angle) * radius;
      const cy = Math.max(getTerrainHeight(cx, cz) + 6, 8 + Math.sin(this.attractTime * 0.7) * 4);

      this.camera.position.set(cx, cy, cz);
      // Gentle center bobbing
      this.attractCenter.set(
        Math.sin(this.attractTime * 0.25) * 4,
        2.5 + Math.cos(this.attractTime * 0.3) * 1.5,
        Math.cos(this.attractTime * 0.25) * 4
      );
      this.camera.lookAt(this.attractCenter);
      this.clampCameraAboveTerrain();
    } else if (this.mode === 'manual') {
      // Manual mode keeps target and spherical coords
      this.updateCameraTransform();
      this.clampCameraAboveTerrain();
    }
  }

  private processNextInQueue(): void {
    if (this.mode === 'manual') {
      return; // Never interrupt manual mode!
    }

    if (this.revealQueue.length === 0) {
      this.currentRevealingFlower = null;
      this.setMode('attract');
      return;
    }

    const nextFlower = this.revealQueue.shift()!;
    this.options.onQueueUpdate?.(this.revealQueue.length);

    this.currentRevealingFlower = nextFlower;
    this.setMode('reveal');

    // Notify reveal start
    this.options.onRevealStart?.(nextFlower);

    // Compute camera reveal position facing the flower front from a graceful downward angle
    const fx = nextFlower.placement.x;
    const fz = nextFlower.placement.z;
    const fy = nextFlower.placement.y;
    const flowerHeight = (nextFlower.design.stemHeight || 1.6);

    const angle = nextFlower.placement.rotationY;
    const dist = 5.0;
    const camX = fx + Math.sin(angle) * dist;
    const camZ = fz + Math.cos(angle) * dist;
    const camY = Math.max(getTerrainHeight(camX, camZ) + 1.2, fy + flowerHeight + 1.2);

    const flowerTarget = new THREE.Vector3(fx, fy + flowerHeight * 0.65, fz);

    // Transition over ~2.0 seconds
    this.transitionTo(new THREE.Vector3(camX, camY, camZ), flowerTarget, 2.0, () => {
      // Camera settled! Hold message visibility
      // Base hold 6s, slightly longer for longer messages (up to 10s)
      const messageLength = nextFlower.message.length;
      const holdTime = Math.min(10, Math.max(this.revealHoldSeconds, 4 + messageLength * 0.02));

      this.revealTimer = window.setTimeout(() => {
        this.options.onRevealEnd?.(nextFlower);
        this.currentRevealingFlower = null;
        this.processNextInQueue();
      }, holdTime * 1000);
    });
  }

  private transitionTo(
    endPos: THREE.Vector3,
    endTarget: THREE.Vector3,
    duration: number,
    onComplete?: () => void
  ): void {
    this.isTransitioning = true;
    this.transitionProgress = 0;
    this.transitionDuration = duration;
    this.transitionStartPos.copy(this.camera.position);
    this.transitionEndPos.copy(endPos);
    this.transitionStartTarget.copy(this.target);
    this.transitionEndTarget.copy(endTarget);
    this.onTransitionComplete = onComplete || null;
  }

  public cancelActiveTransition(): void {
    if (this.revealTimer !== null) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    this.isTransitioning = false;
    this.onTransitionComplete = null;
  }

  private setMode(newMode: CameraMode): void {
    if (this.mode !== newMode) {
      this.mode = newMode;
      this.options.onModeChange?.(newMode);
    }
  }

  private clampCameraAboveTerrain(): void {
    const minHeightAboveGround = 1.2;
    const groundY = getTerrainHeight(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < groundY + minHeightAboveGround) {
      this.camera.position.y = groundY + minHeightAboveGround;
    }
  }

  private updateCameraTransform(): void {
    const offset = new THREE.Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  private bindEvents(): void {
    const el = this.domElement;

    // Pointer down (start drag)
    el.addEventListener('pointerdown', (e) => {
      this.isPointerDown = true;
      this.hasPointerMovedSignificantly = false;
      this.pointerStartX = e.clientX;
      this.pointerStartY = e.clientY;
      this.pointerCurrentX = e.clientX;
      this.pointerCurrentY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });

    // Pointer move: ONLY switch to Manual mode if drag has moved significantly (> 4px)
    // Moving the mouse without dragging must NOT interrupt automatic mode!
    el.addEventListener('pointermove', (e) => {
      if (!this.isPointerDown) return;

      const dx = e.clientX - this.pointerCurrentX;
      const dy = e.clientY - this.pointerCurrentY;
      const totalDist = Math.hypot(e.clientX - this.pointerStartX, e.clientY - this.pointerStartY);

      if (totalDist > 4 && !this.hasPointerMovedSignificantly) {
        this.hasPointerMovedSignificantly = true;
        // Enter manual mode and halt auto transitions!
        this.cancelActiveTransition();
        this.setMode('manual');

        // Sync spherical coordinates to current camera & target
        const offset = this.camera.position.clone().sub(this.target);
        this.spherical.setFromVector3(offset);
      }

      if (this.hasPointerMovedSignificantly) {
        // Orbit rotation
        const rotateSpeed = 0.005;
        this.spherical.theta -= dx * rotateSpeed;
        this.spherical.phi -= dy * rotateSpeed;

        // Clamp polar angle so camera doesn't flip or plunge completely into ground
        this.spherical.phi = Math.max(0.1, Math.min(Math.PI * 0.48, this.spherical.phi));

        this.updateCameraTransform();
      }

      this.pointerCurrentX = e.clientX;
      this.pointerCurrentY = e.clientY;
    });

    const endPointer = (e: PointerEvent) => {
      if (this.isPointerDown) {
        this.isPointerDown = false;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
    };

    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);

    // Wheel zoom
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cancelActiveTransition();
      this.setMode('manual');

      const zoomFactor = e.deltaY * 0.03;
      this.spherical.radius = Math.max(3.0, Math.min(90.0, this.spherical.radius + zoomFactor));
      this.updateCameraTransform();
    }, { passive: false });
  }
}

