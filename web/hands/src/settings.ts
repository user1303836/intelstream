export type BloodLevel = "full" | "reduced" | "off";
export interface Settings { readonly volume: number; readonly haptics: boolean; readonly reducedMotion: boolean; readonly blood: BloodLevel }
const STORAGE_KEY = "hands.preferences.v1";
const unavailableStorage: Storage = { length: 0, clear: () => undefined, getItem: () => null, key: () => null, removeItem: () => undefined, setItem: () => undefined };
const browserStorage = (): Storage => { try { return window.localStorage; } catch { return unavailableStorage; } };
const defaults = (): Settings => ({ volume: 0.7, haptics: true, reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, blood: "full" });
export function loadSettings(storage: Storage = browserStorage()): Settings {
  const fallback = defaults();
  try {
    const raw: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null"); if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    const value = raw as Record<string, unknown>; const volume = typeof value.volume === "number" && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : fallback.volume;
    return { volume, haptics: typeof value.haptics === "boolean" ? value.haptics : fallback.haptics, reducedMotion: typeof value.reducedMotion === "boolean" ? value.reducedMotion : fallback.reducedMotion, blood: value.blood === "reduced" || value.blood === "off" || value.blood === "full" ? value.blood : fallback.blood };
  } catch { return fallback; }
}
export function saveSettings(settings: Settings, storage: Storage = browserStorage()): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ volume: Math.max(0, Math.min(1, settings.volume)), haptics: settings.haptics, reducedMotion: settings.reducedMotion, blood: settings.blood })); } catch { /* Storage can be unavailable in embedded/privacy contexts. */ }
}
export class SettingsStore {
  private value: Settings; private readonly listeners = new Set<(settings: Settings) => void>();
  constructor(storage: Storage = browserStorage()) { this.storage = storage; this.value = loadSettings(storage); }
  private readonly storage: Storage;
  get current(): Settings { return this.value; }
  update(update: Partial<Settings>): void { this.value = { ...this.value, ...update }; saveSettings(this.value, this.storage); for (const listener of this.listeners) listener(this.value); }
  subscribe(listener: (settings: Settings) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  destroy(): void { this.listeners.clear(); }
}
