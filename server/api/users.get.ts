import { listUsers } from '../utils/users'

// List viewer account metadata (never the hash). Admin-only: the middleware
// blocks API-token and viewer-session auth from reaching /api/users, so this
// needs a real admin login.
export default defineEventHandler(() => ({ users: listUsers() }))
