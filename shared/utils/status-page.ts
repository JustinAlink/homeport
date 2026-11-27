// The public status page: what the admin picks, what a visitor may see, and how
// the states roll up into one headline. Pure, so the server, the settings page and
// the unit tests apply the same rules.
//
// The page is meant for people without an account (family, friends, band members),
// so it is built fail-closed: nothing is shown unless it was picked by hand, and the
// public answer is assembled field by field from a fixed list (buildPublicStatus).
// No container id, image, host, port, address, URL, error text or setting can reach
// it, because nothing ever copies a service object into it.

import { uptimeTone, type UptimeTone } from '../../utils/uptime.ts'

export type StatusItemKind = 'container' | 'domain'
export type NoticeKind = 'info' | 'maintenance' | 'incident'
export const NOTICE_KINDS: NoticeKind[] = ['info', 'maintenance', 'incident']

/** One picked thing: a container by its series key (`<hostId>|<name>`) or a domain name. */
export interface StatusPageItem {
  kind: StatusItemKind
  ref: string
  /** What visitors read. Never empty once saved: it falls back to the container name or the domain. */
  name: string
}

export interface StatusPageGroup {
  /** '' = no heading */
  name: string
  items: StatusPageItem[]
}

export interface StatusPageConfig {
  title: string
  notice: string
  noticeKind: NoticeKind
  groups: StatusPageGroup[]
}

export const STATUS_PAGE_LIMITS = { title: 80, notice: 500, name: 60, group: 40, groups: 20, items: 50 } as const
export const STATUS_PAGE_DEFAULT_TITLE = 'Status'

export const emptyStatusPage = (): StatusPageConfig => ({ title: STATUS_PAGE_DEFAULT_TITLE, notice: '', noticeKind: 'info', groups: [{ name: '', items: [] }] })

// Same shape history.ts writes (isContainerKey); duplicated so this module stays free of server code.
const CONTAINER_REF = /^[\w.-]{1,64}\|[a-zA-Z0-9][\w.-]{0,254}$/
// A host name with an optional port. No scheme, path, wildcard or space: a domain
// item publishes its name, so it must be a name and nothing else.
const DOMAIN_REF = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/

export const isStatusRef = (kind: StatusItemKind, ref: string) => (kind === 'container' ? CONTAINER_REF : DOMAIN_REF).test(ref)

/** Series key of a container from its service id and name (history.ts containerKey, for the browser). */
export function statusContainerKey(id: string, name: string): string {
  const sep = id.indexOf('::')
  return `${sep >= 0 ? id.slice(0, sep) : 'default'}|${name}`
}

/** History series of a picked domain. Never matches a container key (no "|"). */
export const statusDomainKey = (domain: string) => `domain:${domain}`

/** Name shown when none was given: the container's name or the domain itself. */
export const defaultItemName = (kind: StatusItemKind, ref: string) => (kind === 'container' ? ref.slice(ref.indexOf('|') + 1) : ref)

// Characters that print nothing but can change how text reads: C0/C1 controls (a
// newline is handled by the caller), zero-width marks and the bidi overrides that
// can make "moc.elpmaxe" read as "example.com".
const INVISIBLE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g

/** Cut at max code points (never half a surrogate pair). */
function clip(s: string, max: number): string {
  const cps = Array.from(s)
  return cps.length <= max ? s : cps.slice(0, max).join('').trimEnd()
}

/** One line of plain text: no line breaks, no invisible characters, single spaces, at most max. */
export function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  return clip(raw.replace(/[\r\n\t]+/g, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim(), max)
}

/**
 * The notice is plain text, rendered as text (never HTML), so markup is kept as
 * the characters it is ("<b>" shows as <b>). Line breaks stay (at most one blank
 * line in a row); invisible characters go; at most STATUS_PAGE_LIMITS.notice.
 */
