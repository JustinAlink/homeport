// Pure app-catalog logic — template parsing (native + Portainer v2/v3),
// input validation, and compose generation. No fs/network — unit-testable.

import { stringifyYAML } from 'confbox/yaml'

/** One prompt shown on the install form; becomes a value substituted into the compose. */
export interface AppInput {
  /** Variable name — `{{NAME}}` in native compose templates / env name for Portainer apps. */
  name: string
  label: string
  description?: string
  default?: string
  required?: boolean
  /** Fixed choices (from Portainer `select`); values outside the list are rejected. */
  select?: { text: string; value: string }[]
  /** Not prompted — always uses `default` (Portainer `preset`). */
  preset?: boolean
}

export interface CatalogApp {
  slug: string
  name: string
  description: string
  categories: string[]
  /** ServiceIcon semantics: url, dashboard-icons slug, or emoji. Empty = monogram. */
  icon: string
  /** Primary image ref, for display ("what will this run?"). */
  image: string
  /** Where the template came from: 'built-in' or a source URL. */
  source: string
  /** Optional long-form notes from the template (Portainer `note`, native `notes`). May contain HTML — render as text. */
  notes?: string
  inputs: AppInput[]
  /**
   * Compose YAML. Native templates author it directly with `{{VAR}}` tokens;
   * Portainer container templates are converted at parse time (tokens included).
   */
  compose: string
}

