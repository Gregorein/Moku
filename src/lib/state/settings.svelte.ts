import type { Settings, PageTransition, ReaderSettings } from '$lib/types/settings'
import { DEFAULT_SETTINGS } from '$lib/types/settings'
import { saveSettings }     from '$lib/core/persistence/persist'

export const settingsState = $state({
  settings: { ...DEFAULT_SETTINGS } as Settings,
  loaded:   false,
})

function remapSlide(t: unknown): PageTransition | null {
  if (t === "slide") return "fade";
  return null;
}

function migrateSlideTransitions(s: Settings): boolean {
  let changed = false;
  const root = remapSlide(s.transition);
  if (root) { s.transition = root; changed = true; }
  for (const p of s.readerPresets ?? []) {
    const next = remapSlide(p.settings?.transition);
    if (next) { p.settings.transition = next; changed = true; }
  }
  const perManga = s.mangaReaderSettings ?? {};
  for (const id of Object.keys(perManga)) {
    const prefs = perManga[id] as ReaderSettings;
    const next = remapSlide(prefs.transition);
    if (next) { prefs.transition = next; changed = true; }
  }
  return changed;
}

export async function loadSettingsIntoState(raw: unknown) {
  if (raw && typeof raw === 'object') {
    Object.assign(settingsState.settings, raw)
  }
  if (migrateSlideTransitions(settingsState.settings)) {
    void saveSettings({ storeVersion: 2, settings: settingsState.settings })
  }
  settingsState.loaded = true
}

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settingsState.settings, patch)
  void saveSettings({ storeVersion: 2, settings: settingsState.settings })
}