export function sanitizeNotice(raw: unknown, max: number = STATUS_PAGE_LIMITS.notice): string {
  if (typeof raw !== 'string') return ''
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return clip(text, max)
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * A saved (or posted) status page config, made safe: unknown kinds and malformed
 * refs dropped, duplicates dropped (the first one wins), lengths capped, at most
 * 20 groups and 50 items. Never throws: anything unreadable leaves less on the page,
 * not more.
 */
export function sanitizeStatusPageConfig(raw: unknown): StatusPageConfig {
  const o = isObj(raw) ? raw : {}
  const seen = new Set<string>()
  let count = 0
  const groups: StatusPageGroup[] = []
  for (const g of Array.isArray(o.groups) ? o.groups : []) {
    if (groups.length >= STATUS_PAGE_LIMITS.groups) break
    if (!isObj(g)) continue
    const items: StatusPageItem[] = []
    for (const it of Array.isArray(g.items) ? g.items : []) {
      if (count >= STATUS_PAGE_LIMITS.items) break
      if (!isObj(it) || (it.kind !== 'container' && it.kind !== 'domain')) continue
      const kind = it.kind
      let ref = typeof it.ref === 'string' ? it.ref.trim() : ''
      if (kind === 'domain') ref = ref.toLowerCase()
      if (!isStatusRef(kind, ref) || seen.has(`${kind}:${ref}`)) continue
      seen.add(`${kind}:${ref}`)
      items.push({ kind, ref, name: cleanLine(it.name, STATUS_PAGE_LIMITS.name) || defaultItemName(kind, ref) })
      count++
    }
    const name = cleanLine(g.name, STATUS_PAGE_LIMITS.group)
    if (items.length || name) groups.push({ name, items })
  }
  return {
    title: cleanLine(o.title, STATUS_PAGE_LIMITS.title) || STATUS_PAGE_DEFAULT_TITLE,
    notice: sanitizeNotice(o.notice),
    noticeKind: NOTICE_KINDS.includes(o.noticeKind as NoticeKind) ? (o.noticeKind as NoticeKind) : 'info',
    groups: groups.length ? groups : [{ name: '', items: [] }],
  }
}

// ---- state ----

export type StatusState = 'operational' | 'degraded' | 'down' | 'unknown'

/**
 * A container's state for visitors. Running and failing its health check reads
 * "degraded" (it may still answer); uptime counts that as down, like the service
 * page does. Not in the fleet, or on a host homeport can't reach: unknown.
 */
export function containerStatusState(c: { state: string; health?: string | null } | null | undefined, hostOnline = true): StatusState {
  if (!c || !hostOnline) return 'unknown'
  if (c.state !== 'running') return 'down'
  return c.health === 'unhealthy' ? 'degraded' : 'operational'
}

/** A domain answered (a 4xx is the app answering, a login page too): operational; no answer or a 5xx: down. */
export function domainStatusState(p: { status: number } | null | undefined): StatusState {
  if (!p) return 'unknown'
  return p.status === 0 || p.status >= 500 ? 'down' : 'operational'
}

export type OverallState = 'operational' | 'issues' | 'outage' | 'not-reporting' | 'unknown'

/**
 * The headline. Unknown items never make the page look better than it is: with
 * the rest fine it says some are not reporting, not "all operational".
 */
export function statusOverall(states: StatusState[]): OverallState {
  const known = states.filter((s) => s !== 'unknown')
  if (!known.length) return 'unknown'
  if (known.length === states.length && known.every((s) => s === 'down')) return 'outage'
  if (known.some((s) => s !== 'operational')) return 'issues'
  return known.length === states.length ? 'operational' : 'not-reporting'
}

export const OVERALL_TEXT: Record<OverallState, string> = {
  operational: 'All systems operational',
  issues: 'Some systems are having problems',
  outage: 'All systems are down',
  'not-reporting': 'Some systems are not reporting',
  unknown: 'Status unknown',
}

/**
 * The colour of a day bar. Today's bar can't look clean while the item is down or
 * degraded right now: a few down samples late in a long day still round to "fully
 * up" (uptimeTone calls 99.95% clean), and a visitor would see Down beside a green
 * day. Today's bar shows at least "some downtime" then; past days are as recorded.
 */
export function statusDayTone(ratio: number | null | undefined, isToday: boolean, state: StatusState): UptimeTone {
  const tone = uptimeTone(ratio)
  if (!isToday || (state !== 'down' && state !== 'degraded')) return tone
  return tone === 'bad' ? 'bad' : 'warn'
}

export const STATE_TEXT: Record<StatusState, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Unknown',
}

// ---- the public answer ----

export type UptimeWindow = '24h' | '7d' | '30d'

export interface PublicStatusItem {
  name: string
  /** only for a picked domain: its name (the thing visitors type), nothing else about it */
  domain?: string
  state: StatusState
  uptime: Record<UptimeWindow, number | null>
  /** one per calendar day in the asked time zone, oldest first; ratio null = no data */
  days: { from: number; ratio: number | null }[]
}

