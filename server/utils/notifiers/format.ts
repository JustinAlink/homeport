import type { AlertEvent, WebhookChannel } from './types'

// Pure formatting for webhook payloads (no I/O, no runtime imports) so it stays
// unit-testable in isolation. {{placeholder}} substitution mirrors alerts-core's
// renderTemplate (kept local to avoid a runtime cross-import).

const ICON: Record<string, string> = { down: '🔴', unhealthy: '🟠', recovered: '🟢', update: '🔵', 'domain-down': '🔴', 'domain-recovered': '🟢' }

const render = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : ''))

// Custom templates are posted as JSON, and alert text quotes names
// ("update failed and ROLLBACK FAILED: "web" is down"), so a raw value broke the
// body exactly for the alerts that mattered most. Values are escaped for a JSON
// string, which is where every placeholder sits in a working template.
const jsonEscaped = (v: unknown) => JSON.stringify(String(v ?? '')).slice(1, -1)

/**
 * HTTP header values are bytes: Node throws on anything past Latin-1, so an emoji
 * or CJK text in a service name meant the ntfy alert never left, and even the "·"
 * in the title arrived as mojibake. ntfy decodes RFC 2047 encoded words (server
 * v2.4.0+); plain ASCII is left readable.
 */
export function headerValue(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`
}

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
      return { body: text, headers: { 'content-type': 'text/plain', Title: headerValue(`homeport · ${e.name}`), Tags: e.kind } }
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
      const raw = { name: e.name, kind: e.kind, host: e.host || '', from: e.from, to: e.to, id: e.id, text }
      const vars = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, jsonEscaped(v)]))
      return { body: render(ch.template || '{"text":"{{text}}"}', vars) }
    }
  }
}
