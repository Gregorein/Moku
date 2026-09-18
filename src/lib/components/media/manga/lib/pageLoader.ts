export { fetchPages, resolveUrl, preloadImage, measureAspect, clearPageCache, clearResolvedUrlCache, getCachedAspect } from "$lib/core/cache/pageCache";

export const WIDE_ASPECT = 1.2;

export function buildPageGroups(urls: string[], aspects: number[], offsetSpreads: boolean): number[][] {
  const groups: number[][] = [[1]];
  if (offsetSpreads) groups.push([2]);
  let i = offsetSpreads ? 3 : 2;
  while (i <= urls.length) {
    const a = aspects[i - 1];
    if (a > WIDE_ASPECT || i === urls.length) { groups.push([i++]); continue; }
    const b = aspects[i];
    if (b > WIDE_ASPECT) { groups.push([i++]); continue; }
    groups.push([i, i + 1]); i += 2;
  }
  return groups;
}

export interface SpreadLayout {
  left:  number | null;
  right: number | null;
  full:  number | null;
}

/** Display-order pages → left/right slots. Narrow solos sit on the recto/verso; wide solos span the wrap. */
export function spreadLayout(
  vis: number[],
  rtl: boolean,
  aspectOf: (page: number) => number,
): SpreadLayout {
  if (vis.length >= 2) return { left: vis[0], right: vis[1], full: null };
  const pg = vis[0];
  if (pg == null) return { left: null, right: null, full: null };
  if (aspectOf(pg) > WIDE_ASPECT) return { left: null, right: null, full: pg };
  const odd = pg % 2 === 1;
  const onRight = rtl ? !odd : odd;
  return onRight
    ? { left: null, right: pg, full: null }
    : { left: pg, right: null, full: null };
}
