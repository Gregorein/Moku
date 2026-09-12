import type { Manga } from "$lib/types";
import type { ContentType } from "$lib/server-adapters/types";
import { CACHE_VER, EMPTY_LEDGER, LEDGER_VER } from "./types";
import type { CachePayload, CachedMatch, EntryResult, ImportLedger } from "./types";

export function cacheKey(trackerKey: string, importKind: ContentType) {
  return `moku:tracker-import:${trackerKey}:${importKind}`;
}

export function ledgerKey(trackerKey: string, importKind: ContentType) {
  return `moku:tracker-import-ledger:${trackerKey}:${importKind}`;
}

export function legacyCacheKey(trackerKey: string) {
  return `moku:tracker-import:${trackerKey}`;
}

export function legacyLedgerKey(trackerKey: string) {
  return `moku:tracker-import-ledger:${trackerKey}`;
}

export function toCachedMatch(m: Manga | null): CachedMatch | null {
  if (!m?.sourceEntryId) return null;
  return {
    title: m.title,
    thumbnailUrl: m.thumbnailUrl,
    sourceEntryId: m.sourceEntryId,
    extensionId: m.extensionId ?? "",
    inLibrary: m.inLibrary,
  };
}

export function fromCachedMatch(m: CachedMatch | null): Manga | null {
  if (!m) return null;
  return {
    id: `${m.extensionId}-${m.sourceEntryId}`,
    title: m.title,
    thumbnailUrl: m.thumbnailUrl,
    inLibrary: m.inLibrary,
    sourceEntryId: m.sourceEntryId,
    extensionId: m.extensionId,
    sourceId: m.extensionId,
  };
}

export function buildCachePayload(
  trackerKey: string,
  importKind: ContentType,
  targetSourceId: string,
  selectedStatuses: string[],
  entries: EntryResult[],
  searchDone: number,
  searchTotal: number,
): CachePayload {
  return {
    v: CACHE_VER,
    trackerKey,
    contentType: importKind,
    sourceId: targetSourceId,
    statuses: [...selectedStatuses],
    entries: entries.map(e => ({
      remote: e.remote,
      match: toCachedMatch(e.match),
      similarity: e.similarity,
      status: e.status === "searching" ? "pending" : e.status,
      sourceId: e.sourceId,
      error: e.error,
    })),
    searchDone,
    searchTotal,
  };
}

export function hasResumableEntries(entries: EntryResult[]): boolean {
  return entries.some(e =>
    e.status === "pending" || e.status === "searching" || e.status === "no-match" || e.status === "found",
  );
}

export function writeCache(trackerKey: string, importKind: ContentType, payload: CachePayload): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(cacheKey(trackerKey, importKind), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearCacheStorage(trackerKey: string, importKind: ContentType) {
  try {
    localStorage.removeItem(cacheKey(trackerKey, importKind));
    if (importKind === "MANGA") localStorage.removeItem(legacyCacheKey(trackerKey));
  } catch {}
}

export function readCache(trackerKey: string, importKind: ContentType): CachePayload | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(trackerKey, importKind))
      ?? (importKind === "MANGA" ? localStorage.getItem(legacyCacheKey(trackerKey)) : null);
    if (!raw) return null;
    const p = JSON.parse(raw) as CachePayload;
    if (p.v !== CACHE_VER || p.trackerKey !== trackerKey || !Array.isArray(p.entries) || p.entries.length === 0) return null;
    if (p.contentType && p.contentType !== importKind) return null;
    return p;
  } catch {
    return null;
  }
}

export function readLedger(trackerKey: string, importKind: ContentType): ImportLedger {
  if (typeof localStorage === "undefined") return { ...EMPTY_LEDGER };
  try {
    const raw = localStorage.getItem(ledgerKey(trackerKey, importKind))
      ?? (importKind === "MANGA" ? localStorage.getItem(legacyLedgerKey(trackerKey)) : null);
    if (!raw) return { ...EMPTY_LEDGER };
    const p = JSON.parse(raw) as ImportLedger;
    if (p.v !== LEDGER_VER) return { ...EMPTY_LEDGER };
    return {
      v: LEDGER_VER,
      lastStatuses: Array.isArray(p.lastStatuses) && p.lastStatuses.length ? p.lastStatuses : ["CURRENT"],
      lastSeen: p.lastSeen && typeof p.lastSeen === "object" ? p.lastSeen : {},
      lastFetchedAt: typeof p.lastFetchedAt === "number" ? p.lastFetchedAt : 0,
    };
  } catch {
    return { ...EMPTY_LEDGER };
  }
}

export function writeLedger(trackerKey: string, importKind: ContentType, ledger: ImportLedger): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(ledgerKey(trackerKey, importKind), JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}
