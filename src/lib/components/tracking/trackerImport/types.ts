import type { Manga } from "$lib/types";
import type { ContentType, TrackerLibraryEntry } from "$lib/server-adapters/types";

export const STATUS_KEYS = ["CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING"] as const;

export type Phase = "pick-target" | "matching" | "assign" | "importing" | "done";
export type EntryStatus = "pending" | "searching" | "found" | "no-match" | "already" | "skipped" | "imported" | "failed";

export interface EntryResult {
  remote: TrackerLibraryEntry;
  match: Manga | null;
  similarity: number;
  status: EntryStatus;
  sourceId: string | null;
  error?: string;
  fresh?: boolean;
}

export interface CachedMatch {
  title: string;
  thumbnailUrl: string;
  sourceEntryId: string;
  extensionId: string;
  inLibrary: boolean;
}

export interface CachePayload {
  v: number;
  trackerKey: string;
  contentType?: ContentType;
  sourceId: string;
  statuses: string[];
  entries: Array<{
    remote: TrackerLibraryEntry;
    match: CachedMatch | null;
    similarity: number;
    status: EntryStatus;
    sourceId: string | null;
    error?: string;
  }>;
  searchDone: number;
  searchTotal: number;
}

export interface ImportLedger {
  v: number;
  lastStatuses: string[];
  lastSeen: Record<string, string[]>;
  lastFetchedAt: number;
}

export const CACHE_VER = 1;
export const LEDGER_VER = 1;

export const EMPTY_LEDGER: ImportLedger = { v: LEDGER_VER, lastStatuses: ["CURRENT"], lastSeen: {}, lastFetchedAt: 0 };

export const SEARCH_GAP_MS = 2000;
export const SEARCH_QUERY_GAP_MS = 500;
export const ANILIST_GAP_MS = 1200;
export const SNAPSHOT_TTL_MS = 15 * 60 * 1000;
export const MATCH_THRESHOLD = 0.3;
export const GOOD_ENOUGH = 0.55;