export interface PublicStatus {
  title: string
  notice: string
  noticeKind: NoticeKind
  overall: OverallState
  groups: { name: string; items: PublicStatusItem[] }[]
  updatedAt: number
}

export interface StatusSource {
  /** a container by series key; null = not in the fleet (or no snapshot yet), 'offline' = its host can't be reached */
  container(key: string): { state: string; health?: string | null } | 'offline' | null
  /** the last check of a domain; null = none recent (or checks are off) */
  domain(domain: string): { status: number } | null
  /** uptime of a picked item; null = not recorded (history off) */
  uptime(item: StatusPageItem): { windows: Record<UptimeWindow, number | null>; days: { from: number; ratio: number | null }[] } | null
  now: number
}

/** Five decimals, rounded DOWN: 0.999996 must not become 1 (formatUptime shows 100% only for a clean record). */
export const publicRatio = (r: number | null | undefined): number | null => (r == null || !Number.isFinite(r) ? null : Math.max(0, Math.min(1, Math.floor(r * 1e5) / 1e5)))

/**
 * Everything a visitor gets, built from the picked items only and field by field.
 * Groups without items are left out; the order is the admin's.
 */
export function buildPublicStatus(cfg: StatusPageConfig, src: StatusSource): PublicStatus {
  const groups: PublicStatus['groups'] = []
  const states: StatusState[] = []
  for (const g of cfg.groups) {
    const items: PublicStatusItem[] = []
    for (const it of g.items) {
      if (!isStatusRef(it.kind, it.ref)) continue // a hand-edited settings file: skip, never guess
      let state: StatusState
      if (it.kind === 'container') {
        const c = src.container(it.ref)
        state = c === 'offline' ? 'unknown' : containerStatusState(c)
      } else state = domainStatusState(src.domain(it.ref))
      const u = src.uptime(it)
      items.push({
        name: cleanLine(it.name, STATUS_PAGE_LIMITS.name) || defaultItemName(it.kind, it.ref),
        ...(it.kind === 'domain' ? { domain: it.ref } : {}),
        state,
        uptime: {
          '24h': publicRatio(u?.windows['24h']),
          '7d': publicRatio(u?.windows['7d']),
          '30d': publicRatio(u?.windows['30d']),
        },
        days: (u?.days ?? []).map((d) => ({ from: d.from, ratio: publicRatio(d.ratio) })),
      })
      states.push(state)
    }
    if (items.length) groups.push({ name: cleanLine(g.name, STATUS_PAGE_LIMITS.group), items })
  }
  return {
    title: cleanLine(cfg.title, STATUS_PAGE_LIMITS.title) || STATUS_PAGE_DEFAULT_TITLE,
    notice: sanitizeNotice(cfg.notice),
    noticeKind: NOTICE_KINDS.includes(cfg.noticeKind) ? cfg.noticeKind : 'info',
    overall: statusOverall(states),
    groups,
    updatedAt: src.now,
  }
}

/**
 * The visitor's Date#getTimezoneOffset(), in quarter hours (every real zone is
 * one) and within -14 h .. +12 h; anything else is UTC. The public answer is
 * cached per offset, so this also bounds the cache at 113 entries.
 */
export function normalizeTzOffset(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || Math.abs(n) > 14 * 60) return 0
  return Math.round(n / 15) * 15 || 0
}

/**
 * What a demo install shows: a small believable page for the people who use the
 * apps (two containers with an outage in their past, two domains, a notice).
 */
export const DEMO_STATUS_PAGE: StatusPageConfig = {
  title: 'Home server status',
  notice: 'Jellyfin gets its update on Sunday evening, so movies and shows may be away for about ten minutes.',
  noticeKind: 'maintenance',
  groups: [
    { name: 'Watch and listen', items: [{ kind: 'container', ref: 'default|jellyfin', name: 'Movies and TV' }] },
    {
      name: 'Websites',
      items: [
        { kind: 'domain', ref: 'blog.example.com', name: 'Blog' },
        { kind: 'domain', ref: 'vault.example.com', name: 'Password manager' },
      ],
    },
    {
      name: 'Downloads',
      items: [
        { kind: 'container', ref: 'default|qbittorrent', name: 'Download manager' },
        { kind: 'container', ref: 'default|gluetun', name: 'VPN tunnel' },
      ],
    },
  ],
}
