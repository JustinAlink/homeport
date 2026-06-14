// Pull a human message out of a failed $fetch. ofetch puts the JSON body in
// `e.data`, and a reverse proxy (NPM/nginx) can replace the HTTP reason phrase —
// so `e.data.statusMessage` (the body) is read first, then the less reliable
// `e.statusMessage`, then the generic message, then the caller's fallback.
export function errMsg(e: any, fallback = 'Something went wrong'): string {
  return e?.data?.statusMessage || e?.statusMessage || e?.data?.message || e?.message || fallback
}
