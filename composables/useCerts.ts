export interface CertView {
  notAfter: number
  notBefore: number
  issuer?: string
  names: string[]
  trusted: boolean
  error?: string
  level: 'ok' | 'warn' | 'critical' | 'expired'
  left: string
  checkedAt: number
  failed?: string
}

/** Last certificate reading per HTTPS URL, shared by every page that shows a domain. */
export function useCerts() {
  const certs = useState<Record<string, CertView>>('hp:certs', () => ({}))
  const loaded = useState<boolean>('hp:certs-loaded', () => false)
  async function refresh() {
    try {
      certs.value = (await $fetch<{ certs: Record<string, CertView> }>('/api/certs')).certs
      loaded.value = true
    } catch {
      // keep the last known readings
    }
  }
  if (import.meta.client && !loaded.value) onMounted(() => !loaded.value && refresh())
  return { certs, refresh }
}

/** Node's verification codes, in words. */
export function certErrorText(code?: string): string {
  switch (code) {
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'self-signed'
    case 'CERT_HAS_EXPIRED':
      return 'expired'
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'for another name'
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
      return 'unknown issuer'
    default:
      return code ? 'not trusted' : ''
  }
}
