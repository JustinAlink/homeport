import { getConfig } from '../utils/config'
import { certView } from '../utils/certs'
import { demoCerts } from '../utils/demo'

// The last certificate reading per HTTPS domain (expiry, issuer, trust), for the
// chips on the Domains and service pages. Checks run in the background.
export default defineEventHandler(() => ({ certs: getConfig().demo ? demoCerts() : certView() }))
