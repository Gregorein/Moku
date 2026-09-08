<script lang="ts">
  import { X, CircleNotch, ArrowRight, Check, Warning, Sparkle, DownloadSimple, TrayArrowDown, ArrowsClockwise, Pause, Play, Trash } from "phosphor-svelte";
  import { tsunagu } from "$lib/server-adapters/tsunagu";
  import Thumbnail from "$lib/components/shared/manga/Thumbnail.svelte";
  import ExtensionIcon from "$lib/components/extensions/ExtensionIcon.svelte";
  import TrackerLogo from "$lib/components/tracking/TrackerLogo.svelte";
  import { addToast } from "$lib/state/notifications.svelte";
  import { settingsState } from "$lib/state/settings.svelte";
  import { loadLibrary } from "$lib/state/library.svelte";
  import type { Manga, Source } from "$lib/types";
  import type { ContentType, TrackerLibraryEntry } from "$lib/server-adapters/types";
  import { toBrowseManga, toSource } from "$lib/components/browse/lib/searchFilter";
  import { sourceErrorLabel } from "$lib/core/sourceErrors";

  interface Props {
    trackerKey: string;
    trackerName: string;
    username?: string | null;
    onClose: () => void;
    onDone: () => void;
  }
  let { trackerKey, trackerName, username = null, onClose, onDone }: Props = $props();

  const SEARCH_GAP_MS = 1000;
  const MATCH_THRESHOLD = 0.3;
  const GOOD_ENOUGH = 0.55;

  const STATUSES = [
    { key: "CURRENT", label: "Reading" },
    { key: "PLANNING", label: "Planning" },
    { key: "COMPLETED", label: "Completed" },
    { key: "PAUSED", label: "On hold" },
    { key: "DROPPED", label: "Dropped" },
    { key: "REPEATING", label: "Rereading" },
  ] as const;

  type Phase = "pick-target" | "matching" | "assign" | "importing" | "done";
  type EntryStatus = "pending" | "searching" | "found" | "no-match" | "already" | "skipped" | "imported" | "failed";

  interface EntryResult {
    remote: TrackerLibraryEntry;
    match: Manga | null;
    similarity: number;
    status: EntryStatus;
    sourceId: string | null;
    error?: string;
    fresh?: boolean;
  }

  interface CachedMatch {
    title: string;
    thumbnailUrl: string;
    sourceEntryId: string;
    extensionId: string;
    inLibrary: boolean;
  }

  interface CachePayload {
    v: number;
    trackerKey: string;
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

  interface ImportLedger {
    v: number;
    lastStatuses: string[];
    lastSeen: Record<string, string[]>;
    lastFetchedAt: number;
  }

  const CACHE_VER = 1;
  const LEDGER_VER = 1;

  const EMPTY_LEDGER: ImportLedger = { v: LEDGER_VER, lastStatuses: ["CURRENT"], lastSeen: {}, lastFetchedAt: 0 };

  function titleSimilarity(a: string, b: string): number {
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    const wordsA = new Set(norm(a));
    const wordsB = new Set(norm(b));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    return intersection / new Set([...wordsA, ...wordsB]).size;
  }

  function alStatusToTrack(s: string): number {
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

  function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  function searchQueries(remote: TrackerLibraryEntry): string[] {
    const out: string[] = [];
    for (const t of [remote.titleEnglish, remote.titleRomaji, remote.title]) {
      const s = (t ?? "").trim();
      if (s && !out.includes(s)) out.push(s);
    }
    return out;
  }

  function displayTitle(remote: TrackerLibraryEntry): string {
    return (remote.titleEnglish || remote.title || remote.titleRomaji || "Untitled").trim();
  }

  function displaySub(remote: TrackerLibraryEntry): string | null {
    const primary = displayTitle(remote);
    const romaji = (remote.titleRomaji ?? "").trim();
    if (romaji && romaji !== primary) return romaji;
    return null;
  }

  function scoreHit(remote: TrackerLibraryEntry, resultTitle: string): number {
    let best = 0;
    for (const q of searchQueries(remote)) {
      const s = titleSimilarity(q, resultTitle);
      if (s > best) best = s;
    }
    return best;
  }

  let phase: Phase = $state("pick-target");
  let allSources: Source[] = $state([]);
  let loadingSources = $state(true);
  let targetSource: Source | null = $state(null);
  let selectedLang = $state("all");
  let langStripEl: HTMLDivElement | undefined = $state();
  let selectedStatuses = $state<string[]>(["CURRENT"]);
  let dryRun = $state(false);
  let cancelled = false;
  let halt = false;
  let massSourceId = $state("");
  let selectedIds = $state<string[]>([]);
  let draft: CachePayload | null = $state(null);
  let ledger: ImportLedger = $state({ ...EMPTY_LEDGER });
  let listSnapshot: TrackerLibraryEntry[] = $state([]);
  let snapshotLoading = $state(false);
  let pulledIds: string[] = $state([]);

  let entries: EntryResult[] = $state([]);
  let searchProgress = $state({ done: 0, total: 0 });
  let importProgress = $state({ done: 0, total: 0, failed: 0 });
  let retryingIds = $state<string[]>([]);

  const availableLangs = $derived.by(() => {
    const langs = Array.from(new Set<string>(allSources.map(s => s.lang))).sort();
    const en = langs.indexOf("en");
    if (en > 0) { langs.splice(en, 1); langs.unshift("en"); }
    return langs;
  });
  const hasMultipleLangs = $derived(availableLangs.length > 1);
  const visibleSources = $derived.by(() => {
    if (selectedLang !== "all") return allSources.filter(s => s.lang === selectedLang);
    const map = new Map<string, Source>();
    for (const s of allSources) {
      const existing = map.get(s.name);
      if (!existing || s.lang < existing.lang) map.set(s.name, s);
    }
    return Array.from(map.values());
  });
  const assignSources = $derived.by(() => {
    const pref = settingsState.settings.preferredExtensionLang ?? "";
    return [...allSources].sort((a, b) => {
      if (pref) {
        if (a.lang === pref && b.lang !== pref) return -1;
        if (b.lang === pref && a.lang !== pref) return 1;
      }
      return a.displayName.localeCompare(b.displayName);
    });
  });

  const foundCount = $derived(entries.filter(e => e.status === "found").length);
  const noMatchCount = $derived(entries.filter(e => e.status === "no-match").length);
  const alreadyCount = $derived(entries.filter(e => e.status === "already").length);
  const importedCount = $derived(entries.filter(e => e.status === "imported").length);
  const failedCount = $derived(entries.filter(e => e.status === "failed").length);
  const skippedCount = $derived(entries.filter(e => e.status === "skipped").length);
  const missingEntries = $derived(entries.filter(e => e.status === "no-match" || e.status === "searching" || e.status === "pending"));
  const missingIds = $derived(missingEntries.map(e => e.remote.remoteId));
  const pendingCount = $derived(entries.filter(e => e.status === "pending").length);
  const pulledSet = $derived(new Set(pulledIds));
  const statusCounts = $derived.by(() => {
    const prevAll = new Set(Object.values(ledger.lastSeen).flat());
    const hasHistory = ledger.lastFetchedAt > 0;
    const out: Record<string, { left: number; neu: number; total: number }> = {};
    for (const s of STATUSES) {
      const rows = listSnapshot.filter(e => (e.status || "").toUpperCase() === s.key);
      const left = rows.filter(e => !pulledSet.has(e.remoteId)).length;
      const neu = hasHistory ? rows.filter(e => !prevAll.has(e.remoteId) && !pulledSet.has(e.remoteId)).length : 0;
      out[s.key] = { left, neu, total: rows.length };
    }
    return out;
  });
  const leftoverTotal = $derived(STATUSES.reduce((n, s) => n + (statusCounts[s.key]?.left ?? 0), 0));
  const newTotal = $derived(STATUSES.reduce((n, s) => n + (statusCounts[s.key]?.neu ?? 0), 0));
  const allMissingSelected = $derived(missingIds.length > 0 && missingIds.every(id => selectedIds.includes(id)));
  const selectedMissing = $derived(selectedIds.filter(id => missingIds.includes(id)).length);
  const assignRows = $derived.by(() => {
    const rank = (s: EntryStatus) => {
      if (s === "searching") return 0;
      if (s === "failed") return 1;
      if (s === "pending") return 2;
      if (s === "no-match") return 3;
      if (s === "found") return 4;
      if (s === "imported") return 5;
      if (s === "skipped") return 6;
      return 7;
    };
    return entries
      .map((e, idx) => ({ e, idx }))
      .filter(x => x.e.status !== "already")
      .sort((a, b) => rank(a.e.status) - rank(b.e.status));
  });

  function sourceById(id: string | null): Source | null {
    if (!id) return targetSource;
    return allSources.find(s => s.id === id) ?? targetSource;
  }

  function sourceLabel(src: Source): string {
    return `${src.displayName} (${src.lang.toUpperCase()})`;
  }

  function cacheKey() {
    return `moku:tracker-import:${trackerKey}`;
  }

  function ledgerKey() {
    return `moku:tracker-import-ledger:${trackerKey}`;
  }

  function toCachedMatch(m: Manga | null): CachedMatch | null {
    if (!m?.sourceEntryId) return null;
    return {
      title: m.title,
      thumbnailUrl: m.thumbnailUrl,
      sourceEntryId: m.sourceEntryId,
      extensionId: m.extensionId ?? "",
      inLibrary: m.inLibrary,
    };
  }

  function fromCachedMatch(m: CachedMatch | null): Manga | null {
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

  function persistCache() {
    if (typeof localStorage === "undefined") return;
    if (entries.length === 0) return;
    const leftover = entries.some(e =>
      e.status === "pending" || e.status === "searching" || e.status === "no-match" || e.status === "found",
    );
    if (!leftover) {
      clearCache();
      return;
    }
    const payload: CachePayload = {
      v: CACHE_VER,
      trackerKey,
      sourceId: targetSource?.id ?? "",
      statuses: [...selectedStatuses],
      entries: entries.map(e => ({
        remote: e.remote,
        match: toCachedMatch(e.match),
        similarity: e.similarity,
        status: e.status === "searching" ? "pending" : e.status,
        sourceId: e.sourceId,
        error: e.error,
      })),
      searchDone: searchProgress.done,
      searchTotal: searchProgress.total,
    };
    try {
      localStorage.setItem(cacheKey(), JSON.stringify(payload));
      draft = payload;
    } catch { /* quota */ }
  }

  function clearCache() {
    try { localStorage.removeItem(cacheKey()); } catch { /* ignore */ }
    draft = null;
  }

  function readLedger(): ImportLedger {
    if (typeof localStorage === "undefined") return { ...EMPTY_LEDGER };
    try {
      const raw = localStorage.getItem(ledgerKey());
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

  function persistLedger(patch: Partial<ImportLedger>) {
    ledger = { ...ledger, ...patch, v: LEDGER_VER };
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(ledgerKey(), JSON.stringify(ledger));
    } catch { /* quota */ }
  }

  function rememberSeen(rows: TrackerLibraryEntry[], statuses: string[]) {
    const lastSeen = { ...ledger.lastSeen };
    for (const key of statuses) {
      lastSeen[key] = rows.filter(e => (e.status || "").toUpperCase() === key).map(e => e.remoteId);
    }
    persistLedger({ lastSeen, lastFetchedAt: Date.now(), lastStatuses: [...selectedStatuses] });
  }

  function previouslySeenIds(): Set<string> {
    return new Set(Object.values(ledger.lastSeen).flat());
  }

  async function refreshSnapshot() {
    snapshotLoading = true;
    try {
      const [remote, local] = await Promise.all([
        tsunagu.trackerLibrary(trackerKey, "MANGA" as ContentType, STATUSES.map(s => s.key)),
        tsunagu.library("MANGA").catch(() => []),
      ]);
      if (cancelled) return;
      listSnapshot = remote;
      pulledIds = local.flatMap(m => (m.trackLinks ?? []).filter(l => l.trackerKey === trackerKey).map(l => l.remoteId));
    } catch {
      listSnapshot = [];
    } finally {
      snapshotLoading = false;
    }
  }

  function readCache(): CachePayload | null {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(cacheKey());
      if (!raw) return null;
      const p = JSON.parse(raw) as CachePayload;
      if (p.v !== CACHE_VER || p.trackerKey !== trackerKey || !Array.isArray(p.entries) || p.entries.length === 0) return null;
      return p;
    } catch {
      return null;
    }
  }

  function applyCache(p: CachePayload) {
    selectedStatuses = p.statuses.length ? [...p.statuses] : selectedStatuses;
    targetSource = sourceById(p.sourceId);
    massSourceId = p.sourceId;
    entries = p.entries.map(e => ({
      remote: e.remote,
      match: fromCachedMatch(e.match),
      similarity: e.similarity,
      status: e.status === "searching" ? "pending" : e.status,
      sourceId: e.sourceId,
      error: e.error,
      fresh: ledger.lastFetchedAt > 0 && !previouslySeenIds().has(e.remote.remoteId) && e.status !== "already" && e.status !== "imported",
    }));
    searchProgress = { done: p.searchDone, total: p.searchTotal || p.entries.length };
  }

  function draftSourceName(): string {
    if (!draft) return "";
    return allSources.find(s => s.id === draft!.sourceId)?.displayName ?? "source";
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (phase === "matching" || phase === "importing") stopWork();
    else close();
  }

  function stopWork() {
    halt = true;
  }

  function close() {
    halt = true;
    cancelled = true;
    persistCache();
    if (listSnapshot.length) rememberSeen(listSnapshot, STATUSES.map(s => s.key));
    persistLedger({ lastStatuses: [...selectedStatuses] });
    onClose();
  }

  $effect(() => {
    tsunagu.installedExtensions()
      .then(exts => {
        allSources = exts
          .filter(e => e.installed && e.contentType === "MANGA")
          .map(toSource);
        const prefLang = settingsState.settings.preferredExtensionLang ?? "";
        const langs = new Set(allSources.map(s => s.lang));
        if (prefLang && langs.has(prefLang) && langs.size > 1) selectedLang = prefLang;
        draft = readCache();
        ledger = readLedger();
        if (!draft && ledger.lastStatuses.length) selectedStatuses = [...ledger.lastStatuses];
        void refreshSnapshot();
      })
      .catch(console.error)
      .finally(() => { loadingSources = false; });

    window.addEventListener("keydown", onKey);
    return () => {
      halt = true;
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  });

  function toggleStatus(key: string) {
    if (selectedStatuses.includes(key)) {
      if (selectedStatuses.length === 1) return;
      selectedStatuses = selectedStatuses.filter(s => s !== key);
    } else {
      selectedStatuses = [...selectedStatuses, key];
    }
    persistLedger({ lastStatuses: [...selectedStatuses] });
  }

  function scrollLangStrip(dir: -1 | 1) {
    if (!langStripEl) return;
    const chips = Array.from(langStripEl.children) as HTMLElement[];
    const viewEnd = langStripEl.scrollLeft + langStripEl.clientWidth;
    if (dir === 1) {
      const next = chips.find(c => c.offsetLeft + c.offsetWidth > viewEnd + 2);
      if (next) langStripEl.scrollTo({ left: next.offsetLeft, behavior: "smooth" });
    } else {
      const prev = [...chips].reverse().find(c => c.offsetLeft < langStripEl!.scrollLeft - 2);
      if (prev) langStripEl.scrollTo({ left: prev.offsetLeft + prev.offsetWidth - langStripEl.clientWidth, behavior: "smooth" });
    }
  }

  function patchEntry(remoteId: string, patch: Partial<EntryResult>) {
    entries = entries.map(e => e.remote.remoteId === remoteId ? { ...e, ...patch } : e);
  }

  async function matchOnSource(source: Source, remote: TrackerLibraryEntry): Promise<Pick<EntryResult, "match" | "similarity" | "status" | "error">> {
    let best: { manga: Manga; similarity: number } | null = null;
    try {
      for (const q of searchQueries(remote)) {
        const resp = await tsunagu.search(source.id, q, 1);
        for (const r of resp.results) {
          const similarity = scoreHit(remote, r.title);
          const manga = toBrowseManga(r, source.id);
          if (!best || similarity > best.similarity) best = { manga, similarity };
        }
        if (best && best.similarity >= GOOD_ENOUGH) break;
      }
    } catch (e: any) {
      return { match: null, similarity: 0, status: "no-match", error: e?.message ?? String(e) };
    }

    if (best && best.manga.inLibrary) {
      return { match: best.manga, similarity: best.similarity, status: "already" };
    }
    if (best && best.similarity > MATCH_THRESHOLD) {
      return { match: best.manga, similarity: best.similarity, status: "found" };
    }
    return { match: null, similarity: best?.similarity ?? 0, status: "no-match" };
  }

  async function startSearch(target: Source) {
    halt = false;
    targetSource = target;
    massSourceId = target.id;
    selectedIds = [];
    phase = "matching";
    entries = [];
    searchProgress = { done: 0, total: 0 };

    let remote: TrackerLibraryEntry[];
    try {
      remote = await tsunagu.trackerLibrary(trackerKey, "MANGA" as ContentType, selectedStatuses);
    } catch (e: any) {
      phase = "pick-target";
      addToast({ kind: "error", title: "Couldn't fetch AniList list", body: e?.message ?? String(e) });
      return;
    }
    if (cancelled || halt) return;

    const local = await tsunagu.library("MANGA").catch(() => []);
    const alreadyByRemote = new Set(
      local.flatMap(m => (m.trackLinks ?? []).filter(l => l.trackerKey === trackerKey).map(l => l.remoteId)),
    );
    pulledIds = [...alreadyByRemote];
    const seen = previouslySeenIds();
    const hasHistory = ledger.lastFetchedAt > 0;

    entries = remote.map(r => ({
      remote: r,
      match: null,
      similarity: 0,
      status: alreadyByRemote.has(r.remoteId) ? "already" : "pending",
      sourceId: target.id,
      fresh: hasHistory && !seen.has(r.remoteId) && !alreadyByRemote.has(r.remoteId),
    }));
    entries.sort((a, b) => {
      if (a.status === "already" && b.status !== "already") return 1;
      if (b.status === "already" && a.status !== "already") return -1;
      if (a.fresh && !b.fresh) return -1;
      if (b.fresh && !a.fresh) return 1;
      return 0;
    });
    searchProgress = { done: 0, total: entries.length };
    rememberSeen(remote, selectedStatuses);
    persistCache();
    await continueMatching();
  }

  async function resumeFromDraft() {
    if (!draft) return;
    halt = false;
    cancelled = false;
    applyCache(draft);
    selectedIds = [];
    if (!targetSource) {
      addToast({ kind: "error", title: "Source no longer installed" });
      return;
    }
    if (pendingCount > 0) {
      await continueMatching();
      return;
    }
    phase = foundCount > 0 || noMatchCount > 0 || pendingCount > 0 ? "assign" : "done";
  }

  async function continueMatching() {
    const target = targetSource;
    if (!target) return;
    halt = false;
    phase = "matching";

    for (let i = 0; i < entries.length; i++) {
      if (cancelled) return;
      if (halt) break;
      if (entries[i].status !== "pending") continue;
      entries[i] = { ...entries[i], status: "searching" };
      const result = await matchOnSource(target, entries[i].remote);
      if (cancelled) return;
      entries[i] = { ...entries[i], ...result, sourceId: target.id };
      searchProgress = {
        done: entries.filter(e => e.status !== "pending" && e.status !== "searching").length,
        total: entries.length,
      };
      persistCache();
      if (i + 1 < entries.length && !cancelled && !halt) await sleep(SEARCH_GAP_MS);
    }
    if (cancelled) return;
    persistCache();
    if (halt) {
      halt = false;
      phase = "assign";
      return;
    }
    if (entries.every(e => e.status !== "no-match" && e.status !== "pending")) {
      await startImport();
      return;
    }
    phase = "assign";
  }

  async function searchRow(remoteId: string, sourceId: string) {
    const source = sourceById(sourceId);
    const entry = entries.find(e => e.remote.remoteId === remoteId);
    if (!source || !entry) return;
    patchEntry(remoteId, { status: "searching", sourceId, match: null, error: undefined });
    const result = await matchOnSource(source, entry.remote);
    if (cancelled) return;
    patchEntry(remoteId, { ...result, sourceId });
    persistCache();
    if (result.status !== "no-match") {
      selectedIds = selectedIds.filter(id => id !== remoteId);
    }
  }

  async function searchSelected() {
    halt = false;
    cancelled = false;
    const source = sourceById(massSourceId) ?? targetSource;
    const ids = selectedIds.filter(id => missingIds.includes(id));
    if (!source || ids.length === 0) return;
    for (let i = 0; i < ids.length; i++) {
      if (cancelled || halt) return;
      await searchRow(ids[i], source.id);
      if (i + 1 < ids.length && !cancelled && !halt) await sleep(SEARCH_GAP_MS);
    }
  }

  function toggleRow(remoteId: string) {
    selectedIds = selectedIds.includes(remoteId)
      ? selectedIds.filter(id => id !== remoteId)
      : [...selectedIds, remoteId];
  }

  function toggleAllMissing() {
    selectedIds = allMissingSelected ? [] : [...missingIds];
  }

  function setDefaultSource(id: string) {
    const src = sourceById(id);
    if (!src) return;
    targetSource = src;
    massSourceId = src.id;
    entries = entries.map(e =>
      e.status === "no-match" || e.status === "pending" ? { ...e, sourceId: src.id } : e,
    );
    persistCache();
  }

  function excludeEntry(idx: number) {
    const id = entries[idx].remote.remoteId;
    entries[idx] = { ...entries[idx], status: "skipped", match: null };
    selectedIds = selectedIds.filter(x => x !== id);
    persistCache();
  }

  async function importOne(entry: EntryResult) {
    const src = sourceById(entry.sourceId);
    if (!src) throw new Error("No source for this title");
    if (!entry.match?.sourceEntryId) throw new Error("No match for this title");
    const info = await tsunagu.mangaInfo(src.id, entry.match.sourceEntryId, true);
    if (!info.inLibrary) await tsunagu.setInLibrary(info.id, true);
    if (trackerKey === "anilist") {
      try {
        await tsunagu.applyMetadataMatch(info.id, entry.remote.remoteId, "anilist");
      } catch { /* metadata is optional; tracking still binds */ }
    }
    const link = await tsunagu.bindTrack(info.id, trackerKey, entry.remote.remoteId);
    await tsunagu.updateTrack(link.id, {
      status: alStatusToTrack(entry.remote.status),
      score: entry.remote.score,
      lastChapterRead: entry.remote.progress,
    });
    await tsunagu.pullTracker(info.id).catch(() => {});
    if (!pulledIds.includes(entry.remote.remoteId)) pulledIds = [...pulledIds, entry.remote.remoteId];
  }

  async function retryImport(remoteId: string) {
    const idx = entries.findIndex(e => e.remote.remoteId === remoteId);
    if (idx < 0 || retryingIds.includes(remoteId)) return;
    const entry = entries[idx];
    if (!entry.match) {
      const src = sourceById(entry.sourceId);
      if (src) await searchRow(remoteId, src.id);
      return;
    }
    halt = false;
    cancelled = false;
    retryingIds = [...retryingIds, remoteId];
    try {
      if (dryRun) {
        entries[idx] = { ...entries[idx], status: "imported", error: undefined };
      } else {
        await importOne(entry);
        entries[idx] = { ...entries[idx], status: "imported", error: undefined };
        await loadLibrary(true);
        void refreshSnapshot();
      }
      persistCache();
    } catch (e: unknown) {
      entries[idx] = { ...entries[idx], status: "failed", error: sourceErrorLabel(e) };
      persistCache();
    } finally {
      retryingIds = retryingIds.filter(id => id !== remoteId);
    }
  }

  async function startImport() {
    const toImport = entries.filter(e => e.status === "found" && e.match);
    if (toImport.length === 0) {
      phase = (noMatchCount > 0 || pendingCount > 0 || failedCount > 0) ? "assign" : "done";
      return;
    }
    importProgress = { done: 0, total: toImport.length, failed: 0 };
    phase = "importing";

    for (const entry of toImport) {
      if (cancelled) return;
      if (halt) break;
      const idx = entries.findIndex(e => e.remote.remoteId === entry.remote.remoteId);
      if (idx < 0) continue;
      try {
        if (dryRun) {
          entries[idx] = { ...entries[idx], status: "imported" };
        } else {
          await importOne(entry);
          entries[idx] = { ...entries[idx], status: "imported" };
        }
        importProgress = { ...importProgress, done: importProgress.done + 1 };
      } catch (e: unknown) {
        entries[idx] = { ...entries[idx], status: "failed", error: sourceErrorLabel(e) };
        importProgress = { ...importProgress, done: importProgress.done + 1, failed: importProgress.failed + 1 };
      }
      persistCache();
    }

    if (!dryRun) {
      await loadLibrary(true);
      void refreshSnapshot();
    }

    if (halt) {
      halt = false;
      phase = "assign";
      return;
    }

    if (entries.some(e => e.status === "no-match" || e.status === "pending" || e.status === "found" || e.status === "failed")) {
      persistCache();
      phase = "assign";
      addToast({
        kind: "success",
        title: dryRun ? "Dry run complete" : "Imported matched titles",
        body: `${importProgress.done - importProgress.failed} imported, ${noMatchCount + pendingCount} still unmatched`,
      });
      return;
    }

    clearCache();
    phase = "done";
    addToast({
      kind: "success",
      title: dryRun ? "Dry run complete" : "Import complete",
      body: `${importProgress.done - importProgress.failed} imported, ${importProgress.failed} failed`,
    });
  }

  function exportFailed() {
    const rows = entries
      .filter(e => e.status === "failed" || e.status === "no-match" || e.status === "skipped")
      .map(e => ({
        remoteId: e.remote.remoteId,
        title: displayTitle(e.remote),
        titleEnglish: e.remote.titleEnglish,
        titleRomaji: e.remote.titleRomaji,
        url: e.remote.url,
        result: e.status,
        error: e.error ?? null,
        matchedTitle: e.match?.title ?? null,
      }));
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `anilist-import-${trackerKey}-failed.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const helloName = $derived((username ?? "").trim());
</script>

<div class="overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget && phase !== "importing") close(); }} onkeydown={(e) => { if (e.key === "Escape" && phase !== "importing") close(); }}>
  <div class="modal" class:modal-wide={phase === "assign"} class:modal-fill={phase === "matching" || phase === "assign" || phase === "importing"}>

    <div class="modal-header">
      <div class="source-context">
        <div class="source-icon-wrap logo">
          <TrackerLogo trackerKey={trackerKey} size={22} />
        </div>
        <div class="source-context-info">
          <span class="modal-eyebrow">Library import</span>
          <span class="modal-title">Import from {trackerName}</span>
          <span class="modal-sub">Manga only · match titles on one source, then assign the rest</span>
        </div>
      </div>
      {#if phase !== "importing"}
        <button class="close-btn" onclick={close}><X size={14} weight="light" /></button>
      {/if}
    </div>

    <div class="body">

      {#if phase === "pick-target"}
        {#if draft}
          <div class="resume-banner">
            <div class="resume-copy">
              <span class="resume-title">Resume import</span>
              <span class="resume-sub">{draftSourceName()} · {draft.searchDone} / {draft.searchTotal} searched</span>
            </div>
            <button class="back-btn" onclick={clearCache}><Trash size={12} weight="light" /> Discard</button>
            <button class="migrate-btn" onclick={() => void resumeFromDraft()}>
              <Play size={12} weight="bold" /> Resume
            </button>
          </div>
        {/if}
        <div class="phase-label-row">
          <span class="phase-label">List statuses</span>
        </div>
        <div class="status-chips">
          {#each STATUSES as s}
            <button
              class="status-chip"
              class:status-chip-active={selectedStatuses.includes(s.key)}
              onclick={() => toggleStatus(s.key)}
            >
              {s.label}
              {#if statusCounts[s.key]?.neu}
                <span class="chip-badge chip-badge-new">{statusCounts[s.key].left} · {statusCounts[s.key].neu} new</span>
              {:else if statusCounts[s.key]?.left}
                <span class="chip-badge">{statusCounts[s.key].left}</span>
              {/if}
            </button>
          {/each}
        </div>
        {#if snapshotLoading}
          <p class="list-hint">Checking AniList lists…</p>
        {:else if listSnapshot.length > 0}
          <p class="list-hint">
            {leftoverTotal} not in library
            {#if newTotal > 0} · {newTotal} new on AniList{/if}
            {#if ledger.lastFetchedAt}
              · last sync {new Date(ledger.lastFetchedAt).toLocaleDateString()}
            {/if}
          </p>
        {/if}

        <div class="phase-label-row">
          <span class="phase-label">Default destination source</span>
        </div>
        {#if loadingSources}
          <div class="centered"><CircleNotch size={16} weight="light" class="anim-spin" style="color:var(--text-faint)" /></div>
        {:else if allSources.length === 0}
          <div class="centered"><span class="hint">Install a manga source first.</span></div>
        {:else}
          {#if hasMultipleLangs}
            <div class="src-lang-bar">
              <button class="src-lang-nav" onclick={() => scrollLangStrip(-1)}>‹</button>
              <div class="src-lang-chips" bind:this={langStripEl}>
                <button class="src-lang-chip" class:src-lang-chip-active={selectedLang === "all"} onclick={() => selectedLang = "all"}>All</button>
                {#each availableLangs as lang}
                  <button class="src-lang-chip" class:src-lang-chip-active={selectedLang === lang} onclick={() => selectedLang = lang}>
                    {lang.toUpperCase()}
                  </button>
                {/each}
              </div>
              <button class="src-lang-nav" onclick={() => scrollLangStrip(1)}>›</button>
            </div>
          {/if}
          <div class="source-list">
            {#each visibleSources as src}
              <button class="source-row" onclick={() => startSearch(src)}>
                <div class="source-icon-wrap">
                  <ExtensionIcon src={src.iconUrl} alt={src.name} class="source-icon" size={36} />
                </div>
                <div class="source-info">
                  <span class="source-name">{src.displayName}</span>
                  <span class="source-meta">{src.lang.toUpperCase()}{src.isNsfw ? " · NSFW" : ""}</span>
                </div>
                <ArrowRight size={13} weight="light" class="source-arrow" />
              </button>
            {/each}
          </div>
        {/if}

      {:else if phase === "matching" || phase === "importing"}
        <div class="review-header">
          <div class="review-route">
            <div class="review-source">
              <TrackerLogo trackerKey={trackerKey} size={16} />
              <span class="review-source-name">{trackerName}</span>
            </div>
            <ArrowRight size={14} weight="light" style="color:var(--text-faint);flex-shrink:0" />
            {#if targetSource}
              <div class="review-source">
                <div class="source-icon-wrap small">
                  <ExtensionIcon src={targetSource.iconUrl} alt={targetSource.name} class="source-icon" size={20} />
                </div>
                <span class="review-source-name">{targetSource.displayName}</span>
              </div>
            {/if}
          </div>

          {#if phase === "matching"}
            <div class="review-progress-row">
              <div class="review-progress-bar">
                <div class="review-progress-fill" style="width:{searchProgress.total ? (searchProgress.done / searchProgress.total) * 100 : 0}%"></div>
              </div>
              <span class="review-progress-label">
                {#if searchProgress.done < searchProgress.total}
                  Searching {searchProgress.done} / {searchProgress.total}…
                {:else}
                  {foundCount} found · {alreadyCount} already · {noMatchCount} missing
                {/if}
              </span>
              <button class="stop-btn" onclick={stopWork} title="Stop matching">
                <Pause size={11} weight="fill" /> Stop
              </button>
            </div>
          {:else}
            <div class="review-progress-row">
              <div class="review-progress-bar">
                <div class="review-progress-fill" style="width:{importProgress.total ? (importProgress.done / importProgress.total) * 100 : 0}%"></div>
              </div>
              <span class="review-progress-label">{dryRun ? "Dry run" : "Importing"} {importProgress.done} / {importProgress.total}…</span>
              <button class="stop-btn" onclick={stopWork} title="Stop import">
                <Pause size={11} weight="fill" /> Stop
              </button>
            </div>
          {/if}
        </div>

        <div class="entry-list">
          {#each entries as entry}
            <div class="entry-row" class:entry-imported={entry.status === "imported"} class:entry-failed={entry.status === "failed"} class:entry-already={entry.status === "already"}>
              <div class="entry-cover-wrap">
                <Thumbnail src={entry.remote.coverUrl ?? ""} alt={displayTitle(entry.remote)} class="entry-cover" />
              </div>
              <div class="entry-info">
                <span class="entry-title">
                  <span class="entry-title-text">{displayTitle(entry.remote)}</span>
                  {#if entry.fresh}<span class="new-pill">New</span>{/if}
                </span>
                {#if displaySub(entry.remote)}
                  <span class="entry-sub">{displaySub(entry.remote)}</span>
                {/if}
                {#if entry.status === "found" && entry.match}
                  <span class="entry-match">
                    <Sparkle size={9} weight="fill" style="color:var(--accent-fg);flex-shrink:0" />
                    {entry.match.title}
                    <span class="entry-sim">{Math.round(entry.similarity * 100)}%</span>
                    <span class="entry-prog">ch. {entry.remote.progress}</span>
                  </span>
                {:else if entry.status === "no-match"}
                  <span class="entry-no-match">No match found</span>
                {:else if entry.status === "already"}
                  <span class="entry-already-label">Already in library</span>
                {:else if entry.status === "skipped"}
                  <span class="entry-no-match">Skipped</span>
                {:else if entry.status === "searching"}
                  <span class="entry-searching">Searching…</span>
                {:else if entry.status === "imported"}
                  <span class="entry-done">{dryRun ? "Would import" : "Imported"}</span>
                {:else if entry.status === "failed"}
                  <span class="entry-fail">{entry.error ?? "Failed"}</span>
                {:else if !displaySub(entry.remote)}
                  <span class="entry-searching">{entry.remote.status} · ch. {entry.remote.progress}</span>
                {/if}
              </div>
              <div class="entry-status">
                {#if entry.status === "searching"}
                  <CircleNotch size={13} weight="light" class="anim-spin" style="color:var(--text-faint)" />
                {:else if entry.status === "found" && entry.match}
                  <div class="entry-cover-match">
                    <Thumbnail src={entry.match.thumbnailUrl} alt={entry.match.title} class="entry-match-cover" />
                  </div>
                {:else if entry.status === "imported"}
                  <Check size={13} weight="bold" style="color:var(--color-success)" />
                {:else if entry.status === "failed"}
                  <Warning size={13} weight="light" style="color:var(--color-error)" />
                {:else if entry.status === "already"}
                  <Check size={13} weight="light" style="color:var(--text-faint)" />
                {/if}
              </div>
            </div>
          {/each}
        </div>

      {:else if phase === "assign"}
        <div class="assign-summary">
          <span class="assign-stats">
            {#if foundCount > 0}<span class="stat-ready">{foundCount} ready to import</span>{/if}
            {#if foundCount > 0 && missingEntries.length > 0}<span class="stat-dot">·</span>{/if}
            {#if missingEntries.length > 0}<span class="stat-unmatched">{missingEntries.length} unmatched</span>{/if}
            {#if (foundCount > 0 || missingEntries.length > 0) && alreadyCount > 0}<span class="stat-dot">·</span>{/if}
            {#if alreadyCount > 0}<span class="stat-already">{alreadyCount} already in library</span>{/if}
          </span>
          {#if assignSources.length > 0}
            <label class="assign-default">
              Default
              <select
                class="src-select"
                value={targetSource?.id ?? massSourceId}
                disabled={assignSources.length === 0}
                onchange={(e) => setDefaultSource((e.currentTarget as HTMLSelectElement).value)}
              >
                {#each assignSources as src}
                  <option value={src.id}>{sourceLabel(src)}</option>
                {/each}
              </select>
            </label>
          {/if}
        </div>

        <div class="mass-bar">
          <label class="mass-check">
            <input class="s-check" type="checkbox" checked={allMissingSelected} onchange={toggleAllMissing} />
            {selectedMissing} selected
          </label>
          <button
            class="migrate-btn mass-search-btn"
            onclick={() => void searchSelected()}
            disabled={selectedMissing === 0 || !(massSourceId || targetSource)}
          >
            <ArrowsClockwise size={12} weight="bold" />
            Search {selectedMissing}
          </button>
        </div>

        <div class="table-wrap">
          <table class="assign-table">
            <thead>
              <tr>
                <th class="col-check"></th>
                <th class="col-title">Title</th>
                <th class="col-prog">Ch.</th>
                <th class="col-src">Source</th>
                <th class="col-stat">Match</th>
              </tr>
            </thead>
            <tbody>
              {#each assignRows as { e: entry, idx } (entry.remote.remoteId)}
                <tr class:row-ok={entry.status === "found" || entry.status === "imported"}>
                  <td class="col-check">
                    {#if entry.status === "no-match" || entry.status === "searching" || entry.status === "pending"}
                      <input
                        class="s-check"
                        type="checkbox"
                        checked={selectedIds.includes(entry.remote.remoteId)}
                        disabled={entry.status === "searching"}
                        onchange={() => toggleRow(entry.remote.remoteId)}
                      />
                    {/if}
                  </td>
                    <td class="col-title">
                      <div class="table-title">
                        <div class="entry-cover-wrap">
                          <Thumbnail src={entry.remote.coverUrl ?? ""} alt={displayTitle(entry.remote)} class="entry-cover" />
                        </div>
                        <div class="entry-info">
                          <span class="entry-title">
                            <span class="entry-title-text">{displayTitle(entry.remote)}</span>
                            {#if entry.fresh}<span class="new-pill">New</span>{/if}
                          </span>
                          {#if entry.match && (entry.status === "found" || entry.status === "imported")}
                            <span class="entry-sub">{entry.match.title}</span>
                          {:else if displaySub(entry.remote)}
                            <span class="entry-sub">{displaySub(entry.remote)}</span>
                          {/if}
                        </div>
                      </div>
                    </td>
                    <td class="col-prog">{entry.remote.progress}</td>
                    <td class="col-src">
                      {#if entry.status === "imported"}
                        {@const src = sourceById(entry.sourceId)}
                        <span class="src-static">{src ? sourceLabel(src) : "—"}</span>
                      {:else}
                        <select
                          class="src-select"
                          value={entry.sourceId ?? targetSource?.id ?? ""}
                          disabled={entry.status === "searching" || retryingIds.includes(entry.remote.remoteId)}
                          onchange={(e) => void searchRow(entry.remote.remoteId, (e.currentTarget as HTMLSelectElement).value)}
                        >
                          {#each assignSources as src}
                            <option value={src.id}>{sourceLabel(src)}</option>
                          {/each}
                        </select>
                      {/if}
                    </td>
                    <td class="col-stat">
                      <div class="stat-cell">
                        {#if entry.status === "searching" || retryingIds.includes(entry.remote.remoteId)}
                          <CircleNotch size={13} weight="light" class="anim-spin" style="color:var(--text-faint)" />
                        {:else if entry.status === "pending"}
                          <span class="entry-searching">Not searched</span>
                        {:else if entry.status === "found"}
                          <Check size={13} weight="bold" style="color:var(--color-success)" />
                          <span class="entry-done">Matched</span>
                        {:else if entry.status === "imported"}
                          <Check size={13} weight="bold" style="color:var(--color-success)" />
                          <span class="entry-done">Imported</span>
                        {:else if entry.status === "failed"}
                          <Warning size={13} weight="light" style="color:var(--color-error)" />
                          <span class="entry-fail" title={entry.error}>{sourceErrorLabel(entry.error)}</span>
                          <button class="entry-exclude-btn" onclick={() => void retryImport(entry.remote.remoteId)} title="Retry import">
                            <ArrowsClockwise size={11} weight="bold" />
                          </button>
                        {:else if entry.status === "skipped"}
                          <span class="entry-no-match">Skipped</span>
                        {:else}
                          <span class="entry-no-match">No match</span>
                          <button class="entry-exclude-btn" onclick={() => excludeEntry(idx)} title="Skip this title">
                            <X size={10} weight="bold" />
                          </button>
                        {/if}
                      </div>
                    </td>
                  </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div class="review-actions">
          <div class="dry-run">
            <span>Dry run</span>
            <button
              type="button"
              class="s-toggle"
              class:on={dryRun}
              role="switch"
              aria-checked={dryRun}
              aria-label="Dry run"
              onclick={() => (dryRun = !dryRun)}
            ><span class="s-toggle-thumb"></span></button>
          </div>
          {#if pendingCount > 0}
            <button class="back-btn" onclick={() => void continueMatching()}>
              <Play size={12} weight="bold" /> Resume search
            </button>
          {/if}
          <button class="migrate-btn" onclick={() => void startImport()} disabled={foundCount === 0}>
            <TrayArrowDown size={13} weight="bold" />
            Import {foundCount} matched
          </button>
        </div>

      {:else if phase === "done"}
        <div class="welcome">
          <div class="welcome-check"><Check size={22} weight="bold" /></div>
          <h2 class="welcome-title">{helloName ? `Welcome home, ${helloName}` : "Welcome home"}</h2>
          <p class="welcome-sub">
            {importedCount} imported
            {#if alreadyCount > 0} · {alreadyCount} already in library{/if}
            {#if skippedCount > 0} · {skippedCount} skipped{/if}
            {#if failedCount > 0} · {failedCount} failed{/if}
            {#if dryRun} · dry run{/if}
          </p>
        </div>
        <div class="review-actions">
          {#if noMatchCount + failedCount + skippedCount > 0}
            <button class="back-btn" onclick={exportFailed}>
              <DownloadSimple size={12} weight="light" /> Export leftover
            </button>
          {/if}
            <button class="migrate-btn" onclick={() => { clearCache(); onDone(); }}><Check size={13} weight="bold" /> Done</button>
        </div>
      {/if}

    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; padding: 24px; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: calc(var(--z-settings) + 2); animation: fadeIn 0.1s ease both; overflow: hidden; }
  .modal { background: var(--bg-base); border: 1px solid var(--border-base); border-radius: var(--radius-xl); width: 560px; max-height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 8px 40px rgba(0,0,0,0.5); }
  .modal-wide { width: min(860px, 100%); }
  .modal-fill { align-self: stretch; }

  .modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .source-context { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
  .source-icon-wrap { width: 36px; height: 36px; border-radius: var(--radius-md); overflow: hidden; flex-shrink: 0; background: var(--bg-raised); border: 1px solid var(--border-dim); }
  .source-icon-wrap.logo { display: flex; align-items: center; justify-content: center; }
  .source-icon-wrap.small { width: 20px; height: 20px; border-radius: var(--radius-sm); }
  :global(.source-icon) { width: 100%; height: 100%; object-fit: cover; }
  .source-context-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .modal-eyebrow { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wider); text-transform: uppercase; }
  .modal-title { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-primary); letter-spacing: var(--tracking-tight); }
  .modal-sub { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .close-btn { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--radius-md); color: var(--text-faint); background: none; border: none; cursor: pointer; transition: color var(--t-base), background var(--t-base); flex-shrink: 0; margin-top: 2px; }
  .close-btn:hover { color: var(--text-muted); background: var(--bg-raised); }

  .body { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }

  .phase-label-row { padding: var(--sp-3) var(--sp-4) var(--sp-2); flex-shrink: 0; }
  .phase-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-widest); text-transform: uppercase; }
  .centered { flex: 1; display: flex; align-items: center; justify-content: center; padding: var(--sp-8); }
  .hint { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }

  .status-chips { display: flex; flex-wrap: wrap; gap: var(--sp-1); padding: 0 var(--sp-4) var(--sp-2); flex-shrink: 0; }
  .status-chip { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; white-space: nowrap; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); display: inline-flex; align-items: center; gap: 6px; }
  .status-chip:hover { color: var(--text-muted); background: var(--bg-raised); }
  .status-chip-active { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .chip-badge { font-size: 9px; letter-spacing: var(--tracking-wide); padding: 0 5px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); color: var(--text-faint); }
  .chip-badge-new { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }
  .list-hint { margin: 0; padding: 0 var(--sp-4) var(--sp-2); font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }

  .src-lang-bar { display: flex; align-items: center; gap: var(--sp-1); padding: var(--sp-2); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .src-lang-nav { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex-shrink: 0; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); font-size: 15px; line-height: 1; cursor: pointer; transition: color var(--t-base), background var(--t-base); }
  .src-lang-nav:hover { color: var(--text-muted); background: var(--bg-raised); }
  .src-lang-chips { display: flex; align-items: center; gap: var(--sp-1); flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .src-lang-chips::-webkit-scrollbar { display: none; }
  .src-lang-chip { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-dim); background: none; color: var(--text-faint); cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .src-lang-chip:hover { color: var(--text-muted); background: var(--bg-raised); }
  .src-lang-chip-active { color: var(--accent-fg); border-color: var(--accent-dim); background: var(--accent-muted); }

  .source-list { flex: 1; overflow-y: auto; padding: var(--sp-2); display: flex; flex-direction: column; gap: 1px; }
  .source-row { display: flex; align-items: center; gap: var(--sp-3); padding: 8px var(--sp-3); border-radius: var(--radius-md); border: 1px solid transparent; background: none; text-align: left; width: 100%; cursor: pointer; transition: background var(--t-fast), border-color var(--t-fast); }
  .source-row:hover { background: var(--bg-raised); border-color: var(--border-dim); }
  .source-info { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
  .source-name { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .source-meta { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  :global(.source-arrow) { color: var(--text-faint); opacity: 0; transition: opacity var(--t-base); flex-shrink: 0; }
  .source-row:hover :global(.source-arrow) { opacity: 1; }

  .review-header { padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
  .review-route { display: flex; align-items: center; gap: var(--sp-2); }
  .review-source { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
  .review-source-name { font-size: var(--text-xs); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: var(--weight-medium); }
  .review-progress-row { display: flex; align-items: center; gap: var(--sp-3); }
  .review-progress-bar { flex: 1; height: 3px; background: var(--bg-overlay); border-radius: var(--radius-full); overflow: hidden; }
  .review-progress-fill { height: 100%; background: var(--accent); border-radius: var(--radius-full); transition: width 0.3s ease; }
  .review-progress-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); white-space: nowrap; flex-shrink: 0; }
  .stop-btn { display: flex; align-items: center; gap: 4px; font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide); padding: 3px 8px; border-radius: var(--radius-sm); background: none; color: var(--text-muted); border: 1px solid var(--border-dim); cursor: pointer; flex-shrink: 0; }
  .stop-btn:hover { color: var(--color-error); border-color: var(--color-error); background: var(--bg-raised); }

  .resume-banner { display: flex; align-items: center; gap: var(--sp-2); margin: var(--sp-3) var(--sp-4) 0; padding: var(--sp-3); border: 1px solid var(--accent-dim); background: var(--accent-muted); border-radius: var(--radius-md); flex-shrink: 0; }
  .resume-copy { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .resume-title { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-primary); }
  .resume-sub { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }

  .entry-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: var(--sp-2); display: flex; flex-direction: column; gap: 1px; }
  .entry-row { display: flex; align-items: center; gap: var(--sp-3); padding: 7px var(--sp-3); border-radius: var(--radius-md); border: 1px solid transparent; transition: background var(--t-fast); }
  .entry-row:hover { background: var(--bg-raised); }
  .entry-imported { opacity: 0.5; }
  .entry-already { opacity: 0.65; }
  .entry-failed { border-color: rgba(180,60,60,0.15); background: rgba(180,60,60,0.04); }
  .entry-cover-wrap { width: 28px; height: 42px; border-radius: var(--radius-sm); overflow: hidden; background: var(--bg-raised); border: 1px solid var(--border-dim); flex-shrink: 0; }
  :global(.entry-cover) { width: 100%; height: 100%; object-fit: cover; }
  .entry-info { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; overflow: hidden; }
  .entry-title { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--text-sm); color: var(--text-secondary); }
  .entry-title-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .new-pill { flex-shrink: 0; font-family: var(--font-ui); font-size: 9px; letter-spacing: var(--tracking-wide); text-transform: uppercase; padding: 0 5px; border-radius: var(--radius-sm); color: var(--accent-fg); border: 1px solid var(--accent-dim); background: var(--accent-muted); }
  .entry-sub { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .entry-match { display: flex; align-items: center; gap: 4px; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .entry-sim { background: var(--bg-overlay); border: 1px solid var(--border-dim); border-radius: var(--radius-sm); padding: 0 4px; font-size: 9px; flex-shrink: 0; }
  .entry-prog { flex-shrink: 0; }
  .entry-no-match, .entry-searching, .entry-already-label { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .entry-done { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--color-success); letter-spacing: var(--tracking-wide); }
  .entry-fail { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--color-error); letter-spacing: var(--tracking-wide); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .entry-status { display: flex; align-items: center; gap: var(--sp-1); flex-shrink: 0; }
  .entry-cover-match { width: 24px; height: 36px; border-radius: var(--radius-sm); overflow: hidden; background: var(--bg-raised); border: 1px solid var(--border-dim); flex-shrink: 0; }
  :global(.entry-match-cover) { width: 100%; height: 100%; object-fit: cover; }
  .entry-exclude-btn { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: var(--radius-sm); color: var(--text-faint); background: none; border: none; cursor: pointer; transition: color var(--t-base), background var(--t-base); flex-shrink: 0; }
  .entry-exclude-btn:hover { color: var(--color-error); background: var(--bg-raised); }

  .assign-summary { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .assign-stats { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
  .stat-ready { color: var(--accent-fg); }
  .stat-unmatched { color: var(--text-secondary); }
  .stat-already { color: var(--text-faint); }
  .stat-dot { color: var(--text-faint); }
  .assign-default { display: flex; align-items: center; gap: 8px; color: var(--text-muted); flex-shrink: 0; }
  .mass-bar { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-4); border-bottom: 1px solid var(--border-dim); flex-shrink: 0; }
  .mass-check { display: flex; align-items: center; gap: 6px; margin-right: var(--sp-5); font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); cursor: pointer; white-space: nowrap; }
  .mass-search-btn { padding: 5px 12px; }
  .src-select {
    font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-wide);
    color: var(--text-secondary); background: var(--bg-raised); border: 1px solid var(--border-dim);
    border-radius: var(--radius-sm); padding: 4px 8px; min-width: 0; max-width: 220px; cursor: pointer;
  }
  .src-select:focus { outline: none; border-color: var(--accent-dim); }
  .src-select:disabled { opacity: 0.5; cursor: default; }
  .src-select option { background: var(--bg-surface); color: var(--text-secondary); }

  .table-wrap { flex: 1; overflow: auto; min-height: 0; }
  .assign-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  .assign-table th {
    position: sticky; top: 0; z-index: 1; background: var(--bg-base);
    font-family: var(--font-ui); font-size: 10px; letter-spacing: var(--tracking-widest); text-transform: uppercase;
    color: var(--text-faint); font-weight: var(--weight-medium); text-align: left;
    padding: 8px var(--sp-3); border-bottom: 1px solid var(--border-dim);
  }
  .assign-table td { padding: 6px var(--sp-3); border-bottom: 1px solid var(--border-dim); vertical-align: middle; }
  .assign-table tbody tr:hover { background: var(--bg-raised); }
  .col-check { width: 32px; }
  .col-prog { width: 44px; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); }
  .col-src { width: 220px; }
  .col-stat { width: 148px; }
  .stat-cell { display: flex; align-items: center; gap: 4px; }
  .col-src .src-select { width: 100%; max-width: none; }
  .src-static { font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .row-ok { opacity: 0.85; }
  .table-title { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }

  .welcome { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-3); padding: var(--sp-8) var(--sp-5); text-align: center; }
  .welcome-check { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--accent-muted); border: 1px solid var(--accent-dim); color: var(--accent-fg); }
  .welcome-title { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-medium); color: var(--text-primary); letter-spacing: var(--tracking-tight); }
  .welcome-sub { margin: 0; font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }

  .review-actions { display: flex; justify-content: flex-end; align-items: center; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); border-top: 1px solid var(--border-dim); flex-shrink: 0; }
  .back-btn { display: flex; align-items: center; gap: 6px; font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 6px 10px; border-radius: var(--radius-md); background: none; color: var(--text-muted); border: 1px solid var(--border-dim); cursor: pointer; transition: color var(--t-base), border-color var(--t-base), background var(--t-base); }
  .back-btn:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--border-strong); background: var(--bg-raised); }
  .back-btn:disabled { opacity: 0.4; cursor: default; }
  .dry-run { display: flex; align-items: center; gap: 8px; margin-right: auto; font-family: var(--font-ui); font-size: var(--text-2xs); color: var(--text-faint); letter-spacing: var(--tracking-wide); }
  .migrate-btn { display: flex; align-items: center; gap: var(--sp-2); font-family: var(--font-ui); font-size: var(--text-xs); letter-spacing: var(--tracking-wide); padding: 7px 16px; border-radius: var(--radius-md); background: var(--accent-dim); border: 1px solid var(--accent); color: var(--accent-fg); cursor: pointer; transition: background var(--t-base), border-color var(--t-base); }
  .migrate-btn:hover:not(:disabled) { background: var(--accent-muted); border-color: var(--accent-bright); }
  .migrate-btn:disabled { opacity: 0.4; cursor: default; }

  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
</style>
