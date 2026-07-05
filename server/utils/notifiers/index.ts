import { createWebhookNotifier } from './webhook'
import { createEmailNotifier, type SmtpConfig } from './email'
import type { Notifier, WebhookChannel } from './types'

/** Build the active notifier list: webhook channels + the email channel when configured. */
export function getNotifiers(channels: WebhookChannel[], smtp?: SmtpConfig | null): Notifier[] {
  const list: Notifier[] = (channels || []).filter((c) => c && c.url).map(createWebhookNotifier)
  if (smtp?.host && smtp.from && smtp.to) list.push(createEmailNotifier(smtp))
  return list
}

export type { SmtpConfig } from './email'

export type { Notifier, WebhookChannel, AlertEvent } from './types'
