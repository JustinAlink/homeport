<template>
  <section class="mb-6 break-inside-avoid rounded-2xl border border-white/10 bg-ink-900 p-4 shadow-sm">
    <button class="group mb-2 flex w-full items-center gap-3 px-1.5 text-left" @click="toggle">
      <svg
        class="h-3 w-3 shrink-0 text-slate-500 transition-transform"
        :class="collapsed ? '-rotate-90' : ''"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <h2 class="text-[13px] font-semibold uppercase tracking-wider text-slate-400 group-hover:text-slate-200">
        {{ name }}
      </h2>
      <span class="text-xs text-slate-600">{{ running }}/{{ services.length }}</span>
      <div class="h-px flex-1 bg-white/5" />
      <span v-if="totals.any" class="shrink-0 font-mono text-[11px] text-slate-500">
        <span class="text-slate-600">CPU</span> {{ totals.cpu }}%
        <span class="ml-2 text-slate-600">RAM</span> {{ formatBytes(totals.mem) }}
      </span>
    </button>

    <div v-show="!collapsed" class="flex flex-col gap-2.5">
      <ServiceCard v-for="s in services" :key="s.id" :service="s" />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const props = defineProps<{ name: string; services: Service[] }>()
const { stats } = useStats()

const running = computed(() => props.services.filter((s) => s.state === 'running').length)

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

// Collapse state persisted per group name.
const collapsed = ref(false)
const storageKey = computed(() => `hp:collapsed:${props.name}`)
onMounted(() => {
  if (localStorage.getItem(storageKey.value) === '1') collapsed.value = true
})
function toggle() {
  collapsed.value = !collapsed.value
  localStorage.setItem(storageKey.value, collapsed.value ? '1' : '0')
}
</script>
