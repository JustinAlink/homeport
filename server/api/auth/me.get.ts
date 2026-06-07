// Reached only if the auth middleware let the request through → session is valid.
export default defineEventHandler(() => ({ ok: true }))
