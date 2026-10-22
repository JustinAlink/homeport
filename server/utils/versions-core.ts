// Pure tag/version logic for "is there a newer version than the tag I pinned?".
// The digest check (updates.ts) only sees a rebuild of the SAME tag, so an image
// pinned to 10.9.6 never hears about 10.10.0. This reads the registry's tag list
// and finds newer tags of the same shape (same prefix, same suffix pattern, same
// precision), so 16-alpine is compared with 17-alpine, never with 17.1 or latest.

export type Bump = 'major' | 'minor' | 'patch'

/** How a tag moves: a fixed release, a line that follows newer releases (16, 1.25), or a name like latest. */
export type TagKind = 'exact' | 'line' | 'floating'

export interface NewerVersion {
  tag: string
  bump: Bump
}

export interface TagShape {
  prefix: string // '' | 'v' | 'version-' | 'release-'
  nums: number[]
  suffix: string // '-alpine', '-alpine3.20', '-ls230', ''
  suffixShape: string // the suffix with digit runs replaced, so -alpine3.19 ~ -alpine3.20
}

const VERSION_RE = /^(v|version-|release-)?(\d+(?:\.\d+){0,3})((?:[-_+][0-9A-Za-z.]+)*)$/i

export function parseVersionTag(tag: string): TagShape | null {
  const m = VERSION_RE.exec(tag.trim())
  if (!m) return null
  const nums = m[2].split('.').map(Number)
  if (nums.some((n) => !Number.isSafeInteger(n))) return null
  const suffix = m[3] || ''
  return { prefix: (m[1] || '').toLowerCase(), nums, suffix, suffixShape: suffix.replace(/\d+/g, '#') }
}

export function compareNums(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d
  }
  return 0
}

function sameShape(a: TagShape, b: TagShape): boolean {
  return a.prefix === b.prefix && a.suffixShape === b.suffixShape
}

// A repo that tags both 16 and 20240101 must not call the date a "newer major":
// a first number with two or more extra digits is a different numbering scheme.
function plausible(cur: TagShape, cand: TagShape): boolean {
  return String(cand.nums[0]).length <= String(cur.nums[0]).length + 1
}

// Calendar versions (Home Assistant's 2024.10.1) move the year without meaning a
// breaking release, so a year change counts as minor and there is no "same major".
const isCalver = (nums: number[]) => nums.length >= 2 && nums[0] >= 2000 && nums[0] <= 2100

function bumpOf(cur: number[], next: number[]): Bump {
  if (isCalver(cur)) return next[0] !== cur[0] || next[1] !== cur[1] ? 'minor' : 'patch'
  if (next[0] !== cur[0]) return 'major'
  if (next.length > 1 && next[1] !== cur[1]) return 'minor'
  return 'patch'
}

/**
 * Exact, line or floating. With the registry's tag list a tag is a line when longer
 * tags start with it (nginx 1.25 → 1.25.4 exists); without one, guess from precision.
 * Two-part tags are genuinely ambiguous (postgres 16.4 is a release, nginx 1.25 a
 * line), so that guess returns undefined rather than pretend.
 */
export function tagKindOf(tag: string, tags?: string[]): TagKind | undefined {
  const cur = parseVersionTag(tag)
  if (!cur) return 'floating'
  if (tags?.length) {
    const longer = tags.some((t) => {
      const c = parseVersionTag(t)
      return !!c && sameShape(cur, c) && c.nums.length > cur.nums.length && cur.nums.every((n, i) => c.nums[i] === n)
    })
    return longer ? 'line' : 'exact'
  }
  if (cur.nums.length >= 3) return 'exact'
  if (cur.nums.length === 1) return 'line'
  return undefined
}

/**
 * The newest tag of the same shape and precision, and, when that is a major jump,
 * the newest one on the current major (the low-risk step). Pre-releases drop out on
 * their own: 1.2.0-rc1 has a different suffix shape than 1.1.0.
 */
export function findNewer(tag: string, tags: string[]): { newer?: NewerVersion; newerSameMajor?: NewerVersion } {
  const cur = parseVersionTag(tag)
  if (!cur) return {}
  const ahead = tags
    .map((t) => ({ t, s: parseVersionTag(t) }))
    .filter((x): x is { t: string; s: TagShape } =>
      !!x.s && sameShape(cur, x.s) && x.s.nums.length === cur.nums.length && plausible(cur, x.s) && compareNums(x.s.nums, cur.nums) > 0,
    )
    .sort((a, b) => compareNums(b.s.nums, a.s.nums) || b.t.localeCompare(a.t, 'en', { numeric: true }))
  if (!ahead.length) return {}
  const top = ahead[0]
  const newer: NewerVersion = { tag: top.t, bump: bumpOf(cur.nums, top.s.nums) }
  if (newer.bump !== 'major' || cur.nums.length < 2) return { newer }
  const same = ahead.find((x) => x.s.nums[0] === cur.nums[0])
  return same ? { newer, newerSameMajor: { tag: same.t, bump: bumpOf(cur.nums, same.s.nums) } } : { newer }
}

/** `Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="…"` → its parts. */
export function parseWwwAuthenticate(header: string | null | undefined): { scheme: string; params: Record<string, string> } | null {
  if (!header) return null
  const sp = header.indexOf(' ')
  const scheme = (sp < 0 ? header : header.slice(0, sp)).trim().toLowerCase()
  const params: Record<string, string> = {}
  const re = /([a-zA-Z_]+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(header))) params[m[1].toLowerCase()] = m[2]
  return { scheme, params }
}

/** Follow a registry's `Link: </v2/…/tags/list?last=x&n=1000>; rel="next"` header, if any. */
export function nextPageUrl(link: string | null | undefined, base: string): string | undefined {
  if (!link) return undefined
  const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(link)
  if (!m) return undefined
  try {
    return new URL(m[1], base).toString()
  } catch {
    return undefined
  }
}

/** The image reference with its tag swapped, keeping registry and repo exactly as written. */
export function withTag(image: string, tag: string): string {
  const at = image.indexOf('@')
  const base = at >= 0 ? image.slice(0, at) : image
  const colon = base.lastIndexOf(':')
  const repo = colon > base.lastIndexOf('/') ? base.slice(0, colon) : base
  return `${repo}:${tag}`
}
