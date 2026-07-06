import { getConfig } from '../../utils/config'
import { hubTop } from '../../utils/hub'
import { demoHubTop } from '../../utils/demo'

// The Hub tab's landing content: most-pulled official images (cached ~1h).
export default defineEventHandler(async () => {
  if (getConfig().demo) return demoHubTop()
  try {
    return { results: await hubTop() }
  } catch (e: any) {
    const msg = String(e?.message || e || '')
    if (/answered 429/.test(msg)) {
      throw createError({ statusCode: 429, statusMessage: 'Docker Hub rate limit hit — try again in a minute.' })
    }
    throw createError({ statusCode: 502, statusMessage: `Docker Hub is unreachable: ${msg}` })
  }
})
