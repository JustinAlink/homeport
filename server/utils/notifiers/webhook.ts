import { postJson } from '../http'
import { buildBody } from './format'
import type { AlertEvent, Notifier, WebhookChannel } from './types'

export { eventText, buildBody } from './format'

export function createWebhookNotifier(ch: WebhookChannel): Notifier {
  return {
    name: ch.name || ch.preset,
    async send(e: AlertEvent) {
      const { body, headers } = buildBody(ch, e)
      const r = await postJson(ch.url, body, headers)
      return { ok: r.ok, error: r.error }
    },
  }
}
