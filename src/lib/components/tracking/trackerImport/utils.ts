import type { TrackerLibraryEntry } from "$lib/server-adapters/types";
import type { ImportLedger } from "./types";

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function titleSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const wordsA = new Set(norm(a));
  const wordsB = new Set(norm(b));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  return intersection / new Set([...wordsA, ...wordsB]).size;
}

export function alStatusToTrack(s: string): number {
  switch (s) {
    case "CURRENT": return 1;
    case "PLANNING": return 2;
    case "COMPLETED": return 3;
    case "PAUSED": return 4;
    case "DROPPED": return 5;
    case "REPEATING": return 6;
    default: return 2;
  }
}

export function searchQueries(remote: TrackerLibraryEntry): string[] {
  const out: string[] = [];
  for (const t of [remote.titleEnglish, remote.titleRomaji, remote.title]) {
    const s = (t ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function displayTitle(remote: TrackerLibraryEntry): string {
  return (remote.titleEnglish || remote.title || remote.titleRomaji || "Untitled").trim();
}

export function displaySub(remote: TrackerLibraryEntry): string | null {
  const primary = displayTitle(remote);
  const romaji = (remote.titleRomaji ?? "").trim();
  if (romaji && romaji !== primary) return romaji;
  return null;
}

export function scoreHit(remote: TrackerLibraryEntry, resultTitle: string): number {
  let best = 0;
  for (const q of searchQueries(remote)) {
    const s = titleSimilarity(q, resultTitle);
    if (s > best) best = s;
  }
  return best;
}

export function previouslySeenIds(ledger: ImportLedger): Set<string> {
  return new Set(Object.values(ledger.lastSeen).flat());
}
