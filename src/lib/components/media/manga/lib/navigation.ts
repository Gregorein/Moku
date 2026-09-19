import { readerState, openReader, closeReader } from "$lib/state/mangaReader.svelte";
import type { Chapter } from "$lib/types";

interface Adjacent {
  prev: Chapter | null;
  next: Chapter | null;
}

export type PlayPeel = (dir: 1 | -1) => Promise<boolean>;

function advanceGroup(
  forward: boolean,
  adjacent: Adjacent,
  startBoundaryForward: () => void,
  startBoundaryBack: () => void,
) {
  if (!readerState.pageGroups.length) return;
  const gi = readerState.pageGroups.findIndex(g => g.includes(readerState.pageNumber));
  if (forward) {
    if (gi < readerState.pageGroups.length - 1) readerState.pageNumber = readerState.pageGroups[gi + 1][0];
    else if (adjacent.next) {
      if (readerState.pageGroups[gi].length === 1) startBoundaryForward();
      readerState.pageNumber = 1;
      openReader(adjacent.next);
    }
    else closeReader();
  } else {
    if (gi > 0) readerState.pageNumber = readerState.pageGroups[gi - 1][0];
    else if (adjacent.prev) { startBoundaryBack(); openReader(adjacent.prev); }
  }
}

export async function animateTurn(transition: string, dir: 1 | -1, fn: () => void) {
  if (transition === "none" || !transition) { fn(); return; }
  if (readerState.turning) return;
  readerState.turnDir = dir;
  readerState.turning = true;
  await new Promise(r => setTimeout(r, 100));
  fn();
  await new Promise(r => setTimeout(r, 20));
  readerState.turning = false;
}

async function fadeAcrossBoundary(dir: 1 | -1, fn: () => void) {
  if (readerState.turning) return;
  readerState.turnDir       = dir;
  readerState.turning       = true;
  readerState.boundaryFading = true;
  await new Promise(r => setTimeout(r, 100));
  fn();
  await new Promise(r => setTimeout(r, 20));
  readerState.turning       = false;
  readerState.boundaryFading = false;
}

async function tryPeel(
  dir: 1 | -1,
  playPeel: PlayPeel | undefined,
  fallback: () => void,
) {
  if (!playPeel) { fallback(); return; }
  const from = readerState.pageNumber;
  const ok = await playPeel(dir);
  if (!ok && readerState.pageNumber === from && !readerState.turning) fallback();
}

export function goForward(
  style: string,
  transition: string,
  adjacent: Adjacent,
  lastPage: number,
  onMaybeMarkRead: () => void,
  startAtLastPage: () => void,
  startBoundaryForward: () => void,
  playPeel?: PlayPeel,
) {
  if (readerState.loading) return;
  if (readerState.turning) return;
  if (style === "longstrip") {
    if (adjacent.next) { onMaybeMarkRead(); openReader(adjacent.next); }
    return;
  }
  if (style === "double" && readerState.pageGroups.length) {
    if (transition === "flip") {
      void tryPeel(1, playPeel, () => fadeAcrossBoundary(1, () => advanceGroup(true, adjacent, startBoundaryForward, () => {})));
      return;
    }
    advanceGroup(true, adjacent, startBoundaryForward, () => {});
    return;
  }
  if (!readerState.pageUrls.length) return;
  if (readerState.pageNumber < lastPage) {
    if (transition === "flip") {
      void tryPeel(1, playPeel, () => { readerState.pageNumber++; });
      return;
    }
    animateTurn(transition, 1, () => { readerState.pageNumber++; });
  } else if (adjacent.next) {
    onMaybeMarkRead();
    readerState.pageNumber = 1;
    openReader(adjacent.next);
  } else closeReader();
}

export function goBack(
  style: string,
  transition: string,
  adjacent: Adjacent,
  startAtLastPage: () => void,
  startBoundaryBack: () => void,
  playPeel?: PlayPeel,
) {
  if (readerState.loading) return;
  if (readerState.turning) return;
  if (style === "longstrip") {
    if (adjacent.prev) { startAtLastPage(); openReader(adjacent.prev); }
    return;
  }
  if (style === "double" && readerState.pageGroups.length) {
    if (transition === "flip") {
      void tryPeel(-1, playPeel, () => fadeAcrossBoundary(-1, () => advanceGroup(false, adjacent, () => {}, startBoundaryBack)));
      return;
    }
    advanceGroup(false, adjacent, () => {}, startBoundaryBack);
    return;
  }
  if (!readerState.pageUrls.length) return;
  if (readerState.pageNumber > 1) {
    if (transition === "flip") {
      void tryPeel(-1, playPeel, () => { readerState.pageNumber--; });
      return;
    }
    animateTurn(transition, -1, () => { readerState.pageNumber--; });
  } else if (adjacent.prev) { startAtLastPage(); openReader(adjacent.prev); }
}

export function jumpToPage(
  page: number,
  style: string,
  lastPage: number,
  scrollToFlatIndex: ((idx: number) => void) | null,
  activeChapterId: string,
  chunks: { chapterId: string; urls: string[] }[],
) {
  if (style === "longstrip") {
    if (!scrollToFlatIndex || !chunks.length) return;
    let offset = 0;
    for (const chunk of chunks) {
      if (chunk.chapterId === activeChapterId) {
        scrollToFlatIndex(offset + Math.max(0, page - 1));
        return;
      }
      offset += chunk.urls.length;
    }
    scrollToFlatIndex(Math.max(0, page - 1));
    return;
  }
  if (style === "double" && readerState.pageGroups.length) {
    const group = readerState.pageGroups.find(g => g.includes(page)) ?? readerState.pageGroups.findLast(g => g[0] <= page);
    if (group) readerState.pageNumber = group[0];
  } else {
    readerState.pageNumber = Math.max(1, Math.min(lastPage, page));
  }
}
