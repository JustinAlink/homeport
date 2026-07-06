// Server-side GitHub repository search (unauthenticated: 10 searches/min —
// the short cache keeps interactive use well under that). A result deploys
// through the git-backed-stacks flow: a root compose file when the repo has
// one, else a compose auto-generated from its Dockerfile.
interface GhResult {
  name: string // owner/repo
  description: string
  stars: number
  url: string // html_url
  cloneUrl: string
  archived: boolean
}

const cache = new Map<string, { at: number; data: { results: GhResult[] } }>()
const TTL_MS = 5 * 60_000

export default defineEventHandler(async (event) => {
  const q = String(getQuery(event).q || '').trim().slice(0, 100)
  const sort = String(getQuery(event).sort || '') === 'stars' ? 'stars' : ''
  if (!q) return { results: [] }

  const key = `${sort}|${q}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data

  let r: Response
  try {
    r = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=25${sort ? '&sort=stars&order=desc' : ''}`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'homeport' },
      },
    )
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: `GitHub is unreachable: ${e?.message || e}` })
  }
  if (r.status === 403 || r.status === 429) {
    throw createError({ statusCode: 429, statusMessage: 'GitHub search rate limit hit — try again in a minute.' })
  }
  if (!r.ok) throw createError({ statusCode: 502, statusMessage: `GitHub answered ${r.status}` })

  const j: any = await r.json()
  const data = {
    results: (j?.items ?? [])
      .map(
        (o: any): GhResult => ({
          name: String(o.full_name || ''),
          description: String(o.description || ''),
          stars: Number(o.stargazers_count) || 0,
          url: String(o.html_url || ''),
          cloneUrl: String(o.clone_url || ''),
          archived: !!o.archived,
        }),
      )
      .filter((x: GhResult) => x.name && x.cloneUrl && !x.archived),
  }

  if (cache.size > 100) cache.clear()
  cache.set(key, { at: Date.now(), data })
  return data
})
