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

export type WebhookPreset = 'discord' | 'slack' | 'ntfy' | 'apprise' | 'custom'

export interface WebhookChannel {
  name: string
  url: string
  preset: WebhookPreset
  template?: string // used when preset === 'custom'
  urls?: string // apprise: stateless service URLs (comma/space separated); blank = config key in the URL
}
