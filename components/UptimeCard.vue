<template>
  <div v-if="data?.enabled" class="card" data-testid="uptime-card">
    <div class="card-header">
      <span class="card-title">Uptime</span>
      <span v-if="sinceText" class="ml-auto text-xs text-slate-500" :title="`homeport has watched this container since ${sinceText}, so the longer figures cover less than their full range`">data since {{ sinceText }}</span>
    </div>
    <div class="px-4 py-3 sm:px-5">
      <p v-if="!hasData" class="text-xs leading-relaxed text-slate-500">
        No uptime recorded yet. homeport counts it from the next background collector run on.
      </p>
      <template v-else>
        <dl class="grid grid-cols-3 gap-3">
          <div v-for="w in windows" :key="w.key" class="min-w-0">
            <dt class="text-xs text-slate-500">{{ w.label }}</dt>
            <dd class="mt-0.5 text-[15px] font-medium tabular-nums text-slate-100">{{ formatUptime(w.u.ratio) }}</dd>
            <dd class="text-[11.5px] leading-snug text-slate-500">{{ downText(w.u) }}</dd>
          </div>
        </dl>

        <!-- one bar per calendar day, like a status page: hover, tap, or Tab and the arrow keys -->
        <DayBars
          v-if="days.length"
          class="mt-4"
          :days="days"
          label="Daily uptime, last 30 days"
          :tone-of="(i) => uptimeTone(days[i]?.ratio ?? null)"
          :day-text="dayText"
          :summary="stripLabel"
        />
      </template>
      <p class="mt-2 text-[11.5px] leading-relaxed text-slate-500">
        Up means running and not failing its health check. Time homeport was not running counts neither way.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatUptime, formatDuration, uptimeTone } from '~/utils/uptime'

interface Uptime {
  ratio: number | null
  n: number
  up: number
  since: number | null
  downMs: number
}
interface Day extends Uptime {
  from: number
  to: number
}

const props = defineProps<{ id: string }>()

const data = ref<{ enabled: boolean; windows?: Record<'24h' | '7d' | '30d', Uptime>; days?: Day[] } | null>(null)

async function load() {
  try {
    data.value = await $fetch('/api/uptime', { params: { id: props.id, days: 30, tz: new Date().getTimezoneOffset() } })
  } catch {
    data.value = null // unknown id or a server without the endpoint: no card
  }
}
onMounted(load)
defineExpose({ load })

const windows = computed(() => {
  const w = data.value?.windows
  if (!w) return []
  return [
    { key: '24h', label: '24 hours', u: w['24h'] },
    { key: '7d', label: '7 days', u: w['7d'] },
    { key: '30d', label: '30 days', u: w['30d'] },
  ]
})
const days = computed(() => data.value?.days ?? [])
const hasData = computed(() => windows.value.some((w) => w.u.n > 0))

const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
// the data is younger than the 30 days the longest figure stands for
const sinceText = computed(() => {
  const s = data.value?.windows?.['30d']?.since
  return s && Date.now() - s < 29 * 86_400_000 ? dateOf(s) : ''
})

function downText(u: Uptime): string {
  if (!u.n) return 'no data'
  // an estimate from samples, so rough units ("40 min", "3 h 5 min"); the day readout says "about"
  return u.downMs > 0 ? `${formatDuration(u.downMs)} down` : 'no downtime'
}

const stripLabel = computed(() => {
  const ds = days.value
  const full = ds.filter((d) => uptimeTone(d.ratio) === 'ok').length
  const some = ds.filter((d) => d.ratio != null && uptimeTone(d.ratio) !== 'ok').length
  const none = ds.filter((d) => d.ratio == null).length
  return `Last ${ds.length} days: ${full} fully up, ${some} with downtime${none ? `, ${none} without data` : ''}`
})

function dayText(i: number): string {
  const d = days.value[i]
  if (!d) return ''
  const day = new Date(d.from).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const label = `${i === days.value.length - 1 ? 'Today, ' : ''}${day}`
  if (d.ratio == null) return `${label}: no data`
  return `${label}: ${formatUptime(d.ratio)} up${d.downMs > 0 ? `, about ${formatDuration(d.downMs)} down` : ''}`
}
</script>
