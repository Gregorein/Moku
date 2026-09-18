<script lang="ts">
  import { readerState } from "$lib/state/mangaReader.svelte";
  import type { Chapter } from "$lib/types";
  import type { PeelGeometry } from "$lib/components/media/manga/lib/pagePeel";
  import { getCachedAspect, spreadLayout } from "$lib/components/media/manga/lib/pageLoader";
  import { Books, CaretLeft, CaretRight } from "phosphor-svelte";

  export interface SpreadFlip {
    fromRight:  boolean;
    foldFull:   boolean;
    boxW:       number;
    boxH:       number;
    geom:       PeelGeometry;
    shade:      number;
    underLeft:  string | null;
    underRight: string | null;
    underFull:  string | null;
    outLeft:    string | null;
    outRight:   string | null;
    outFull:    string | null;
    flapSrc:    string | null;
    fromStart:  boolean;
    fromEnd:    boolean;
    toStart:    boolean;
    toEnd:      boolean;
  }

  interface Props {
    imgCls:            string;
    currentGroup:      number[];
    srcs:              (string | null)[];
    pageGroups:        number[][];
    rtl:               boolean;
    flip?:             SpreadFlip | null;
    mangaTitle:        string;
    prevChapter:       Chapter | null;
    nextChapter:       Chapter | null;
    onOpenPrevChapter: () => void;
    onOpenNextChapter: () => void;
    onLibrary:         () => void;
    prevPeekSrc?:      string | null;
    nextPeekSrc?:      string | null;
  }

  const {
    imgCls, currentGroup, srcs, pageGroups, rtl,
    flip = null,
    mangaTitle, prevChapter, nextChapter, onOpenPrevChapter, onOpenNextChapter, onLibrary,
    prevPeekSrc = null, nextPeekSrc = null,
  }: Props = $props();

  const idle = $derived.by(() => {
    const layout = spreadLayout(currentGroup, rtl, pg => getCachedAspect(readerState.pageUrls[pg - 1]) ?? 0.67);
    const srcOf = (pg: number | null) => {
      if (pg == null) return null;
      const i = currentGroup.indexOf(pg);
      return i >= 0 ? srcs[i] ?? null : null;
    };
    return {
      full:     layout.full,
      leftSrc:  srcOf(layout.left),
      rightSrc: srcOf(layout.right),
      fullSrc:  srcOf(layout.full),
      leftPg:   layout.left,
      rightPg:  layout.right,
    };
  });

  function neighborKind(side: "left" | "right"): "prev" | "next" {
    const startSide = rtl ? "right" : "left";
    return side === startSide ? "prev" : "next";
  }

  function allowNeighbor(side: "left" | "right", atStart: boolean, atEnd: boolean): boolean {
    return neighborKind(side) === "prev" ? atStart : atEnd;
  }

  const groupEdge = $derived.by(() => {
    const gi = pageGroups.findIndex(g => g.some(p => currentGroup.includes(p)));
    return { start: gi === 0, end: gi === pageGroups.length - 1 && gi >= 0 };
  });

  const pageAspect = $derived.by(() => {
    const pg = idle.leftPg ?? idle.rightPg ?? idle.full;
    if (pg == null) return 2 / 3;
    return getCachedAspect(readerState.pageUrls[pg - 1]) ?? 2 / 3;
  });
</script>

<div
  class="inspect-wrap"
  style="transform:scale({readerState.inspectScale}) translate({readerState.inspectPanX / readerState.inspectScale}px,{readerState.inspectPanY / readerState.inspectScale}px)"
