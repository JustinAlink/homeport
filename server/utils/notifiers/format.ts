import type { AlertEvent, WebhookChannel } from './types'

// Pure formatting for webhook payloads (no I/O, no runtime imports) so it stays
// unit-testable in isolation. {{placeholder}} substitution mirrors alerts-core's
// renderTemplate (kept local to avoid a runtime cross-import).

const ICON: Record<string, string> = { down: '🔴', unhealthy: '🟠', recovered: '🟢', update: '🔵', 'domain-down': '🔴', 'domain-recovered': '🟢' }

const render = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : ''))

/** Human-readable one-liner for an alert. */
export function eventText(e: AlertEvent): string {
  const where = e.host ? ` on ${e.host}` : ''
  if (e.kind === 'domain-down') return `🔴 ${e.name} is not answering properly (${e.to}), served by ${e.from}${where}`
  if (e.kind === 'domain-recovered') return `🟢 ${e.name} answers again (${e.to})${where}`
  if (e.kind === 'recovered') return `🟢 ${e.name} recovered (${e.from} → ${e.to})${where}`
  if (e.kind === 'update') return `🔵 ${e.name}: image update available (${e.from})${where}`
  if (e.kind === 'updated')
    return e.to ? `🔴 ${e.name} auto-update failed — ${e.to}${where}` : `🟢 ${e.name} auto-updated${where}`
  const verb = e.kind === 'down' ? 'is down' : 'is unhealthy'
  return `${ICON[e.kind] || '⚠️'} ${e.name} ${verb} (${e.from} → ${e.to})${where}`
}

/** Build the request body + extra headers for a channel. */
export function buildBody(ch: WebhookChannel, e: AlertEvent): { body: string; headers?: Record<string, string> } {
  const text = eventText(e)
  switch (ch.preset) {
    case 'discord':
      return { body: JSON.stringify({ content: text }) }
    case 'slack':
      return { body: JSON.stringify({ text }) }
    case 'ntfy':
      return { body: text, headers: { 'content-type': 'text/plain', Title: `homeport · ${e.name}`, Tags: e.kind } }
    case 'apprise': {
      // POST to an Apprise API server (caronc/apprise-api). One integration reaches
      // 100+ services (Gotify/Pushover/Telegram/Matrix/…). `url` is the /notify
      // endpoint (a config key in the path = stateful; otherwise pass service `urls`).
      const type =
        e.kind === 'recovered' || e.kind === 'domain-recovered' ? 'success'
          : e.kind === 'update' ? 'info'
            : e.kind === 'updated' ? (e.to ? 'failure' : 'success')
              : e.kind === 'unhealthy' ? 'warning'
                : 'failure' // down
      const payload: Record<string, string> = { body: text, title: `homeport · ${e.name}`, type, tag: e.kind }
      if (ch.urls) payload.urls = ch.urls
      return { body: JSON.stringify(payload) }
    }
    case 'custom':
    default: {
      const vars = { name: e.name, kind: e.kind, host: e.host || '', from: e.from, to: e.to, id: e.id, text }
      return { body: render(ch.template || '{"text":"{{text}}"}', vars) }
    }
  }
}
