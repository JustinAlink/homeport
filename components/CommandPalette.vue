<template>
  <Teleport to="body">
    <Transition name="cp">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 px-3 pt-[12vh] backdrop-blur-[2px]"
        @mousedown.self="close"
      >
        <div
          ref="panel"
          class="w-full max-w-xl overflow-hidden rounded-xl border border-white/10 bg-ink-900"
          style="box-shadow: var(--shadow-pop)"
          role="dialog"
          aria-label="Jump to"
        >
          <div class="flex items-center gap-2.5 border-b border-white/[0.08] px-4">
            <Icon name="search" class="h-4 w-4 shrink-0 text-slate-500" />
            <input
              ref="input"
              v-model="q"
              class="h-12 w-full bg-transparent text-[15px] text-slate-100 outline-none placeholder:text-slate-500"
              placeholder="Search containers, stacks, pages, actions…"
              spellcheck="false"
              autocomplete="off"
              @keydown.down.prevent="move(1)"
              @keydown.up.prevent="move(-1)"
              @keydown.enter.prevent="choose(results[active])"
              @keydown.esc.prevent="close"
            />
            <span class="kbd shrink-0">Esc</span>
          </div>

          <div ref="list" class="max-h-[min(60vh,440px)] overflow-y-auto p-1.5">
            <template v-for="(group, gi) in grouped" :key="group.label">
              <p class="px-2.5 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500" :class="gi === 0 ? 'pt-1.5' : ''">
                {{ group.label }}
              </p>
              <button
                v-for="item in group.items"
                :key="item.key"
                :data-idx="item.idx"
                class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors"
                :class="item.idx === active ? 'bg-white/[0.07]' : ''"
                @mousemove="active = item.idx"
                @click="choose(item)"
              >
                <ServiceIcon v-if="item.service" :name="item.service.displayName" :icon="item.service.icon" :size="24" :remote="remoteIcons" />
                <span v-else class="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/[0.05] text-slate-400">
                  <Icon :name="item.icon || 'arrow-right'" class="h-3.5 w-3.5" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13.5px] text-slate-100">{{ item.label }}</span>
                  <span v-if="item.hint" class="block truncate text-[11.5px] text-slate-500">{{ item.hint }}</span>
                </span>
                <span v-if="item.state" class="dot" :class="stateDot(item.state)" />
                <span v-if="item.keys" class="flex shrink-0 gap-0.5"><span v-for="k in item.keys" :key="k" class="kbd">{{ k }}</span></span>
                <Icon v-if="item.idx === active" name="arrow-right" class="h-3.5 w-3.5 shrink-0 text-slate-500" />
              </button>
            </template>
            <p v-if="!results.length" class="px-3 py-8 text-center text-[13px] text-slate-500">Nothing matches “{{ q }}”.</p>
          </div>

          <div class="flex items-center gap-4 border-t border-white/[0.06] px-4 py-2 text-[11px] text-slate-500">
            <span class="flex items-center gap-1"><span class="kbd">↑</span><span class="kbd">↓</span> move</span>
            <span class="flex items-center gap-1"><span class="kbd">↵</span> open</span>
            <span class="ml-auto hidden sm:inline">try “restart”, “logs” or “update” after a name · <span class="kbd">?</span> for all shortcuts</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

// Ctrl/Cmd+K jump-to: every container, stack and page by name. Reads the shared
// services state (loading it once if this page hasn't), so it costs nothing
// until opened.
interface Item {
  key: string
  label: string
  hint?: string
  icon?: string
  group: string
  to?: string
  run?: () => void
  service?: Service
  state?: string
  keywords?: string
  keys?: string[]
  /** actions rank just below the thing they act on */
  weight?: number
}

const { isOpen, open, close } = usePalette()
const { data, refresh } = useServices()
const { caps } = useCapabilities()
const theme = useTheme()
const updates = useUpdates()
const pins = usePins()
const { confirm } = useConfirm()
const toast = useToast()
const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, isOpen)
const gotoKeys = (to: string) => {
  const g = GOTO.find((x) => x.to === to)
  return g ? ['G', g.key.toUpperCase()] : undefined
}
const q = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const remoteIcons = computed(() => data.value?.remoteIcons ?? true)

