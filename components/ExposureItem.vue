<template>
  <article class="px-4 py-3.5 sm:px-5" :aria-label="`${e.name}: ${EXPOSURE_META[e.level].label}`">
    <!-- who -->
    <div v-if="!compact" class="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <ServiceIcon :name="e.name" :icon="icon" :size="26" :remote="remote" />
      <NuxtLink :to="`/services/${encodeURIComponent(e.id)}`" class="truncate text-[13.5px] font-medium text-slate-100 hover:text-accent-light">{{ e.name }}</NuxtLink>
      <span v-if="e.host" class="badge">{{ e.host }}</span>
      <span v-if="e.role === 'proxy'" class="badge badge-accent">reverse proxy</span>
      <span v-if="e.dockerSocket" class="badge" title="Mounts the Docker socket: whoever controls it controls Docker">controls Docker</span>
      <NuxtLink v-if="stack" :to="`/stacks/${encodeURIComponent(stack)}`" class="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-200">
        <Icon name="stacks" class="h-3.5 w-3.5" />compose file
      </NuxtLink>
    </div>

    <!-- how: the two ways in, side by side. Facts only; colour is for findings below. -->
    <dl v-if="!findingsOnly" class="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
      <dt class="pt-1 text-slate-500">Proxy</dt>
      <dd class="flex min-w-0 flex-wrap gap-1.5">
        <template v-if="e.routes.length">
          <a
            v-for="r in e.routes"
            :key="r.url"
            :href="r.url"
            target="_blank"
            rel="noopener noreferrer"
            class="chip max-w-full"
            :title="r.https ? `${r.url} (HTTPS)` : `${r.url} (no HTTPS)`"
          >
            <Icon :name="r.https ? 'lock' : 'globe'" class="h-3 w-3 shrink-0" :class="r.https ? 'text-ok' : 'text-amber-300'" />
            <span class="truncate">{{ r.domain }}</span>
            <span class="text-slate-500" :class="r.access === 'unchecked' && probing ? 'animate-pulse' : ''">· {{ routeAccessText(r, probing) }}</span>
          </a>
        </template>
        <span v-else class="pt-1 text-slate-500">no domain</span>
      </dd>
      <dt class="pt-1 text-slate-500">Direct</dt>
      <dd class="flex min-w-0 flex-wrap gap-1.5">
        <template v-if="e.ports.length">
          <span
            v-for="g in portGroups"
            :key="g.label"
            class="chip cursor-default font-mono hover:bg-white/[0.05]"
            :title="g.ports.map(bindingText).join('\n')"
          >
            {{ g.label }}
            <Icon v-if="g.ports.some((p) => flagged.has(p.hostPort))" name="alert" class="h-3 w-3 text-amber-300" />
            <span class="font-sans" :class="g.ports.some((p) => flagged.has(p.hostPort)) ? 'text-amber-300' : 'text-slate-500'">· {{ scopeText(g.ports[0]) }}</span>
          </span>
        </template>
        <span v-else class="pt-1 text-slate-500">nothing published</span>
      </dd>
    </dl>

    <!-- why it matters, and the fix -->
    <div v-for="(f, i) in e.findings" :key="f.code" class="callout" :class="[TONE[f.level].box, findingsOnly && i === 0 ? '' : 'mt-3']">
      <Icon :name="f.level === 'open' ? 'info' : 'alert'" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-start gap-2">
          <p class="flex-1 font-medium" :class="TONE[f.level].title">{{ f.title }}</p>
          <button v-if="canAccept && accepting !== f.code" type="button" class="btn btn-ghost btn-sm -my-1 h-7" @click="startAccept(f.code)">Accept…</button>
        </div>
        <p class="mt-1 text-[12.5px] leading-relaxed text-slate-400">{{ f.detail }}</p>
        <!-- an open port is often intended: its fix waits behind a toggle instead of shouting -->
        <component :is="f.level === 'open' ? 'details' : 'div'" class="group/fix">
        <summary v-if="f.level === 'open'" class="mt-1.5 inline-flex cursor-pointer list-none items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
          How to make it local only <Icon name="arrow-right" class="h-3 w-3 transition-transform group-open/fix:rotate-90" />
        </summary>
        <p class="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">
          <span class="font-medium text-slate-200">Fix: </span>
          <template v-for="(part, i) in codeParts(f.fix)" :key="i">
            <code v-if="part.code" class="rounded bg-white/[0.07] px-1 py-px font-mono text-[11.5px] text-slate-200">{{ part.text }}</code>
            <template v-else>{{ part.text }}</template>
          </template>
        </p>
        <!-- the compose line before and after, ready to paste -->
        <div v-if="f.snippet" class="mt-2 flex max-w-full items-start gap-2">
          <pre class="min-w-0 overflow-x-auto rounded-md border border-white/[0.06] bg-ink-950/70 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed" :aria-label="`In the compose file, change ${f.snippet.from} to ${f.snippet.to}`"><span class="text-red-300">- {{ f.snippet.from }}</span>
