import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { FlowerDesign, InstallationSettings, PublicFlower, SubmissionDraft, SubmissionResponse } from '../types/garden';
import { calculateSlotPlacement } from './terrain';
import { generateFlowerCode, sanitizePlainMessage, truncateGraphemes } from './text-utils';
import { SAMPLE_FLOWERS } from './sample-flowers';

export function getAppBaseUrl(): string {
  if (typeof window === 'undefined') return 'https://thelivinggarden.art';
  const origin = window.location.origin;
  const path = window.location.pathname;
  const segments = path.split('/').filter(Boolean);
  const knownRoutes = ['garden', 'create', 'admin', 'index.html'];
  const basePath = segments.length > 0 && !knownRoutes.includes(segments[0])
    ? `/${segments[0]}`
    : '';
  return `${origin}${basePath}`;
}

export function getDefaultVisitorUrl(): string {
  return `${getAppBaseUrl()}/#/create`;
}

const DEFAULT_SETTINGS: InstallationSettings = {
  approveBeforePlanting: false,
  revealHoldSeconds: 6,
  catchUpLimit: 20,
  visitorUrl: typeof window !== 'undefined' ? getDefaultVisitorUrl() : 'https://thelivinggarden.art/create',
  submissionsPaused: false,
  qualityPreset: 'high',
};

export class DataService {
  private supabase: SupabaseClient | null = null;
  public isSupabaseConnected = false;
  private channel: BroadcastChannel | null = null;
  private listeners: {
    onAdd: (flower: PublicFlower) => void;
    onRemove: (id: string) => void;
    onStatusChange?: (flower: PublicFlower) => void;
  }[] = [];

