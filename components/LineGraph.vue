<template>
  <div ref="root" class="rounded-lg border border-white/5 bg-ink-950/40 p-3">
    <div class="mb-2 flex items-center gap-3 text-[10px]">
      <span v-for="s in series" :key="s.label" class="flex items-center gap-1 text-slate-400">
        <span class="h-2 w-2 rounded-full" :style="{ background: s.color }" />{{ s.label }}
      </span>
      <span class="ml-auto text-slate-600">{{ n }} pts · {{ intervalSec }}s</span>
    </div>

    <div class="relative" @mousemove="onMove" @mouseleave="hi = null">
      <svg :width="w" :height="H">
        <template v-if="sharedMax">
          <line v-for="p in [0, 25, 50, 75, 100]" :key="p" x1="0" :x2="w" :y1=" y(sharedMax, p)" :y2="y(sharedMax, p)" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
          <text v-for="p in [0, 50, 100]" :key="'t' + p" x="2" :y="y(sharedMax, p) - 3" fill="rgba(148,163,184,0.5)" font-size="9">{{ p }}%</text>
        </template>
        <polyline v-for="s in series" v-show="n > 1" :key="s.label" :points="lineFor(s)" fill="none" :stroke="s.color" stroke-width="1.5" stroke-linejoin="round" />
        <g v-if="hi != null">
          <line :x1="hx" :x2="hx" y1="0" :y2="H" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
          <circle v-for="s in series" :key="'d' + s.label" :cx="hx" :cy="y(maxOf(s), s.data[hi] ?? 0)" r="3" :fill="s.color" />
        </g>
      </svg>

      <div v-if="hi != null" class="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-[11px] shadow-lg" :style="tip">
        <div class="text-slate-500">{{ ago }}</div>
        <div v-for="s in series" :key="'v' + s.label">
          <span :style="{ color: s.color }">{{ s.label }}</span> {{ fmt(s, hi) }}
        </div>
      </div>

      <p v-if="n < 2" class="absolute inset-0 grid place-items-center text-xs text-slate-600">collecting data…</p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Series {
  label: string
  color: string
  data: number[]
  unit?: string
}
const props = withDefaults(
  defineProps<{ series: Series[]; sharedMax?: number; height?: number; intervalSec?: number }>(),
  { height: 140, intervalSec: 7 },
)

const H = computed(() => props.height)
const root = ref<HTMLElement | null>(null)
const w = ref(600)
let ro: ResizeObserver | null = null
onMounted(() => {
  const measure = () => {
    if (root.value) w.value = Math.max(120, root.value.clientWidth - 24)
  }
  measure()
  ro = new ResizeObserver(measure)
  if (root.value) ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())

const n = computed(() => Math.max(1, ...props.series.map((s) => s.data.length)))
const maxOf = (s: Series) => props.sharedMax ?? Math.max(1, ...s.data)
const y = (max: number, v: number) => H.value - (Math.min(max, Math.max(0, v)) / max) * H.value
const xAt = (i: number) => (n.value < 2 ? 0 : (i / (n.value - 1)) * w.value)
const lineFor = (s: Series) => s.data.map((v, i) => `${xAt(i).toFixed(1)},${y(maxOf(s), v).toFixed(1)}`).join(' ')

const hi = ref<number | null>(null)
const hx = computed(() => (hi.value == null ? 0 : xAt(hi.value)))
function onMove(e: MouseEvent) {
  if (n.value < 2) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  hi.value = Math.min(n.value - 1, Math.max(0, Math.round(((e.clientX - rect.left) / w.value) * (n.value - 1))))
}
const ago = computed(() => (hi.value == null ? '' : `${(n.value - 1 - hi.value) * props.intervalSec}s ago`))
const tip = computed(() => ({ left: `${Math.min(w.value - 80, Math.max(0, hx.value + 8))}px` }))
const fmt = (s: Series, i: number) => `${s.data[i] ?? 0}${s.unit ? (s.unit === '%' ? '%' : ' ' + s.unit) : ''}`
</script>
