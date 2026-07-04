import { version } from '../../package.json'

// Running homeport version — the self-update overlay polls this to detect the
// moment the new container is serving. Auth-gated like all /api/*.
export default defineEventHandler(() => ({ version }))
