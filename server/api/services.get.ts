import { buildServices } from '../utils/compose'

export default defineEventHandler(async () => {
  try {
    return await buildServices()
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `Could not reach Docker: ${err?.message || err}`,
    })
  }
})