export function slugify(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * Template descriptions are shown as plain text, but community Portainer lists
 * often carry raw markdown ("[Name](https://…) is a …"), which rendered literally
 * on catalog cards. Keep link text, drop images, tags and emphasis markers.
 */
export function plainDescription(v: unknown): string {
  return str(v)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links keep their text
    .replace(/<[^>]+>/g, '') // html tags
    .replace(/\*\*|__|`/g, '') // bold / code markers
    .replace(/^\s*#+\s*/gm, '') // headings
    .replace(/\s+/g, ' ')
    .trim()
}
const strArr = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

/**
 * Community template lists are inconsistent about category casing/formatting
 * ("development" vs "Development", "continuous-integration"). Normalize to
 * Title Case with spaces so filters merge; short all-caps input stays (CMS).
 */
// Known-broken category strings that ship mashed in community lists and can't
// be split algorithmically ('Networkother' has no casing/separator hint).
const CATEGORY_ALIASES: Record<string, string> = {
  networkother: 'Network',
  networkweb: 'Network',
  networking: 'Network',
}

export function normalizeCategory(raw: string): string {
  const aliased = CATEGORY_ALIASES[raw.trim().toLowerCase()]
  if (aliased) return aliased
  const c = raw.trim().replace(/([a-z])([A-Z])/g, '$1 $2') // NetworkOther → Network Other
  if (!c) return ''
  if (c.length <= 5 && c === c.toUpperCase()) return c
  return c
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

// some community lists join categories with commas in ONE string ("Network,Other")
const categoryArr = (v: unknown) =>
  [...new Set(strArr(v).flatMap((s) => s.split(',')).map(normalizeCategory).filter(Boolean))]

function sanitizeInput(raw: unknown): AppInput | null {
  const o = (raw ?? {}) as Record<string, unknown>
  const name = str(o.name)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null
  const input: AppInput = { name, label: str(o.label) || name }
  const description = str(o.description)
  if (description) input.description = description
  if (o.default !== undefined) input.default = String(o.default)
  if (o.required === true) input.required = true
  if (o.preset === true) input.preset = true
  if (Array.isArray(o.select)) {
    const select = o.select
      .map((s) => {
        const so = (s ?? {}) as Record<string, unknown>
        const value = str(so.value)
        return value ? { text: str(so.text) || value, value } : null
      })
      .filter((x): x is { text: string; value: string } => !!x)
    if (select.length) {
      input.select = select
      const def = o.select.find((s) => (s as any)?.default === true) as any
      if (def && input.default === undefined) input.default = String(def.value)
    }
  }
  return input
}

// ---------------------------------------------------------------------------
// Native homeport catalog: { apps: [{ name, description, categories, icon,
// compose, inputs, notes }] }. Compose is authored YAML with {{VAR}} tokens.
// ---------------------------------------------------------------------------

export function parseNativeCatalog(
  data: unknown,
  source: string,
): { apps: CatalogApp[]; skipped: number } {
  const root = (data ?? {}) as Record<string, unknown>
  const list = Array.isArray(root.apps) ? root.apps : []
  const apps: CatalogApp[] = []
  let skipped = 0
  for (const raw of list) {
    const o = (raw ?? {}) as Record<string, unknown>
    const name = str(o.name)
    const compose = typeof o.compose === 'string' ? o.compose : ''
    const slug = slugify(str(o.slug) || name)
    if (!name || !compose.trim() || !slug) {
      skipped++
      continue
    }
    apps.push({
      slug,
      name,
      description: plainDescription(o.description),
      categories: categoryArr(o.categories),
      icon: str(o.icon),
      image: str(o.image),
      source,
      notes: str(o.notes) || undefined,
      inputs: Array.isArray(o.inputs)
        ? o.inputs.map(sanitizeInput).filter((x): x is AppInput => !!x)
        : [],
      compose,
    })
  }
  return { apps, skipped }
}

// ---------------------------------------------------------------------------
// Portainer app templates (v2/v3): { version, templates: [...] }. Only
// type 1 (container) linux templates are supported — they carry the full
// runtime spec inline. Type 2/3 (swarm/compose-from-git) are skipped: they
// reference external repositories we don't clone.
// ---------------------------------------------------------------------------

interface PortainerVolume {
  container?: string
  bind?: string
  readonly?: boolean
}

/** A named volume must be a valid compose volume key. */
function volumeKey(slug: string, containerPath: string, idx: number): string {
  const base = slugify(containerPath.replace(/^\//, '').replace(/\//g, '-'))
  return `${slug}-${base || `vol${idx}`}`.slice(0, 63)
}

export function parsePortainerTemplates(
  data: unknown,
  source: string,
): { apps: CatalogApp[]; skipped: number } {
  const root = (data ?? {}) as Record<string, unknown>
  const list = Array.isArray(root.templates) ? root.templates : Array.isArray(data) ? (data as unknown[]) : []
  const apps: CatalogApp[] = []
  let skipped = 0

  for (const raw of list) {
    const o = (raw ?? {}) as Record<string, unknown>
    const type = Number(o.type ?? 1)
    const platform = str(o.platform) || 'linux'
    const title = str(o.title)
    const image = str(o.image)
    const slug = slugify(title)
    if (type !== 1 || platform !== 'linux' || !title || !image || !slug) {
      skipped++
      continue
    }

    const inputs = Array.isArray(o.env)
      ? o.env.map(sanitizeInput).filter((x): x is AppInput => !!x)
      : []

    // Build the compose service. Values that come from prompts are inserted as
    // {{VAR}} tokens; stringifyYAML quotes them safely, and substituteTokens()
    // fills them at install time.
    const service: Record<string, unknown> = { image }

    const ports = strArr(o.ports)
    if (ports.length) service.ports = ports

    const volumes: string[] = []
    const named: string[] = []
    if (Array.isArray(o.volumes)) {
      o.volumes.forEach((v, i) => {
        const vo = (v ?? {}) as PortainerVolume
        const container = str(vo.container)
        if (!container) return
        const suffix = vo.readonly ? ':ro' : ''
        if (str(vo.bind)) {
          volumes.push(`${str(vo.bind)}:${container}${suffix}`)
        } else {
          const key = volumeKey(slug, container, i)
          named.push(key)
          volumes.push(`${key}:${container}${suffix}`)
        }
      })
    }
    if (volumes.length) service.volumes = volumes

    if (inputs.length) {
      service.environment = Object.fromEntries(inputs.map((e) => [e.name, `{{${e.name}}}`]))
    }

    service.restart = str(o.restart_policy) || 'unless-stopped'
    if (str(o.command)) service.command = str(o.command)
    if (str(o.hostname)) service.hostname = str(o.hostname)
    if (str(o.network)) service.network_mode = str(o.network)
    if (o.privileged === true) service.privileged = true

    // Carry the template's logo into the running service via homeport's label.
    const logo = str(o.logo)
    const labels: Record<string, string> = {}
    if (logo) labels['hub.icon'] = logo
    if (Array.isArray(o.labels)) {
      for (const l of o.labels) {
        const lo = (l ?? {}) as Record<string, unknown>
        if (str(lo.name)) labels[str(lo.name)] = String(lo.value ?? '')
      }
    }
    if (Object.keys(labels).length) service.labels = labels

    const doc: Record<string, unknown> = { services: { [slug]: service } }
    if (named.length) doc.volumes = Object.fromEntries(named.map((k) => [k, null]))

    apps.push({
      slug,
      name: title,
      description: plainDescription(o.description),
      categories: categoryArr(o.categories),
      icon: logo,
      image,
      source,
      notes: str(o.note) || undefined,
      inputs,
      compose: stringifyYAML(doc),
    })
  }
  return { apps, skipped }
}

/** Auto-detect a fetched template document's format and parse it. */
export function parseCatalogDocument(
  data: unknown,
  source: string,
): { apps: CatalogApp[]; skipped: number; format: 'native' | 'portainer' } {
  const root = (data ?? {}) as Record<string, unknown>
  if (Array.isArray(root.apps)) return { ...parseNativeCatalog(data, source), format: 'native' }
  return { ...parsePortainerTemplates(data, source), format: 'portainer' }
}

/** Merge apps from several sources; the FIRST occurrence of a slug wins (built-in first). */
/**
 * Same-app key for an image: repo path without registry host, tag, digest or
 * docker's implicit `library/`. Kept in step with utils/image.ts on the client.
 */
export function imageKey(img: string): string {
  let s = (img || '').trim().toLowerCase()
  const at = s.indexOf('@')
  if (at >= 0) s = s.slice(0, at)
  const colon = s.lastIndexOf(':')
  if (colon > s.lastIndexOf('/')) s = s.slice(0, colon)
  const slash = s.indexOf('/')
  if (slash > 0) {
    const first = s.slice(0, slash)
    if (first.includes('.') || first.includes(':') || first === 'localhost') s = s.slice(slash + 1)
  }
  return s.startsWith('library/') ? s.slice('library/'.length) : s
}

/**
 * Merge sources in priority order (built-in first). An app is dropped when an
 * earlier source already has the same slug OR the same image: community lists
 * overlap heavily, so one app used to appear up to three times
 * ("Adguard", "AdGuard Home", "Adguardhome (container)").
 */
export function mergeApps(lists: CatalogApp[][]): CatalogApp[] {
  const seen = new Set<string>()
  const seenImages = new Set<string>()
  const out: CatalogApp[] = []
  for (const list of lists) {
    for (const app of list) {
      const img = app.image ? imageKey(app.image) : ''
      if (seen.has(app.slug) || (img && seenImages.has(img))) continue
      seen.add(app.slug)
      if (img) seenImages.add(img)
      out.push(app)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Install-time input resolution + compose generation
// ---------------------------------------------------------------------------

export interface ResolvedInputs {
  ok: boolean
  errors: string[]
  values: Record<string, string>
}

/**
 * Apply defaults, enforce required/select constraints, and reject values that
 * could break the YAML they get substituted into (newlines/control chars).
 */
export function resolveInputs(app: CatalogApp, given: Record<string, unknown>): ResolvedInputs {
  const errors: string[] = []
  const values: Record<string, string> = {}
  for (const input of app.inputs) {
    const raw = given[input.name]
    let value = raw === undefined || raw === null ? '' : String(raw)
    if (!value && input.default !== undefined) value = input.default
    if (input.preset) value = input.default ?? ''
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\n\r]/.test(value)) {
      errors.push(`${input.label}: control characters are not allowed`)
      continue
    }
    if (input.select && value && !input.select.some((s) => s.value === value)) {
      errors.push(`${input.label}: must be one of ${input.select.map((s) => s.value).join(', ')}`)
      continue
    }
    if (input.required && !value) {
      errors.push(`${input.label} is required`)
      continue
    }
    values[input.name] = value
  }
  return { ok: errors.length === 0, errors, values }
}

/** Replace {{VAR}} tokens. Unknown tokens are left in place and reported. */
export function substituteTokens(
  compose: string,
  values: Record<string, string>,
): { content: string; unresolved: string[] } {
  const unresolved = new Set<string>()
  const content = compose.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (m, name: string) => {
    if (values[name] !== undefined) return values[name]
    unresolved.add(name)
    return m
  })
  return { content, unresolved: [...unresolved] }
}

/** Full install-time generation: validate inputs, substitute, fail on leftovers. */
export function composeForInstall(
  app: CatalogApp,
  given: Record<string, unknown>,
): { ok: true; content: string } | { ok: false; errors: string[] } {
  const resolved = resolveInputs(app, given)
  if (!resolved.ok) return { ok: false, errors: resolved.errors }
  const { content, unresolved } = substituteTokens(app.compose, resolved.values)
  if (unresolved.length) {
    return { ok: false, errors: unresolved.map((n) => `template variable ${n} has no value`) }
  }
  return { ok: true, content }
}
