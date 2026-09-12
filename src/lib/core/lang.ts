/**
 * Language-code normalization shared across Browse, Extensions and Settings.
 *
 * Extension/source `lang` values arrive from repositories in inconsistent casing
 * (`en`, `EN`, `pt-BR`, `pt-br`, `zh-Hans`). Everything in the app compares and
 * displays a single canonical form: lowercase, `-` separated, with the sentinel
 * `all` covering "multi-language" / "no preference".
 */

export const LANG_ALL = 'all'

const ALL_ALIASES = new Set(['', '*', 'all', 'multi', 'mul', 'any'])

const DISPLAY_NAMES: Record<string, string> = {
	all: 'All',
	en: 'English',
	ja: 'Japanese',
	ko: 'Korean',
	zh: 'Chinese',
	'zh-hans': 'Chinese (Simplified)',
	'zh-hant': 'Chinese (Traditional)',
	es: 'Spanish',
	'es-419': 'Spanish (Latin America)',
	pt: 'Portuguese',
	'pt-br': 'Portuguese (Brazil)',
	'pt-pt': 'Portuguese (Portugal)',
	fr: 'French',
	de: 'German',
	it: 'Italian',
	ru: 'Russian',
	uk: 'Ukrainian',
	pl: 'Polish',
	nl: 'Dutch',
	id: 'Indonesian',
	vi: 'Vietnamese',
	th: 'Thai',
	fil: 'Filipino',
	ms: 'Malay',
	ar: 'Arabic',
	fa: 'Persian',
	he: 'Hebrew',
	tr: 'Turkish',
	hi: 'Hindi',
	bn: 'Bengali',
	ta: 'Tamil',
	te: 'Telugu',
	el: 'Greek',
	cs: 'Czech',
	sk: 'Slovak',
	hu: 'Hungarian',
	ro: 'Romanian',
	bg: 'Bulgarian',
	sr: 'Serbian',
	hr: 'Croatian',
	sv: 'Swedish',
	fi: 'Finnish',
	da: 'Danish',
	no: 'Norwegian',
	nb: 'Norwegian (Bokmål)',
	nn: 'Norwegian (Nynorsk)',
	ca: 'Catalan',
	eu: 'Basque',
	gl: 'Galician',
}

/** Ordered list of codes with a friendly name — used for pickers and suggestions. */
export const KNOWN_LANGS: string[] = Object.keys(DISPLAY_NAMES)

/** Fold any repository lang string into the app's canonical form. */
export function canonicalLang(raw: string | null | undefined): string {
	const s = (raw ?? '').trim().toLowerCase().replace(/_/g, '-')
	return ALL_ALIASES.has(s) ? LANG_ALL : s
}

/** Canonical-insensitive equality. */
export function sameLang(a: string | null | undefined, b: string | null | undefined): boolean {
	return canonicalLang(a) === canonicalLang(b)
}

/** Full human-readable name, e.g. `pt-BR` -> "Portuguese (Brazil)". */
export function displayLang(raw: string | null | undefined): string {
	const c = canonicalLang(raw)
	return DISPLAY_NAMES[c] ?? c.toUpperCase()
}

/** Short uppercase badge for chips/tags, e.g. `pt-br` -> "PT-BR", `all` -> "ALL". */
export function langBadge(raw: string | null | undefined): string {
	return canonicalLang(raw).toUpperCase()
}

/** True for the "any language" sentinel. */
export function isAllLang(raw: string | null | undefined): boolean {
	return canonicalLang(raw) === LANG_ALL
}

/** Nearest known code within edit-distance 2, for "did you mean" hints. */
export function closestLang(input: string): string | null {
	const n = canonicalLang(input).replace(/-/g, '')
	if (!n) return null
	let best: string | null = null
	let bestDist = Infinity
	for (const lang of KNOWN_LANGS) {
		const d = levenshtein(n, lang.replace(/-/g, ''))
		if (d < bestDist) {
			bestDist = d
			best = lang
		}
	}
	return bestDist <= 2 ? best : null
}

function levenshtein(a: string, b: string): number {
	const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
	for (let j = 0; j <= b.length; j++) dp[0][j] = j
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			dp[i][j] =
				a[i - 1] === b[j - 1]
					? dp[i - 1][j - 1]
					: 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
		}
	}
	return dp[a.length][b.length]
}