const pages = computed<Item[]>(() => {
  const c = caps.value
  const p: Item[] = [
    { key: 'p:/', label: 'Dashboard', icon: 'dashboard', to: '/', group: 'Pages', keywords: 'fleet home overview' },
    { key: 'p:/activity', label: 'Activity', icon: 'pulse', to: '/activity', group: 'Pages', keywords: 'events alerts history' },
    { key: 'p:/catalog', label: 'App catalog', icon: 'catalog', to: '/catalog', group: 'Pages', keywords: 'install apps templates' },
  ]
  if (c.stacks) p.push({ key: 'p:/stacks', label: 'Stacks', icon: 'stacks', to: '/stacks', group: 'Pages', keywords: 'compose projects' })
  if (c.updateCheck || c.updates) p.push({ key: 'p:/updates', label: 'Updates', icon: 'arrow-up', to: '/updates', group: 'Pages', keywords: 'images pull' })
  if (c.proxyAdmin) p.push({ key: 'p:/domains', label: 'Domains', icon: 'globe', to: '/domains', group: 'Pages', keywords: 'proxy routes ssl' })
  if (c.stacks) {
    p.push({ key: 'p:/networks', label: 'Networks', icon: 'network', to: '/networks', group: 'Pages' })
    p.push({ key: 'p:/storage', label: 'Storage', icon: 'database', to: '/storage', group: 'Pages', keywords: 'volumes images prune disk' })
  }
  if (!c.viewer) p.push({ key: 'p:/settings', label: 'Settings', icon: 'sliders', to: '/settings', group: 'Pages', keywords: 'config preferences' })
  return p.map((i) => ({ ...i, keys: gotoKeys(i.to!) }))
})

const actions = computed<Item[]>(() => [
  ...(caps.value.stacks ? [{ key: 'a:new-stack', label: 'New stack', icon: 'plus', to: '/stacks?new=1', group: 'Actions', keywords: 'create compose' }] : []),
  ...(caps.value.proxyAdmin && !caps.value.viewer ? [{ key: 'a:add-domain', label: 'Add a domain', icon: 'globe', to: '/domains?add=1', group: 'Actions', keywords: 'proxy route' }] : []),
  ...(caps.value.updateCheck || caps.value.updates
    ? [{ key: 'a:check', label: 'Check for image updates now', icon: 'refresh', group: 'Actions', keywords: 'updates registry pull', run: checkUpdates }]
    : []),
  { key: 'a:shortcuts', label: 'Keyboard shortcuts', icon: 'command', group: 'Actions', keywords: 'keys help hotkeys', keys: ['?'], run: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })) },
  {
    key: 'a:theme',
    label: theme.isDark.value ? 'Switch to light theme' : 'Switch to dark theme',
    icon: theme.isDark.value ? 'sun' : 'moon',
    group: 'Actions',
    keywords: 'theme dark light appearance',
    run: () => theme.set(theme.isDark.value ? 'light' : 'dark'),
  },
])

const services = computed<Item[]>(() =>
  (data.value?.services ?? [])
    .filter((s) => !s.hidden && s.kind === 'container')
    .map((s) => ({
      key: 's:' + s.id,
      label: s.displayName,
      hint: [s.host, s.group, s.domains[0]?.domain ?? s.image].filter(Boolean).join(' · '),
      group: 'Containers',
      to: `/services/${encodeURIComponent(s.id)}`,
      service: s,
      state: s.state === 'running' && s.health === 'unhealthy' ? 'unhealthy' : s.state,
      keywords: [s.name, s.image, ...s.domains.map((d) => d.domain)].join(' '),
    })),
)

// Verbs for a container, offered when it matches the query ("jelly restart" works too).
function containerActions(s: Service): Item[] {
  const page = `/services/${encodeURIComponent(s.id)}`
  const up = s.state === 'running' || s.state === 'restarting'
  const base = { group: 'Actions', service: s, weight: 0.9 }
  const out: Item[] = []
  if (caps.value.control) {
    if (up) {
      out.push({ ...base, key: `x:restart:${s.id}`, label: `Restart ${s.displayName}`, keywords: 'restart reboot', run: () => control(s, 'restart') })
      out.push({ ...base, key: `x:stop:${s.id}`, label: `Stop ${s.displayName}`, keywords: 'stop halt', run: () => control(s, 'stop') })
    } else {
      out.push({ ...base, key: `x:start:${s.id}`, label: `Start ${s.displayName}`, keywords: 'start run', run: () => control(s, 'start') })
    }
  }
  if (caps.value.logs) out.push({ ...base, key: `x:logs:${s.id}`, label: `Logs: ${s.displayName}`, keywords: 'logs output', to: `${page}?tab=logs` })
  if (caps.value.terminal && up) out.push({ ...base, key: `x:term:${s.id}`, label: `Terminal: ${s.displayName}`, keywords: 'terminal shell exec console', to: `${page}?tab=terminal` })
  if (updates.entryFor(s)?.status === 'update') out.push({ ...base, key: `x:upd:${s.id}`, label: `Update ${s.displayName}`, keywords: 'update upgrade pull', to: `${page}?tab=update` })
  const pinned = pins.isPinned(s.name)
  out.push({ ...base, key: `x:pin:${s.id}`, label: `${pinned ? 'Unpin' : 'Pin'} ${s.displayName} ${pinned ? 'from' : 'to'} the top`, keywords: 'pin favorite star', run: () => pins.toggle(s.name) })
  return out
}