  constructor() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('placeholder')) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseAnonKey);
        this.isSupabaseConnected = true;
      } catch (err) {
        console.warn('Supabase initialization failed, falling back to local multi-tab sync:', err);
      }
    }

    // Always initialize local multi-tab broadcast bus for same-browser multi-tab sync & fallback
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('living_garden_sync_channel');
      this.channel.onmessage = (event) => {
        const { type, payload } = event.data;
        if (type === 'FLOWER_PLANTED') {
          this.notifyAdd(payload as PublicFlower);
        } else if (type === 'FLOWER_REMOVED') {
          this.notifyRemove(payload.id as string);
        } else if (type === 'FLOWER_STATUS') {
          if (payload.status === 'hidden') {
            this.notifyRemove(payload.id);
          } else {
            this.notifyAdd(payload as PublicFlower);
          }
        }
      };
    }
  }

  public sendRemoteCommand(command: string, payload?: any): void {
    if (this.channel) {
      this.channel.postMessage({
        type: 'REMOTE_COMMAND',
        command,
        payload,
      });
    }
  }

  public subscribeToRemoteCommands(handler: (command: string, payload?: any) => void): () => void {
    if (!this.channel) return () => {};
    const listener = (event: MessageEvent) => {
      if (event.data?.type === 'REMOTE_COMMAND') {
        handler(event.data.command, event.data.payload);
      }
    };
    this.channel.addEventListener('message', listener);
    return () => {
      this.channel?.removeEventListener('message', listener);
    };
  }

  public async getInstallationSettings(): Promise<InstallationSettings> {
    if (this.isSupabaseConnected && this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('installation_settings')
          .select('*')
          .eq('id', 1)
          .single();
        if (!error && data) {
          return {
            approveBeforePlanting: data.approve_before_planting,
            revealHoldSeconds: data.reveal_hold_seconds,
            catchUpLimit: data.catch_up_limit,
            visitorUrl: data.visitor_url || DEFAULT_SETTINGS.visitorUrl,
            submissionsPaused: data.submissions_paused,
            qualityPreset: data.quality_preset || 'high',
          };
        }
      } catch (err) {
        console.warn('Failed to load settings from Supabase:', err);
      }
    }

    const saved = localStorage.getItem('living_garden_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (
          !parsed.visitorUrl ||
          parsed.visitorUrl.endsWith('.github.io/create') ||
          (typeof window !== 'undefined' &&
            parsed.visitorUrl.startsWith(window.location.origin) &&
            !parsed.visitorUrl.includes('/virtual-flower-garden') &&
            window.location.pathname.includes('/virtual-flower-garden'))
        ) {
          parsed.visitorUrl = getDefaultVisitorUrl();
        }
        return { ...DEFAULT_SETTINGS, ...parsed };
      } catch {
        // fallback
      }
    }
    return { ...DEFAULT_SETTINGS };
  }

  public async updateInstallationSettings(settings: Partial<InstallationSettings>): Promise<void> {
    const current = await this.getInstallationSettings();
    const updated = { ...current, ...settings };

    if (this.isSupabaseConnected && this.supabase) {
      await this.supabase.from('installation_settings').upsert({
        id: 1,
        approve_before_planting: updated.approveBeforePlanting,
        reveal_hold_seconds: updated.revealHoldSeconds,
        catch_up_limit: updated.catchUpLimit,
        visitor_url: updated.visitorUrl,
        submissions_paused: updated.submissionsPaused,
        quality_preset: updated.qualityPreset,
        updated_at: new Date().toISOString(),
      });
    }

    localStorage.setItem('living_garden_settings', JSON.stringify(updated));
  }

  public async getPublicFlowers(): Promise<PublicFlower[]> {
    if (this.isSupabaseConnected && this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('public_flowers')
          .select('*')
          .eq('status', 'approved')
          .order('slot_index', { ascending: true });

        if (!error && data && data.length > 0) {
          return data.map(this.mapSupabaseFlower);
        }
      } catch (err) {
        console.warn('Supabase fetch failed, falling back to local flowers:', err);
      }
    }

    // Local Storage Flowers
    const raw = localStorage.getItem('living_garden_public_flowers');
    if (raw) {
      try {
        const parsed: PublicFlower[] = JSON.parse(raw);
        let changed = false;

        // 1. Sync sample flowers and their collision-free placements
        for (const sf of SAMPLE_FLOWERS) {
          const existing = parsed.find((f) => f.id === sf.id);
          if (existing) {
            if (
              existing.placement.x !== sf.placement.x ||
              existing.placement.z !== sf.placement.z ||
              existing.placement.y !== sf.placement.y
            ) {
              existing.placement = { ...sf.placement };
              changed = true;
            }
          } else {
            parsed.push(sf);
            changed = true;
          }
        }

        // 2. Ensure unique slot allocation without collisions or duplicate slots
        const occupiedSlots = new Set<number>();
        // First record all sample flower slots
        for (const sf of SAMPLE_FLOWERS) {
          occupiedSlots.add(sf.placement.slotIndex);
        }

        let nextAvailableSlot = SAMPLE_FLOWERS.length;
        for (const flower of parsed) {
          if (!flower.id.startsWith('sample-')) {
            let slot = flower.placement?.slotIndex;
            if (typeof slot !== 'number' || occupiedSlots.has(slot)) {
              while (occupiedSlots.has(nextAvailableSlot)) {
                nextAvailableSlot++;
              }
              slot = nextAvailableSlot++;
              flower.placement = calculateSlotPlacement(slot, flower.seed);
              changed = true;
            } else {
              const canonicalPlacement = calculateSlotPlacement(slot, flower.seed);
              if (
                Math.abs(flower.placement.x - canonicalPlacement.x) > 0.05 ||
                Math.abs(flower.placement.z - canonicalPlacement.z) > 0.05
              ) {
                flower.placement = canonicalPlacement;
                changed = true;
              }
            }
            occupiedSlots.add(slot);
          }
        }

        if (changed) {
          localStorage.setItem('living_garden_public_flowers', JSON.stringify(parsed));
        }
        return parsed.filter((f) => f.status === 'approved');
      } catch {
        // Fallback to sample
      }
    }

    // Initialize with sample flowers if virgin database
    localStorage.setItem('living_garden_public_flowers', JSON.stringify(SAMPLE_FLOWERS));
    return [...SAMPLE_FLOWERS];
  }

  public async getAllSubmissions(): Promise<PublicFlower[]> {
    if (this.isSupabaseConnected && this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('submissions')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map(this.mapSupabaseSubmission);
        }
      } catch (err) {
        console.warn('Supabase fetch submissions failed:', err);
      }
    }

    const raw = localStorage.getItem('living_garden_public_flowers');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return SAMPLE_FLOWERS;
      }
    }
    return SAMPLE_FLOWERS;
  }

  public async submitFlower(draft: SubmissionDraft): Promise<SubmissionResponse> {
    const settings = await this.getInstallationSettings();

    if (settings.submissionsPaused) {
      return {
        success: false,
        status: 'error',
        message: 'Submissions are currently paused by the gallery operator. Please try again soon.',
      };
    }

    // 1. Enforce character and field constraints
    const message = sanitizePlainMessage(draft.message);
    if (!message || message.length === 0) {
      return {
        success: false,
        status: 'error',
        message: 'A message is required for your flower.',
      };
    }

    const sanitizedName = sanitizePlainMessage(draft.displayName);
    const displayName = sanitizedName.length > 0
      ? truncateGraphemes(sanitizedName, 40)
      : 'A visitor';
    const truncatedMessage = truncateGraphemes(message, 280);

    // 2. Validate design parameters
    const design = this.sanitizeDesign(draft.design);

    // Check idempotency in local storage or supabase
    const idempotencyKey = draft.idempotencyKey || `idem-${Date.now()}`;
    const seenMapKey = `living_garden_idem_${idempotencyKey}`;
    const existingId = localStorage.getItem(seenMapKey);

    if (existingId) {
      const allFlowers = await this.getAllSubmissions();
      const existing = allFlowers.find((f) => f.id === existingId);
      if (existing) {
        return {
          success: true,
          flower: existing,
          status: existing.status === 'approved' ? 'planted' : 'awaiting_approval',
          code: existing.code,
        };
      }
    }

    if (this.isSupabaseConnected && this.supabase) {
      try {
        // Call Supabase RPC submit_flower for atomic placement and rate-limiting
        const { data, error } = await this.supabase.rpc('submit_flower', {
          p_display_name: displayName,
          p_message: truncatedMessage,
          p_design: design,
          p_idempotency_key: idempotencyKey,
        });

        if (error) throw error;
        if (data) {
          const flower = this.mapSupabaseFlower(data);
          localStorage.setItem(seenMapKey, flower.id);
          return {
            success: true,
            flower,
            status: flower.status === 'approved' ? 'planted' : 'awaiting_approval',
            code: flower.code,
          };
        }
      } catch (err: unknown) {
        console.error('Supabase submission failed:', err);
        return {
          success: false,
          status: 'error',
          message: err instanceof Error ? err.message : 'Database error occurred. Please retry.',
        };
      }
    }

    // 3. Local Mode Atomic Slot Calculation
    const all = await this.getAllSubmissions();
    const maxOccupiedSlot = all.reduce(
      (max, f) => Math.max(max, f.placement?.slotIndex ?? -1),
      SAMPLE_FLOWERS.length - 1
    );
    const nextSlot = maxOccupiedSlot + 1;
    const seed = Math.floor(Math.random() * 1000000);
    const code = generateFlowerCode(seed);
    const placement = calculateSlotPlacement(nextSlot, seed);
    const now = new Date().toISOString();

    const status = settings.approveBeforePlanting ? 'pending' : 'approved';

    const newFlower: PublicFlower = {
      id: crypto.randomUUID ? crypto.randomUUID() : `flw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      code,
      displayName,
      message: truncatedMessage,
      design,
      generatorVersion: 1,
      seed,
      placement,
      createdAt: now,
      publishedAt: status === 'approved' ? now : '',
      status,
    };

    all.push(newFlower);
    localStorage.setItem('living_garden_public_flowers', JSON.stringify(all));
    localStorage.setItem(seenMapKey, newFlower.id);

    // Broadcast to other tabs immediately
    if (this.channel) {
      this.channel.postMessage({
        type: status === 'approved' ? 'FLOWER_PLANTED' : 'FLOWER_PENDING',
        payload: newFlower,
      });
    }

    // Notify listeners in this tab too if approved
    if (status === 'approved') {
      this.notifyAdd(newFlower);
    }

    return {
      success: true,
      flower: newFlower,
      status: status === 'approved' ? 'planted' : 'awaiting_approval',
      code: newFlower.code,
    };
  }

  public async moderateFlower(id: string, action: 'approve' | 'hide' | 'restore'): Promise<void> {
    const statusMap: Record<string, 'approved' | 'hidden'> = {
      approve: 'approved',
      restore: 'approved',
      hide: 'hidden',
    };
    const targetStatus = statusMap[action];

    if (this.isSupabaseConnected && this.supabase) {
      await this.supabase
        .from('submissions')
        .update({ status: targetStatus, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (targetStatus === 'approved') {
        // sync to public_flowers
      } else {
        await this.supabase.from('public_flowers').delete().eq('id', id);
      }
    }

    const all = await this.getAllSubmissions();
    const idx = all.findIndex((f) => f.id === id);
    if (idx !== -1) {
      all[idx].status = targetStatus;
      if (targetStatus === 'approved' && !all[idx].publishedAt) {
        all[idx].publishedAt = new Date().toISOString();
      }
      localStorage.setItem('living_garden_public_flowers', JSON.stringify(all));

      if (this.channel) {
        this.channel.postMessage({
          type: 'FLOWER_STATUS',
          payload: all[idx],
        });
      }

      if (targetStatus === 'hidden') {
        this.notifyRemove(id);
      } else {
        this.notifyAdd(all[idx]);
      }
    }
  }

  public async resetSampleGarden(): Promise<void> {
    localStorage.setItem('living_garden_public_flowers', JSON.stringify(SAMPLE_FLOWERS));
    if (this.channel) {
      this.channel.postMessage({
        type: 'GARDEN_RESET',
      });
    }
  }

  public subscribeToFlowers(
    onAdd: (flower: PublicFlower) => void,
    onRemove: (id: string) => void
  ): () => void {
    const listener = { onAdd, onRemove };
    this.listeners.push(listener);

    // Supabase Realtime Subscription if available
    let supabaseSub: unknown = null;
    if (this.isSupabaseConnected && this.supabase) {
      supabaseSub = this.supabase
        .channel('public:public_flowers')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'public_flowers' },
          (payload) => {
            const flower = this.mapSupabaseFlower(payload.new);
            onAdd(flower);
          }
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'public_flowers' },
          (payload) => {
            onRemove(payload.old.id);
          }
        )
        .subscribe();
    }

    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
      if (supabaseSub && this.supabase) {
        this.supabase.removeChannel(supabaseSub as any);
      }
    };
  }

  private notifyAdd(flower: PublicFlower): void {
    this.listeners.forEach((l) => l.onAdd(flower));
  }

  private notifyRemove(id: string): void {
    this.listeners.forEach((l) => l.onRemove(id));
  }

  private sanitizeDesign(d: Partial<FlowerDesign>): FlowerDesign {
    const validShapes = ['rounded', 'pointed', 'teardrop', 'heart', 'ruffled'] as const;
    const petalShape = validShapes.includes(d.petalShape as any) ? (d.petalShape as any) : 'rounded';

    return {
      petalShape,
      petalCount: Math.max(4, Math.min(24, Math.round(d.petalCount || 8))),
      petalLayers: Math.max(1, Math.min(3, Math.round(d.petalLayers || 1))),
      primaryColor: d.primaryColor && /^#[0-9A-Fa-f]{6}$/.test(d.primaryColor) ? d.primaryColor : '#e06c75',
      secondaryColor: d.secondaryColor && /^#[0-9A-Fa-f]{6}$/.test(d.secondaryColor) ? d.secondaryColor : '#f6b93b',
      centerColor: d.centerColor && /^#[0-9A-Fa-f]{6}$/.test(d.centerColor) ? d.centerColor : '#f39c12',
      stemColor: d.stemColor && /^#[0-9A-Fa-f]{6}$/.test(d.stemColor) ? d.stemColor : '#2d6a4f',
      petalLength: Math.max(0.6, Math.min(2.0, Number(d.petalLength) || 1.2)),
      petalWidth: Math.max(0.4, Math.min(1.8, Number(d.petalWidth) || 0.8)),
      petalCurvature: Math.max(-0.8, Math.min(0.8, Number(d.petalCurvature) || 0.0)),
      stemHeight: Math.max(0.8, Math.min(2.8, Number(d.stemHeight) || 1.6)),
      leafCount: Math.max(1, Math.min(6, Math.round(d.leafCount || 3))),
      leafSize: Math.max(0.5, Math.min(1.5, Number(d.leafSize) || 0.9)),
      imperfection: Math.max(0.0, Math.min(1.0, d.imperfection !== undefined ? Number(d.imperfection) : 0.35)),
    };
  }

  private mapSupabaseFlower(row: any): PublicFlower {
    return {
      id: row.id,
      code: row.code,
      displayName: row.display_name,
      message: row.message,
      design: row.design,
      generatorVersion: row.generator_version || 1,
      seed: row.seed || 1,
      placement: row.placement,
      createdAt: row.created_at,
      publishedAt: row.published_at || row.created_at,
      status: row.status || 'approved',
    };
  }

  private mapSupabaseSubmission(row: any): PublicFlower {
    return {
      id: row.id,
      code: row.code,
      displayName: row.display_name,
      message: row.message,
      design: row.design,
      generatorVersion: row.generator_version || 1,
      seed: row.seed || 1,
      placement: row.placement,
      createdAt: row.created_at,
      publishedAt: row.published_at || '',
      status: row.status || 'approved',
    };
  }
}

export const dataService = new DataService();

