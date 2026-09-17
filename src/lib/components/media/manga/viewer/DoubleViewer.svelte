<script lang="ts">
  import { readerState } from "$lib/state/mangaReader.svelte";
  import type { PeelGeometry } from "$lib/components/media/manga/lib/pagePeel";

  export interface SpreadFlip {
    fromRight:  boolean;
    geom:       PeelGeometry;
    shade:      number;
    underLeft:  string;
    underRight: string;
    outLeft:    string;
    outRight:   string;
    flapSrc:    string;
  }

  interface Props {
    imgCls:       string;
    currentGroup: number[];
    srcs:         (string | null)[];
    pageGroups:   number[][];
    flip?:        SpreadFlip | null;
  }

  const { imgCls, currentGroup, srcs, pageGroups, flip = null }: Props = $props();
</script>

<div
  class="inspect-wrap"
  style="transform:scale({readerState.inspectScale}) translate({readerState.inspectPanX / readerState.inspectScale}px,{readerState.inspectPanY / readerState.inspectScale}px)"
>
  {#if pageGroups.length}
    <div class="double-wrap" class:peeling={!!flip}>
      {#if flip}
        <div class="peel-under">
          <img src={flip.underLeft} alt="" class="{imgCls} page-half gap-left" decoding="async" draggable="false" />
          <img src={flip.underRight} alt="" class="{imgCls} page-half gap-right" decoding="async" draggable="false" />
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
          <img src={flip.outLeft} alt="" class="{imgCls} page-half gap-left" decoding="async" draggable="false" />
          <img src={flip.outRight} alt="" class="{imgCls} page-half gap-right" decoding="async" draggable="false" />
        </div>
        {#if flip.geom.creaseLength > 4}
          <div class="peel-flap-wrap" style:clip-path={flip.geom.flapClip}>
            <div class="peel-flap-inner" style:transform={flip.geom.flapTransform}>
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
      {:else}
        {#each currentGroup as pg, i (pg)}
          {#if srcs[i]}
            <img
              src={srcs[i]}
              alt="Page {pg}"
              class="{imgCls} page-half {i === 0 ? 'gap-left' : 'gap-right'}"
              decoding="async"
              draggable="false"
            />
          {:else}
            <div class="page-loader page-half {i === 0 ? 'gap-left' : 'gap-right'}" aria-hidden="true">
              {@render skeleton()}
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  {:else}
    <div class="center-overlay">
      <div class="page-loader page-loader-single" aria-hidden="true">{@render skeleton()}</div>
    </div>
  {/if}
</div>

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
    display: flex;
    align-items: center;
    justify-content: center;
    transform-origin: center center;
    will-change: transform;
  }

  .double-wrap {
    --spread-gap: 2px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    max-width: calc(var(--effective-width, 100%) * 2);
    width: 100%;
    position: relative;
  }
  .double-wrap.peeling { overflow: hidden; }

  .page-half { flex: 1; min-width: 0; object-fit: contain; }
  .gap-left  { margin-right: var(--spread-gap); }
  .gap-right { margin-left: var(--spread-gap); }

  .peel-under, .peel-out {
    display: flex;
    align-items: flex-start;
    width: 100%;
  }
  .peel-under {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }
  .peel-out { position: relative; z-index: 2; }

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
    /* Verso sits mirrored in the folding slot so the crease reflection lands it upright. */
    transform: scaleX(-1);
  }
  .peel-flap-img.from-right { margin-left: auto; }
  .peel-flap-img.from-left  { margin-right: auto; }

  .peel-flap-paper {
    position: absolute;
    inset: 0;
    background: rgba(248, 244, 236, 0.52);
  }

  .center-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }

  .page-loader { border-radius: var(--radius-sm); display: flex; align-items: stretch; }
  .page-loader-single {
    width: min(100%, var(--effective-width, 100%));
    max-width: var(--effective-width, 100%);
    max-height: calc(var(--visual-vh, 100vh) - 80px);
    aspect-ratio: 2 / 3;
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
