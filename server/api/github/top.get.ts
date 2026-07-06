import { getConfig } from '../../utils/config'
import { demoGithubTop } from '../../utils/demo'

// The GitHub tab's landing content: the most-starred self-hosted projects.
// Same result shape as /api/github/search; list/index repos (awesome-*) are
// filtered out — they aren't deployable.
interface GhResult {
  name: string
  description: string
  stars: number
  url: string
  cloneUrl: string
}

let cache: { at: number; data: { results: GhResult[] } } | null = null
const TTL_MS = 60 * 60_000

export default defineEventHandler(async () => {
  if (getConfig().demo) return demoGithubTop()
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data

  let r: Response
  try {
    r = await fetch(
      'https://api.github.com/search/repositories?q=' +
        encodeURIComponent('topic:self-hosted stars:>500') +
        '&sort=stars&order=desc&per_page=20',
      {
        signal: AbortSignal.timeout(10_000),
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'homeport' },
      },
    )
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: `GitHub is unreachable: ${e?.message || e}` })
  }
  if (r.status === 403 || r.status === 429) {
    throw createError({ statusCode: 429, statusMessage: 'GitHub rate limit hit — try again in a minute.' })
  }
  if (!r.ok) throw createError({ statusCode: 502, statusMessage: `GitHub answered ${r.status}` })

  const j: any = await r.json()
  const data = {
    results: ((j?.items ?? []) as any[])
      .map(
        (o): GhResult & { archived: boolean } => ({
          name: String(o.full_name || ''),
          description: String(o.description || ''),
          stars: Number(o.stargazers_count) || 0,
          url: String(o.html_url || ''),
          cloneUrl: String(o.clone_url || ''),
          archived: !!o.archived,
        }),
      )
      .filter(
        (x) =>
          x.name &&
          x.cloneUrl &&
          !x.archived &&
          !/awesome/i.test(x.name) &&
          !/\b(list|collection|directory) of\b/i.test(x.description),
      )
      .slice(0, 12)
      .map(({ archived, ...rest }) => rest),
  }
  cache = { at: Date.now(), data }
  return data
})
