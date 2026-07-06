import { getConfig } from '../utils/config'
import { getHosts } from '../utils/hosts'
import { listVolumesFor, listImagesFor } from '../utils/storage'
import { demoStorage } from '../utils/demo'

// Volumes + images on the primary host with what references each — the page
// where data that outlived its deleted stack/container becomes visible.
export default defineEventHandler(async () => {
  const cfg = getConfig()
  if (cfg.demo) return demoStorage()
  try {
    const host = getHosts()[0]
    const [volumes, images] = await Promise.all([listVolumesFor(host), listImagesFor(host)])
    return { volumes, images }
  } catch (e: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `could not list storage: ${e?.message || e} (a socket proxy needs VOLUMES=1 IMAGES=1)`,
    })
  }
})
