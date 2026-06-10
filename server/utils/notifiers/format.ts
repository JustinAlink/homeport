import type { AlertEvent, WebhookChannel } from './types'

// Pure formatting for webhook payloads (no I/O, no runtime imports) so it stays
// unit-testable in isolation. {{placeholder}} substitution mirrors alerts-core's
// renderTemplate (kept local to avoid a runtime cross-import).

const ICON: Record<string, string> = { down: '🔴', unhealthy: '🟠', recovered: '🟢' }

const render = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : ''))

/** Human-readable one-liner for an alert. */
export function eventText(e: AlertEvent): string {
  const where = e.host ? ` on ${e.host}` : ''
  if (e.kind === 'recovered') return `🟢 ${e.name} recovered (${e.from} → ${e.to})${where}`
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
    case 'custom':
    default: {
      const vars = { name: e.name, kind: e.kind, host: e.host || '', from: e.from, to: e.to, id: e.id, text }
      return { body: render(ch.template || '{"text":"{{text}}"}', vars) }
    }
  }
}
