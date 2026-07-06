// Server-side Docker Hub search (the Hub API has no CORS) with a short cache.
// Read-only and unauthenticated upstream; auth-gated here like every endpoint.
interface HubResult {
  name: string
  description: string
  stars: number
  pulls: number
  official: boolean
}

const cache = new Map<string, { at: number; data: { results: HubResult[] } }>()
const TTL_MS = 5 * 60_000

export default defineEventHandler(async (event) => {
  const q = String(getQuery(event).q || '').trim().slice(0, 100)
  if (!q) return { results: [] }

  const hit = cache.get(q)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data

  let r: Response
  try {
    r = await fetch(
      `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(q)}&page_size=25`,
      { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } },
    )
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: `Docker Hub is unreachable: ${e?.message || e}` })
  }
  if (r.status === 429) {
    throw createError({ statusCode: 429, statusMessage: 'Docker Hub rate limit hit — try again in a minute.' })
  }
  if (!r.ok) throw createError({ statusCode: 502, statusMessage: `Docker Hub answered ${r.status}` })

  const j: any = await r.json()
  const data = {
    results: (j?.results ?? []).map(
      (o: any): HubResult => ({
        name: String(o.repo_name || ''),
        description: String(o.short_description || ''),
        stars: Number(o.star_count) || 0,
        pulls: Number(o.pull_count) || 0,
        official: !!o.is_official,
      }),
    ).filter((x: HubResult) => x.name),
  }

  if (cache.size > 100) cache.clear()
  cache.set(q, { at: Date.now(), data })
  return data
})
