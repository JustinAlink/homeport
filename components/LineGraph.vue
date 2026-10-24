<template>
  <div ref="root" :class="bare ? 'px-3' : 'rounded-xl border border-white/[0.08] bg-ink-900 p-3'">
    <div v-if="!bare" class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <span v-for="s in series" :key="s.label" class="flex items-center gap-1.5 text-slate-400">
        <span class="h-2 w-2 rounded-full" :style="{ background: s.color }" />{{ s.label }}
      </span>
    </div>

    <div class="relative" @mousemove="onMove" @mouseleave="hi = null">
      <svg :width="w" :height="H">
        <template v-if="scaleMax">
          <line v-for="p in [0, 25, 50, 75, 100]" :key="p" x1="0" :x2="w" :y1="y(scaleMax, (p / 100) * scaleMax)" :y2="y(scaleMax, (p / 100) * scaleMax)" stroke="currentColor" class="text-white/[0.06]" stroke-width="1" :stroke-dasharray="p === 0 ? '' : '2 4'" />
          <text v-for="p in [50, 100]" :key="'t' + p" x="2" :y="y(scaleMax, (p / 100) * scaleMax) + 11" fill="currentColor" class="text-slate-600" font-size="10">{{ Math.round((p / 100) * scaleMax * 10) / 10 }}%</text>
        </template>
        <defs>
          <linearGradient v-for="(s, i) in series" :id="`lg-${uid}-${i}`" :key="'g' + s.label" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" :stop-color="s.color" stop-opacity="0.1" />
            <stop offset="1" :stop-color="s.color" stop-opacity="0" />
          </linearGradient>
        </defs>
        <polygon v-for="(s, i) in series" v-show="n > 1 && i === 0" :key="'a' + s.label" :points="areaFor(s)" :fill="`url(#lg-${uid}-${i})`" />
        <polyline v-for="s in series" v-show="n > 1" :key="s.label" :points="lineFor(s)" fill="none" :stroke="s.color" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
        <g v-if="hi != null">
          <line :x1="hx" :x2="hx" y1="0" :y2="H" stroke="currentColor" class="text-slate-500/40" stroke-width="1" />
          <circle v-for="s in series" :key="'d' + s.label" :cx="hx" :cy="y(maxOf(s), s.data[hi] ?? 0)" r="3.5" :fill="s.color" stroke="currentColor" class="text-ink-900" stroke-width="2" />
        </g>
      </svg>

      <div v-if="hi != null" class="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1.5 text-[11.5px] leading-relaxed shadow-lg" :style="tip">
        <div class="text-slate-500">{{ ago }}</div>
        <div v-for="s in series" :key="'v' + s.label" class="flex items-center gap-2">
          <span class="h-2 w-2 rounded-full" :style="{ background: s.color }" />
          <span class="text-slate-400">{{ s.label }}</span>
          <span class="ml-auto pl-3 font-mono tabular-nums text-slate-100">{{ fmt(s, hi) }}</span>
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
  defineProps<{ series: Series[]; sharedMax?: number; height?: number; intervalSec?: number; bare?: boolean; fit?: boolean }>(),
  { height: 140, intervalSec: 7, bare: false, fit: false },
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
// shared scale: fixed at sharedMax, or with `fit` fitted to the data (round steps,
// never above sharedMax) so a quiet big host doesn't draw flat lines at the bottom
const scaleMax = computed(() =>
  props.sharedMax == null ? null : props.fit ? niceScaleMax(Math.max(0, ...props.series.flatMap((s) => s.data)), props.sharedMax) : props.sharedMax,
)
// per-series scale gets 25% headroom so a steady line sits below the top edge
const maxOf = (s: Series) => scaleMax.value ?? Math.max(1, ...s.data) * 1.25
const y = (max: number, v: number) => H.value - (Math.min(max, Math.max(0, v)) / max) * H.value
const xAt = (i: number) => (n.value < 2 ? 0 : (i / (n.value - 1)) * w.value)
const uid = useId() // stable across SSR + hydration, unique per graph
const areaFor = (s: Series) => (n.value < 2 ? '' : `0,${H.value} ${lineFor(s)} ${xAt(s.data.length - 1).toFixed(1)},${H.value}`)
const lineFor = (s: Series) => s.data.map((v, i) => `${xAt(i).toFixed(1)},${y(maxOf(s), v).toFixed(1)}`).join(' ')

const hi = ref<number | null>(null)
const hx = computed(() => (hi.value == null ? 0 : xAt(hi.value)))
function onMove(e: MouseEvent) {
  if (n.value < 2) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  hi.value = Math.min(n.value - 1, Math.max(0, Math.round(((e.clientX - rect.left) / w.value) * (n.value - 1))))
}
const ago = computed(() => {
  if (hi.value == null) return ''
  const sec = (n.value - 1 - hi.value) * props.intervalSec
  if (sec === 0) return 'now'
  if (sec < 120) return `${sec}s ago`
  if (sec < 7200) return `${Math.round(sec / 60)} min ago`
  return `${Math.round(sec / 360) / 10} h ago`
})
const tip = computed(() => (hx.value > w.value * 0.6 ? { right: `${Math.max(0, w.value - hx.value + 10)}px` } : { left: `${hx.value + 10}px` }))
const fmt = (s: Series, i: number) => `${s.data[i] ?? 0}${s.unit ? (s.unit === '%' ? '%' : ' ' + s.unit) : ''}`
</script>