<span class="text-ok">+ {{ f.snippet.to }}</span></pre>
          <CopyButton :text="f.snippet.to" :label="f.snippet.to" class="mt-1" />
        </div>
        </component>
        <!-- accept as intended: a reason is required, so the next look at it makes sense -->
        <form v-if="accepting === f.code" class="mt-2.5 flex flex-wrap items-center gap-2" @submit.prevent="confirmAccept(f.code)">
          <label :for="`accept-${e.key}-${f.code}`" class="sr-only">Why is this fine?</label>
          <input
            :id="`accept-${e.key}-${f.code}`"
            ref="noteInput"
            v-model="note"
            class="input input-sm min-w-0 flex-1 basis-60"
            maxlength="200"
            :placeholder="PLACEHOLDER[f.code] ?? 'Why is this fine?'"
            @keydown.esc.stop.prevent="accepting = null"
          />
          <button type="submit" class="btn btn-sm btn-primary" :disabled="!note.trim() || saving">{{ saving ? 'Saving…' : 'Accept' }}</button>
          <button type="button" class="btn btn-sm btn-ghost" @click="accepting = null">Cancel</button>
          <p class="basis-full text-[11.5px] text-slate-500">It stays listed under “accepted” with your reason, and stops counting. Undo any time.</p>
        </form>
      </div>
    </div>

    <!-- accepted as intended: visible, not counted -->
    <details v-if="e.accepted.length" class="group" :class="findingsOnly && !e.findings.length ? '' : 'mt-3'">
      <summary class="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300">
        <Icon name="check" class="h-3.5 w-3.5 text-ok" />{{ e.accepted.length }} accepted
        <Icon name="arrow-right" class="h-3 w-3 transition-transform group-open:rotate-90" />
      </summary>
      <ul class="mt-2 space-y-1.5">
        <li v-for="a in e.accepted" :key="a.code" class="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
          <span class="text-slate-300">{{ a.title }}</span>
          <span class="text-slate-500">“{{ a.note }}” · {{ ago(a.at) }}</span>
          <button v-if="canAccept" type="button" class="link text-xs" :disabled="saving" @click="undo(a.code)">Undo</button>
        </li>
      </ul>
    </details>
  </article>
</template>

<script setup lang="ts">
import type { ServiceExposure } from '~/shared/utils/exposure'

const props = withDefaults(
  defineProps<{
    e: ServiceExposure
    probing?: boolean
    /** on the service's own page: no name header */
    compact?: boolean
    /** only the findings (the page around it already lists domains and ports) */
    findingsOnly?: boolean
    canAccept?: boolean
    /** the managed compose stack, for a link to its file */
    stack?: string | null
    icon?: string | null
    remote?: boolean
  }>(),
  { probing: false, compact: false, findingsOnly: false, canAccept: false, stack: null, icon: null, remote: true },
)
const emit = defineEmits<{ changed: [] }>()

// -300 shades: the ones the light theme remaps (a -200 title washed out on its pale box)
const TONE = {
  risk: { box: 'callout-danger', title: 'text-red-300' },
  warn: { box: 'callout-warn', title: 'text-amber-300' },
  open: { box: 'callout-info', title: 'text-slate-200' },
} as const

const PLACEHOLDER: Record<string, string> = {
  'around-proxy': 'e.g. LAN clients connect to this port directly',
  'open-port': 'e.g. game server, meant to be public',
  'database-open': 'e.g. only reachable on the LAN, firewall at the router',
  'docker-control': 'e.g. behind Authelia, admins only',
  'proxy-admin-open': 'e.g. this host is only on my LAN',
  'plain-http': 'e.g. internal-only name, never leaves the LAN',
  'http-not-redirected': 'e.g. a client that only speaks HTTP',
}

const portGroups = computed(() => groupPorts(props.e.ports))
// ports a finding is about (not just open): marked, so Traefik's 80/443 stay plain while its 8080 doesn't
const flagged = computed(() => new Set(props.e.findings.filter((f) => f.level !== 'open').flatMap((f) => f.ports ?? [])))

const acks = useExposureAcks()
const toast = useToast()
const accepting = ref<string | null>(null)
const note = ref('')
const saving = ref(false)
const noteInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)

async function startAccept(code: string) {
  accepting.value = code
  note.value = ''
  await nextTick()
  const el = Array.isArray(noteInput.value) ? noteInput.value[0] : noteInput.value
  el?.focus()
}

async function confirmAccept(code: string) {
  if (!note.value.trim()) return
  saving.value = true
  try {
    await acks.set(props.e.key, code, note.value)
    accepting.value = null
    toast.success(`Accepted for ${props.e.name}`)
    emit('changed')
  } catch (err: any) {
    toast.error(errMsg(err, 'Could not save'))
  } finally {
    saving.value = false
  }
}

async function undo(code: string) {
  saving.value = true
  try {
    await acks.set(props.e.key, code, null)
    emit('changed')
  } catch (err: any) {
    toast.error(errMsg(err, 'Could not undo'))
  } finally {
    saving.value = false
  }
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 90) return 'just now'
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}
</script>
