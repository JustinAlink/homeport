<template>
  <section>
    <div class="group/head mb-3 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
      <button
        class="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        :aria-expanded="open"
        :aria-label="open ? `Collapse ${name}` : `Expand ${name}`"
        @click="toggle"
      >
        <Icon name="chevron-down" class="h-3.5 w-3.5 transition-transform" :class="open ? '' : '-rotate-90'" />
      </button>
      <Icon :name="kindIcon" class="h-4 w-4 shrink-0" :class="kind === 'pinned' ? 'text-accent-light' : 'text-slate-500'" />

      <!-- stacks (managed or not) link to their stack page; other groups just toggle -->
      <NuxtLink
        v-if="stackLink"
        :to="stackLink"
        class="inline-flex min-w-0 items-center gap-1 truncate text-[14px] font-semibold text-slate-100 hover:text-accent-light"
        :title="kind === 'stack' ? 'Open this stack: compose file, files, data' : 'Open this stack'"
      >
        {{ name }}
        <Icon name="chevron-right" class="h-3.5 w-3.5 shrink-0 text-slate-500 opacity-0 transition-opacity group-hover/head:opacity-100" />
      </NuxtLink>
      <h2 v-else class="cursor-pointer truncate text-[14px] font-semibold text-slate-100" @click="toggle">{{ name }}</h2>

      <!-- a stack has one state; other groups are just a set of containers, so only a count -->
      <span
        v-if="isStack"
        class="inline-flex items-center gap-1.5 text-xs"
        :class="stateCls"
        :title="countTitle"
      >
        <span class="dot h-1.5 w-1.5" :class="dotCls" />{{ stateLabel }}
        <span class="tabular text-slate-500">{{ running }}/{{ total }}</span>
      </span>
      <span v-else class="text-xs tabular text-slate-500" :title="countTitle">{{ running }}/{{ total }} running</span>
      <span v-if="kind === 'unmanaged'" class="badge" title="homeport can't see this stack's compose file, so it can't run compose on it. Open it to see how to fix that.">not editable</span>
      <span v-else-if="kind === 'custom'" class="badge" title="Grouped by a hub.group label rather than by stack">custom group</span>
      <span v-else-if="kind === 'standalone'" class="badge" title="Started on their own (docker run), not part of a compose stack">no stack</span>

      <div class="h-px min-w-[12px] flex-1 bg-white/[0.06]" />

      <span v-if="totals.any" class="hidden shrink-0 items-center gap-3 font-mono text-[11.5px] text-slate-500 lg:flex">
        <span><span class="text-slate-600">CPU</span> {{ totals.cpu }}%</span>
        <span><span class="text-slate-600">RAM</span> {{ formatBytes(totals.mem) }}</span>
      </span>

      <!-- stack actions: compose up / restart / pull / down on the whole stack -->
      <div v-if="canOperate" class="flex shrink-0 items-center gap-1">
        <span v-if="opBusy" class="mr-1 inline-flex items-center gap-1.5 text-xs text-slate-400">
          <Icon name="refresh" class="h-3.5 w-3.5 animate-spin" /> {{ stackOp.label(stack!.name) }}…
        </span>
        <template v-else>
          <button v-if="running < total" class="btn btn-sm btn-accent" title="docker compose up -d: create and start everything in the compose file" @click="runOp('up')">
            <Icon name="play" /> {{ running === 0 ? 'Start stack' : 'Start all' }}
          </button>
          <button v-if="updateCount && !stack!.git && caps.updates" class="btn btn-sm" :title="`${updateCount} newer image${updateCount > 1 ? 's' : ''}: pull and recreate`" @click="runOp('pull')">
            <Icon name="arrow-up" /> Update ({{ updateCount }})
          </button>
          <button v-if="running > 0" class="btn btn-ghost btn-icon btn-sm" title="Restart the stack" aria-label="Restart the stack" @click="runOp('restart')">
            <Icon name="refresh" />
          </button>
          <button v-if="running > 0" class="btn btn-ghost btn-icon btn-sm hover:!bg-red-500/10 hover:!text-red-300" title="Stop the stack (compose down)" aria-label="Stop the stack" @click="stopStack">
            <Icon name="square" />
          </button>
        </template>
      </div>
    </div>

    <div v-show="open">
      <div
        v-if="view === 'grid'"
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr))"
      >
        <ServiceCard v-for="s in services" :key="s.id" :service="s" />
        <NotRunningCard v-for="m in missing" :key="'m:' + m.name" :name="m.name" :image="m.image" :stack="stack!.name" />
      </div>
      <div v-else class="card row-list overflow-hidden">
        <ServiceCard v-for="s in services" :key="s.id" :service="s" layout="row" />
        <NotRunningCard v-for="m in missing" :key="'m:' + m.name" :name="m.name" :image="m.image" :stack="stack!.name" layout="row" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'
