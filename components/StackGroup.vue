<template>
  <section>
    <div class="group/head mb-3 flex min-w-0 items-center gap-2.5">
      <button
        class="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        :aria-expanded="open"
        :aria-label="open ? `Collapse ${name}` : `Expand ${name}`"
        @click="toggle"
      >
        <Icon name="chevron-down" class="h-3.5 w-3.5 transition-transform" :class="open ? '' : '-rotate-90'" />
      </button>
      <!-- groups backed by a compose project link to the stack page -->
      <NuxtLink
        v-if="project && caps.stacks"
        :to="`/stacks/${encodeURIComponent(project)}`"
        class="inline-flex min-w-0 items-center gap-1 truncate text-[14px] font-semibold text-slate-100 hover:text-accent-light"
        title="Open this stack"
      >
        {{ name }}
        <Icon name="chevron-right" class="h-3.5 w-3.5 shrink-0 text-slate-500 opacity-0 transition-opacity group-hover/head:opacity-100" />
      </NuxtLink>
      <h2 v-else class="cursor-pointer truncate text-[14px] font-semibold text-slate-100" @click="toggle">{{ name }}</h2>
      <span
        class="badge tabular"
        :class="running > 0 && running < services.length ? 'badge-warn' : ''"
        :title="`${running} of ${services.length} running`"
      >{{ running }}/{{ services.length }}</span>
      <div class="h-px min-w-[12px] flex-1 bg-white/[0.06]" />
      <span v-if="totals.any" class="hidden shrink-0 items-center gap-3 font-mono text-[11.5px] text-slate-500 sm:flex">
        <span><span class="text-slate-600">CPU</span> {{ totals.cpu }}%</span>
        <span><span class="text-slate-600">RAM</span> {{ formatBytes(totals.mem) }}</span>
      </span>
    </div>

    <div v-show="open">
      <div
        v-if="view === 'grid'"
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr))"
      >
        <ServiceCard v-for="s in services" :key="s.id" :service="s" />
      </div>
      <div v-else class="card row-list overflow-hidden">
        <ServiceCard v-for="s in services" :key="s.id" :service="s" layout="row" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const props = withDefaults(
  defineProps<{ name: string; services: Service[]; view?: 'grid' | 'list'; forceOpen?: boolean }>(),
  { view: 'grid', forceOpen: false },
)
const { stats } = useStats()
const { caps } = useCapabilities()

const running = computed(() => props.services.filter((s) => s.state === 'running').length)

// The compose project behind this group, when the whole group agrees on one:
// that's what makes the name a meaningful link to /stacks/<project>.
const project = computed(() => {
  const p = props.services[0]?.project
  return p && props.services.every((s) => s.project === p) ? p : null
})

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
