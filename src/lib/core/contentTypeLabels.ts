import type { ContentType } from '$lib/server-adapters/types'

const isAnime = (contentType: ContentType | null | undefined) => contentType === 'ANIME'

export function readVerb(contentType: ContentType | null | undefined): string {
  return isAnime(contentType) ? 'watch' : 'read'
}

export function readVerbCap(contentType: ContentType | null | undefined): string {
  return isAnime(contentType) ? 'Watch' : 'Read'
}

export function readPastTense(contentType: ContentType | null | undefined): string {
  return isAnime(contentType) ? 'watched' : 'read'
}

export function readingNoun(contentType: ContentType | null | undefined): string {
  return isAnime(contentType) ? 'watching' : 'reading'
}
