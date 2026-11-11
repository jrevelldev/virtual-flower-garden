export type PetalShape = 'rounded' | 'pointed' | 'teardrop' | 'heart' | 'ruffled';

export interface FlowerDesign {
  petalShape: PetalShape;
  petalCount: number; // 4 to 24
  petalLayers: number; // 1 to 3
  primaryColor: string; // hex
  secondaryColor: string; // hex (tip or petal gradation)
  centerColor: string; // hex
  stemColor: string; // hex
  petalLength: number; // 0.6 to 2.0
  petalWidth: number; // 0.4 to 1.8
  petalCurvature: number; // -0.8 (cupped inward) to 0.8 (rolled back)
  stemHeight: number; // 0.8 to 2.8
  leafCount: number; // 1 to 6
  leafSize: number; // 0.5 to 1.5
  imperfection?: number; // 0.0 (pristine/geometric) to 1.0 (wild/organic), default 0.35
}

export interface FlowerPlacement {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
  slotIndex: number;
}

export type FlowerStatus = 'approved' | 'pending' | 'hidden';

export interface PublicFlower {
  id: string;
  code: string; // Short code e.g. FLW-8X2M
  displayName: string;
  message: string;
  design: FlowerDesign;
  generatorVersion: number;
  seed: number;
  placement: FlowerPlacement;
  createdAt: string;
  publishedAt: string;
  status: FlowerStatus;
}

export interface SubmissionDraft {
  displayName: string;
  message: string;
  design: FlowerDesign;
  idempotencyKey: string;
}

export interface SubmissionResponse {
  success: boolean;
  flower?: PublicFlower;
  status: 'planted' | 'awaiting_approval' | 'error';
  message?: string;
  code?: string;
}

export type GardenWeather = 'sunny' | 'cloudy' | 'night' | 'dawn' | 'sunset' | 'auto';

export interface InstallationSettings {
  approveBeforePlanting: boolean;
  revealHoldSeconds: number; // default 6
  catchUpLimit: number; // default 20
  visitorUrl: string; // configured external URL for QR code
  submissionsPaused: boolean;
  qualityPreset: 'high' | 'medium' | 'low';
  weather?: GardenWeather;
}

export interface GardenStats {
  totalPlanted: number;
  totalActive: number;
  queueLength: number;
  fps: number;
}

