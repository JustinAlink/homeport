import { getConfig } from '../utils/config'
import { getCatalog } from '../utils/catalog'

// App catalog: built-in + configured template sources. Browsing is always
// allowed (read-only, auth-gated like all /api/*); installing additionally
// needs the stacks capability — the UI uses `installEnabled` to gate that.
export default defineEventHandler(async (event) => {
  const cfg = getConfig()
  const refresh = String(getQuery(event).refresh || '') === '1'
  const catalog = await getCatalog(refresh)
  return {
    ...catalog,
    installEnabled: cfg.demo || cfg.allowStacks,
  }
})
