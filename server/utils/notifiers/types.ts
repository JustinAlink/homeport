import type { AlertKind } from '../alerts-core'

export interface AlertEvent {
  id: string
  name: string
  host?: string
  kind: AlertKind
  from: string
  to: string
  at: number // unix ms
}

export interface Notifier {
  name: string
  send(event: AlertEvent): Promise<{ ok: boolean; error?: string }>
}

export type WebhookPreset = 'discord' | 'slack' | 'ntfy' | 'custom'

export interface WebhookChannel {
  name: string
  url: string
  preset: WebhookPreset
  template?: string // used when preset === 'custom'
}