>
  {#if pageGroups.length}
    <div
      class="double-wrap"
      class:peeling={!!flip}
      class:solo-full={!flip && idle.full != null}
      style:width={flip ? `${flip.boxW}px` : undefined}
      style:height={flip ? `${flip.boxH}px` : undefined}
      style:--page-aspect={pageAspect}
    >
      {#if flip}
        <div class="peel-under" style:clip-path={flip.geom.holeClip}>
          {#if flip.underFull}
            <img src={flip.underFull} alt="" class="{imgCls} page-full" decoding="async" draggable="false" />
          {:else}
            <div class="slot gap-left">
              {@render pageSlot(flip.underLeft, flip.underLeft ? 1 : null, "left", "", flip.toStart, flip.toEnd)}
            </div>
            <div class="slot gap-right">
              {@render pageSlot(flip.underRight, flip.underRight ? 1 : null, "right", "", flip.toStart, flip.toEnd)}
            </div>
          {/if}
        </div>
        {#if flip.geom.creaseLength > 4}
          <svg class="peel-page-shadow" viewBox="0 0 {flip.geom.boxW} {flip.geom.boxH}" preserveAspectRatio="none" style:clip-path={flip.geom.holeClip} style:opacity={flip.shade} aria-hidden="true">
            <defs>
              <linearGradient id="spread-page-shade" gradientUnits="userSpaceOnUse"
                x1={flip.geom.creaseX} y1={flip.geom.creaseY} x2={flip.geom.pageShadeToX} y2={flip.geom.pageShadeToY}>
                <stop offset="0" stop-color="#000" stop-opacity="0.46"/>
                <stop offset="0.45" stop-color="#000" stop-opacity="0.14"/>
                <stop offset="1" stop-color="#000" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#spread-page-shade)"/>
          </svg>
        {/if}
        <div class="peel-out" style:clip-path={flip.geom.outgoingClip}>
          {#if flip.outFull}
            <img src={flip.outFull} alt="" class="{imgCls} page-full" decoding="async" draggable="false" />
          {:else}
            <div class="slot gap-left">
              {@render pageSlot(flip.outLeft, flip.outLeft ? 1 : null, "left", "", flip.fromStart, flip.fromEnd)}
            </div>
            <div class="slot gap-right">
              {@render pageSlot(flip.outRight, flip.outRight ? 1 : null, "right", "", flip.fromStart, flip.fromEnd)}
            </div>
          {/if}
        </div>
        {#if flip.geom.creaseLength > 4}
          <div class="peel-flap-wrap" style:clip-path={flip.geom.flapClip}>
            <div class="peel-flap-inner" style:transform={flip.geom.flapTransform}>
              {#if flip.foldFull && flip.outFull && flip.flapSrc}
                <img class="peel-flap-img sheet" src={flip.flapSrc} alt="" draggable="false" decoding="async"
                  style:filter="brightness({1 + 0.14 * flip.shade}) contrast({1 - 0.1 * flip.shade}) saturate({1 - 0.45 * flip.shade})" />
              {:else if flip.foldFull}
                <div class="slot gap-left">
                  {#if flip.outLeft}
                    <img src={flip.outLeft} alt="" class={imgCls} decoding="async" draggable="false"
                      style:filter="brightness({1 + 0.14 * flip.shade}) contrast({1 - 0.1 * flip.shade}) saturate({1 - 0.45 * flip.shade})" />
                  {/if}
                </div>
                <div class="slot gap-right">
                  {#if flip.outRight}
                    <img src={flip.outRight} alt="" class={imgCls} decoding="async" draggable="false"
                      style:filter="brightness({1 + 0.14 * flip.shade}) contrast({1 - 0.1 * flip.shade}) saturate({1 - 0.45 * flip.shade})" />
                  {/if}
                </div>
              {:else if flip.flapSrc}
                <img
                  class="peel-flap-img"
                  class:from-right={flip.fromRight}
                  class:from-left={!flip.fromRight}
                  src={flip.flapSrc}
                  alt=""
                  draggable="false"
                  decoding="async"
                  style:filter="brightness({1 + 0.14 * flip.shade}) contrast({1 - 0.1 * flip.shade}) saturate({1 - 0.45 * flip.shade})"
                />
              {/if}
            </div>
            <div class="peel-flap-paper" style:opacity={flip.shade}></div>
            <svg class="peel-flap-shadow" viewBox="0 0 {flip.geom.boxW} {flip.geom.boxH}" preserveAspectRatio="none" style:opacity={flip.shade} aria-hidden="true">
              <defs>
                <linearGradient id="spread-flap-shade" gradientUnits="userSpaceOnUse"
                  x1={flip.geom.creaseX} y1={flip.geom.creaseY} x2={flip.geom.flapShadeToX} y2={flip.geom.flapShadeToY}>
                  <stop offset="0" stop-color="#000" stop-opacity="0.62"/>
                  <stop offset="0.4" stop-color="#000" stop-opacity="0.34"/>
                  <stop offset="1" stop-color="#000" stop-opacity="0.16"/>
                </linearGradient>
              </defs>
              <rect width="100%" height="100%" fill="url(#spread-flap-shade)"/>
            </svg>
          </div>
        {/if}
      {:else if idle.full != null}
        {#if idle.fullSrc}
          <img src={idle.fullSrc} alt="Page {idle.full}" class="{imgCls} page-full" decoding="async" draggable="false" />
        {:else}
          <div class="page-loader page-full" aria-hidden="true">{@render skeleton()}</div>
        {/if}
      {:else}
        <div class="slot gap-left">
          {@render pageSlot(idle.leftSrc, idle.leftPg, "left", `Page ${idle.leftPg}`, groupEdge.start, groupEdge.end)}
        </div>
        <div class="slot gap-right">
          {@render pageSlot(idle.rightSrc, idle.rightPg, "right", `Page ${idle.rightPg}`, groupEdge.start, groupEdge.end)}
        </div>
      {/if}
    </div>
  {:else}
    <div class="center-overlay">
      <div class="page-loader page-loader-single" aria-hidden="true">{@render skeleton()}</div>
    </div>
  {/if}
</div>

{#snippet neighbor(side: "left" | "right")}
  {@const kind = neighborKind(side)}
  {@const chapter = kind === "next" ? nextChapter : prevChapter}
  {@const onOpen = kind === "next" ? onOpenNextChapter : onOpenPrevChapter}
  {@const peekSrc = kind === "next" ? nextPeekSrc : prevPeekSrc}
  <div class="spread-neighbor" class:sn-left={side === "left"} class:sn-right={side === "right"}>
    {#if peekSrc}
      <img class="sn-peek" src={peekSrc} alt="" draggable="false" decoding="async" />
    {/if}
    <div class="sn-veil"></div>
    <div class="sn-copy">
      {#if chapter}
        <p class="sn-kicker">{kind === "next" ? "Next" : "Previous"}</p>
        <p class="sn-title">{mangaTitle}</p>
        <p class="sn-ch">{chapter.name}</p>
        <button type="button" class="sn-btn" onclick={(e) => { e.stopPropagation(); onOpen(); }}>
          {#if kind === "next"}
            Continue <CaretRight size={12} weight="bold" />
          {:else}
            <CaretLeft size={12} weight="bold" /> Continue
          {/if}
        </button>
      {:else}
        <p class="sn-kicker">{kind === "next" ? "End of series" : "Beginning"}</p>
        <p class="sn-title">{mangaTitle}</p>
      {/if}
      <button type="button" class="sn-btn sn-ghost" onclick={(e) => { e.stopPropagation(); onLibrary(); }}>
        <Books size={13} weight="regular" /> Library
      </button>
    </div>
  </div>
{/snippet}

{#snippet pageSlot(src: string | null, pg: number | null, side: "left" | "right", alt: string, atStart: boolean, atEnd: boolean)}
  {#if src}
    <img {src} {alt} class={imgCls} decoding="async" draggable="false" />
  {:else if pg != null}
    <div class="page-loader" aria-hidden="true">{@render skeleton()}</div>
  {:else if allowNeighbor(side, atStart, atEnd)}
    {@render neighbor(side)}
  {:else}
    <div class="spread-void"></div>
  {/if}
{/snippet}

{#snippet skeleton()}
  <svg class="panel-skeleton" viewBox="0 0 100 150" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <rect class="ps-r ps-r1" x="2"  y="2"  width="62" height="88" rx="1"/>
    <rect class="ps-r ps-r2" x="68" y="2"  width="30" height="42" rx="1"/>
    <rect class="ps-r ps-r3" x="68" y="48" width="30" height="42" rx="1"/>
    <rect class="ps-r ps-r4" x="2"  y="94" width="44" height="54" rx="1"/>
    <rect class="ps-r ps-r5" x="50" y="94" width="48" height="54" rx="1"/>
  </svg>
{/snippet}

<style>
  .inspect-wrap {
    --spread-h: calc(var(--visual-vh, 100vh) - 80px);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    transform-origin: center center;
    will-change: transform;
  }

  .double-wrap {
    --spread-gap: 2px;
    display: flex;
    align-items: stretch;
    justify-content: center;
    width: max-content;
    height: var(--spread-h);
    max-height: var(--spread-h);
    position: relative;
    background: var(--bg-void);
  }
  .double-wrap.solo-full {
    height: auto;
  }
  .double-wrap.peeling { overflow: hidden; }
  .double-wrap.peeling .slot {
    flex: 1 1 0;
    width: 0;
    min-width: 0;
  }
  .double-wrap.peeling .spread-neighbor,
  .double-wrap.peeling .spread-void {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
  }

  .slot {
    flex: 0 0 auto;
    height: 100%;
    display: flex;
    align-items: stretch;
    justify-content: center;
    overflow: hidden;
    background: var(--bg-void);
  }
  .gap-left  { margin-right: var(--spread-gap); }
  .gap-right { margin-left: var(--spread-gap); }

  .spread-neighbor {
    box-sizing: border-box;
    position: relative;
    height: 100%;
    aspect-ratio: var(--page-aspect, 0.67);
    width: auto;
    flex: 0 0 auto;
    overflow: hidden;
    background: var(--bg-raised);
    color: var(--text-secondary);
  }
  .sn-peek {
    position: absolute;
    inset: -8%;
    width: 116%;
    height: 116%;
    object-fit: cover;
    opacity: 0.2;
    filter: blur(2px);
    pointer-events: none;
  }
  .sn-veil {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .sn-left .sn-veil {
    background: linear-gradient(to right,
      color-mix(in srgb, var(--accent-dim) 22%, var(--bg-void)) 0%,
      color-mix(in srgb, var(--bg-void) 40%, transparent) 52%,
      transparent 100%);
  }
  .sn-right .sn-veil {
    background: linear-gradient(to left,
      color-mix(in srgb, var(--accent-dim) 22%, var(--bg-void)) 0%,
      color-mix(in srgb, var(--bg-void) 40%, transparent) 52%,
      transparent 100%);
  }
  .sn-copy {
    position: relative;
    z-index: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    gap: var(--sp-2);
    padding: var(--sp-5) var(--sp-4);
  }
  .spread-void {
    height: 100%;
    aspect-ratio: var(--page-aspect, 0.67);
    width: auto;
    flex: 0 0 auto;
  }
  .sn-kicker {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .sn-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.35;
    overflow-wrap: anywhere;
    text-shadow: 0 1px 10px var(--bg-raised);
  }
  .sn-ch {
    margin: 0 0 var(--sp-2);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .sn-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
    padding: 8px;
    border-radius: var(--radius-md);
    background: var(--accent-muted);
    border: 1px solid var(--accent-dim);
    color: var(--accent-fg);
    font-size: var(--text-sm);
    font-family: var(--font-ui);
    letter-spacing: var(--tracking-wide);
    cursor: pointer;
    transition: filter var(--t-base), background var(--t-base), color var(--t-base);
  }
  .sn-btn:hover { filter: brightness(1.12); }
  .sn-ghost {
    background: none;
    border-color: var(--border-base);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  .sn-ghost:hover { color: var(--text-muted); filter: none; }

  .double-wrap .slot > :global(img) {
    display: block;
    height: 100%;
    width: auto;
    max-width: none;
    max-height: none;
    object-fit: contain;
  }
  .page-full {
    display: block;
    max-height: var(--spread-h);
    width: auto;
    height: auto;
    object-fit: contain;
  }
  .double-wrap.peeling .page-full,
  .double-wrap.peeling .slot > :global(img) {
    max-width: 100%;
    max-height: 100%;
    height: 100%;
    width: auto;
  }

  .peel-under, .peel-out {
    display: flex;
    align-items: stretch;
  }
  .peel-under {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }
  .peel-out {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100%;
  }

  .peel-page-shadow, .peel-flap-shadow {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .peel-page-shadow { z-index: 1; }

  .peel-flap-wrap {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }
  .peel-flap-inner {
    position: absolute;
    inset: 0;
    display: flex;
    transform-origin: 0 0;
  }
  .peel-flap-img {
    width: calc(50% - var(--spread-gap));
    height: 100%;
    object-fit: contain;
    transform: scaleX(-1);
  }
  .peel-flap-img.from-right { margin-left: auto; }
  .peel-flap-img.from-left  { margin-right: auto; }
  .peel-flap-img.sheet {
    width: 100%;
    height: 100%;
    transform: none;
  }

  .peel-flap-paper {
    position: absolute;
    inset: 0;
    background: rgba(248, 244, 236, 0.52);
  }

  .center-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }

  .page-loader {
    border-radius: var(--radius-sm);
    display: flex;
    align-items: stretch;
    aspect-ratio: 2 / 3;
    height: var(--spread-h);
    max-height: var(--spread-h);
    width: auto;
    max-width: calc((var(--effective-width, 100vw) - 4px) / 2);
  }
  .page-loader-single {
    width: min(100%, var(--effective-width, 100%));
    max-width: var(--effective-width, 100%);
    max-height: var(--spread-h);
    aspect-ratio: 2 / 3;
    height: auto;
  }

  .panel-skeleton { width: 100%; height: 100%; }
  .panel-skeleton :global(.ps-r) {
    stroke: var(--border-strong); stroke-width: 0.8; fill: none;
    stroke-dasharray: 400; stroke-dashoffset: 400;
    animation: ps-shimmer 2s ease-in-out infinite;
  }
  .panel-skeleton :global(.ps-r1) { animation-delay: 0s; }
  .panel-skeleton :global(.ps-r2) { animation-delay: 0.15s; }
  .panel-skeleton :global(.ps-r3) { animation-delay: 0.3s; }
  .panel-skeleton :global(.ps-r4) { animation-delay: 0.1s; }
  .panel-skeleton :global(.ps-r5) { animation-delay: 0.25s; }

  @keyframes ps-shimmer {
    0%   { stroke-dashoffset: 400;  opacity: 0.25; }
    40%  { stroke-dashoffset: 0;    opacity: 0.55; }
    70%  { stroke-dashoffset: 0;    opacity: 0.55; }
    100% { stroke-dashoffset: -400; opacity: 0.25; }
  }
</style>