import type { StackInfo, GroupKind } from '~/composables/useStacks'
import type { StackOpName } from '~/composables/useStackOp'

const props = withDefaults(
  defineProps<{
    name: string
    kind?: GroupKind
    services: Service[]
    /** the managed stack behind this group (compose file known), if any */
    stack?: StackInfo | null
    /** compose project name for unmanaged stacks (link target) */
    project?: string | null
    /** declared services with no container, already filtered by the dashboard */
    missing?: { name: string; image?: string }[]
    view?: 'grid' | 'list'
    forceOpen?: boolean
  }>(),
  { kind: 'stack', stack: null, project: null, missing: () => [], view: 'grid', forceOpen: false },
)
const { stats } = useStats()
const { caps } = useCapabilities()
const updates = useUpdates()
const stackOp = useStackOp()
const { confirm } = useConfirm()

const kindIcon = computed(
  () => ({ stack: 'stacks', unmanaged: 'stacks', custom: 'grid', standalone: 'box', host: 'server', pinned: 'pin' })[props.kind],
)
const stackLink = computed(() => {
  if (!caps.value.stacks) return null
  if (props.stack) return `/stacks/${encodeURIComponent(props.stack.name)}`
  if (props.kind === 'unmanaged' && props.project) return `/stacks/${encodeURIComponent(props.project)}`
  return null
})

// A managed stack's counts come from its compose file (server-side), so services
// without a container count as "not running" instead of silently vanishing.
const running = computed(() =>
  props.stack ? props.stack.running : props.services.filter((s) => s.state === 'running' || s.state === 'restarting').length,
)
const total = computed(() => (props.stack ? props.stack.total : props.services.length))
const countTitle = computed(() =>
  props.stack
    ? `${running.value} of the ${total.value} services in ${props.stack.file ?? 'the compose file'} are running`
    : `${running.value} of ${total.value} running`,
)
const stateLabel = computed(() => (running.value === 0 ? 'Stopped' : running.value === total.value ? 'Running' : 'Partly running'))
const stateCls = computed(() => (running.value === 0 ? 'text-slate-400' : running.value === total.value ? 'text-slate-400' : 'text-amber-300'))
const dotCls = computed(() => (running.value === 0 ? 'bg-slate-500' : running.value === total.value ? 'bg-ok' : 'bg-amber-400'))

const isStack = computed(() => props.kind === 'stack' || props.kind === 'unmanaged')
const canOperate = computed(() => props.kind === 'stack' && !!props.stack && caps.value.stacks && caps.value.control)
const opBusy = computed(() => !!props.stack && !!stackOp.busy.value[props.stack.name])
const updateCount = computed(() => props.services.filter((s) => updates.entryFor(s)?.status === 'update').length)

function runOp(op: StackOpName) {
  if (props.stack) stackOp.run(props.stack.name, op)
}
async function stopStack() {
  if (!props.stack) return
  const ok = await confirm({
    title: `Stop stack “${props.stack.name}”?`,
    message: 'Runs docker compose down: its containers are removed (named volumes and their data stay). “Start stack” creates them again.',
    confirmLabel: 'Stop stack',
    danger: true,
  })
  if (ok) stackOp.run(props.stack.name, 'down')
}

const totals = computed(() => {
  let cpu = 0
  let mem = 0
  let any = false
  for (const s of props.services) {
    const st = stats.value[s.id]
    if (!st) continue
    if (st.cpuPercent != null) cpu += st.cpuPercent
    mem += st.memBytes
    any = true
  }
  return { any, cpu: Math.round(cpu * 10) / 10, mem }
})

// Collapse state persisted per group name. A search or status filter forces
// groups open so matches are never hidden inside a collapsed group.
const collapsed = ref(false)
const tick = useState('hp:collapse-tick', () => 0)
const storageKey = computed(() => `hp:collapsed:${props.name}`)
const readStored = () => {
  if (import.meta.client) collapsed.value = localStorage.getItem(storageKey.value) === '1'
}
onMounted(readStored)
watch(tick, readStored)
const open = computed(() => props.forceOpen || !collapsed.value)
function toggle() {
  collapsed.value = open.value
  localStorage.setItem(storageKey.value, collapsed.value ? '1' : '0')
}
</script>
