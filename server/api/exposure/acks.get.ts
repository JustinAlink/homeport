import { readAcks } from '../../utils/exposure'

// Accepted exposure findings, for the sidebar badge (it judges the live service
// list itself and only needs to know what was accepted).
export default defineEventHandler(() => ({ acks: readAcks() }))
