import { createWebhookNotifier } from './webhook'
import type { Notifier, WebhookChannel } from './types'

/** Build the active notifier list from configured webhook channels. */
export function getNotifiers(channels: WebhookChannel[]): Notifier[] {
  return (channels || []).filter((c) => c && c.url).map(createWebhookNotifier)
}

export type { Notifier, WebhookChannel, AlertEvent } from './types'