async function control(s: Service, action: 'start' | 'stop' | 'restart') {
  if (action === 'stop' && !(await confirm({ message: `Stop “${s.displayName}”?`, confirmLabel: 'Stop', danger: true }))) return
  try {
    await $fetch('/api/control', { method: 'POST', body: { id: s.id, action } })
    toast.success(`${s.displayName}: ${action === 'stop' ? 'stopped' : action === 'start' ? 'started' : 'restarted'}`)
    refresh()
  } catch (e: any) {
    toast.error(errMsg(e, `Could not ${action} ${s.displayName}`))
  }
}

async function checkUpdates() {
  toast.info('Checking every image against its registry…')
  try {
    await $fetch('/api/updates/check', { method: 'POST' })
    await updates.refresh()
    const n = Object.values(updates.entries.value).filter((e) => e.status === 'update').length
    toast.success(n ? `${n} image${n > 1 ? 's have' : ' has'} an update` : 'Everything is up to date')
  } catch (e: any) {
    toast.error(errMsg(e, 'Update check failed'))
  }
}

const stacks = computed<Item[]>(() => {
  if (!caps.value.stacks) return []
  const names = new Set<string>()
  for (const s of data.value?.services ?? []) if (s.project) names.add(s.project)
  return [...names].sort().map((n) => ({
    key: 'k:' + n,
    label: n,
    hint: 'stack',
    icon: 'stacks',
    group: 'Stacks',
    to: `/stacks/${encodeURIComponent(n)}`,
  }))
})

function scoreOne(item: Item, term: string): number {
  const label = item.label.toLowerCase()
  if (label === term) return 100
  if (label.startsWith(term)) return 80
  if (label.split(/[\s\-_.:]/).some((w) => w.startsWith(term))) return 60
  if (label.includes(term)) return 40
  const rest = `${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase()
  return rest.includes(term) ? 20 : 0
}
// every word of the query has to match somewhere ("jelly logs" → Logs: jellyfin)
function score(item: Item, term: string): number {
  const words = term.split(/\s+/).filter(Boolean)
  let total = 0
  for (const w of words) {
    const s = scoreOne(item, w)
    if (!s) return 0
    total += s
  }
  return (total / words.length) * (item.weight ?? 1)
}

const results = computed<(Item & { idx: number })[]>(() => {
  const term = q.value.trim().toLowerCase()
  let all: Item[]
  if (!term) {
    // empty query: pages and actions first, then a taste of the fleet
    all = [...pages.value, ...actions.value, ...services.value.slice(0, 6)]
  } else {
    // verbs for the containers the query is about
    const verbs = services.value
      .map((i) => ({ i, s: Math.max(...term.split(/\s+/).map((w) => scoreOne({ ...i, hint: '', keywords: '' }, w))) }))
      .filter((x) => x.s >= 40)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .flatMap((x) => containerActions(x.i.service!))
    all = [...services.value, ...stacks.value, ...pages.value, ...actions.value, ...verbs]
      .map((i) => ({ i, s: score(i, term) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.i)
  }
  // keep groups contiguous in display order while preserving rank within a group
  const order: string[] = []
  for (const i of all) if (!order.includes(i.group)) order.push(i.group)
  return order.flatMap((g) => all.filter((i) => i.group === g)).map((i, idx) => ({ ...i, idx }))
})

const grouped = computed(() => {
  const out: { label: string; items: (Item & { idx: number })[] }[] = []
  for (const r of results.value) {
    const last = out[out.length - 1]
    if (last && last.label === r.group) last.items.push(r)
    else out.push({ label: r.group, items: [r] })
  }
  return out
})

watch(q, () => (active.value = 0))

function move(d: number) {
  const n = results.value.length
  if (!n) return
  active.value = (active.value + d + n) % n
  nextTick(() => list.value?.querySelector(`[data-idx="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
}

function choose(item?: Item) {
  if (!item) return
  close()
  if (item.run) item.run()
  else if (item.to) navigateTo(item.to)
}

function stateDot(state: string) {
  if (state === 'running') return 'bg-ok'
  if (state === 'unhealthy' || state === 'dead') return 'bg-red-400'
  if (state === 'restarting') return 'bg-amber-400'
  return 'bg-slate-500'
}

watch(isOpen, (v) => {
  if (!v) return
  q.value = ''
  active.value = 0
  if (!data.value) refresh()
  nextTick(() => input.value?.focus())
})

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    isOpen.value ? close() : open()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.cp-enter-active,
.cp-leave-active {
  transition: opacity 0.14s ease;
}
.cp-enter-active > div,
.cp-leave-active > div {
  transition: transform 0.14s ease;
}
.cp-enter-from,
.cp-leave-to {
  opacity: 0;
}
.cp-enter-from > div {
  transform: translateY(-6px) scale(0.99);
}
</style>
