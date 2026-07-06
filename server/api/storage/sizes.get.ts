import { getConfig } from '../../utils/config'
import { getHosts } from '../../utils/hosts'
import { volumeSizesFor } from '../../utils/storage'
import { demoVolumeSizes } from '../../utils/demo'

// Volume disk usage (docker system df) — a separate, on-demand call because it
// walks the volume contents and can take seconds on big hosts.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) return { sizes: demoVolumeSizes() }
  try {
    return { sizes: await volumeSizesFor(getHosts()[0]) }
  } catch (e: any) {
    throw createError({ statusCode: 502, statusMessage: `could not compute sizes: ${e?.message || e}` })
  }
})
