import { listTokens } from '../utils/api-tokens'

// List API token metadata (never the secret). Admin-only: the middleware blocks
// API-token auth from reaching /api/tokens, so this needs a real login.
export default defineEventHandler(() => ({ tokens: listTokens() }))
