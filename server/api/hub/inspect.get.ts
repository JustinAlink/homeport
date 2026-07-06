import { getConfig } from '../../utils/config'
import { inspectHubImage } from '../../utils/hub'
import { serviceNameFromImage } from '../../utils/autostack-core'
import { demoHubInspect } from '../../utils/demo'

// What a Docker Hub image declares (EXPOSEd tcp ports + volume paths), read
// from the registry — powers the auto-dockerize install form.
export default defineEventHandler(async (event) => {
  const image = String(getQuery(event).image || '').trim().slice(0, 200)
  if (!/^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?$/.test(image)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid image reference' })
  }

  const meta = getConfig().demo ? demoHubInspect(image) : await inspectHubImageSafe(image)
  return { image, service: serviceNameFromImage(image), ...meta }
})

async function inspectHubImageSafe(image: string) {
  try {
    return await inspectHubImage(image)
  } catch (e: any) {
    const { statusCode, statusMessage } = friendlyInspectError(e, image)
    throw createError({ statusCode, statusMessage })
  }
}

/** Turn a registry failure into a distinct, actionable message per case. */
function friendlyInspectError(e: any, image: string): { statusCode: number; statusMessage: string } {
  const msg = String(e?.message || e || '')
  if (e?.name === 'TimeoutError' || /timed out|aborted/i.test(msg)) {
    return { statusCode: 504, statusMessage: 'Docker Hub timed out — try again in a moment.' }
  }
  if (/answered 401|answered 403/.test(msg)) {
    return {
      statusCode: 404,
      statusMessage: `"${image}" is private or doesn't exist — the Docker Hub tab only auto-dockerizes public images. Use New stack → and paste the image manually if it's private.`,
    }
  }
  if (/answered 404|no linux variant|no image config/i.test(msg)) {
    return { statusCode: 404, statusMessage: `couldn't read a Linux image for "${image}" — it may be a non-container artifact.` }
  }
  return { statusCode: 502, statusMessage: `could not inspect "${image}": ${msg}` }
}
