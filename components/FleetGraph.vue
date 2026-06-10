<template>
  <div ref="root" class="rounded-lg border border-white/5 bg-ink-900 p-4">
    <div class="mb-3 flex items-center gap-4 text-[11px]">
      <span class="flex items-center gap-1.5 text-slate-300"><span class="h-2 w-2 rounded-full" style="background: #10b981" />CPU</span>
      <span class="flex items-center gap-1.5 text-slate-300"><span class="h-2 w-2 rounded-full" style="background: #38bdf8" />RAM</span>
      <span class="ml-auto text-slate-600">last {{ n }} samples · {{ intervalSec }}s each</span>
    </div>

    <div class="relative" @mousemove="onMove" @mouseleave="hoverIdx = null">
      <svg :width="w" :height="H" class="block">
        <line v-for="p in [0, 25, 50, 75, 100]" :key="p" x1="0" :x2="w" :y1="yFor(p)" :y2="yFor(p)" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
        <text v-for="p in [0, 50, 100]" :key="'t' + p" x="2" :y="yFor(p) - 3" fill="rgba(148,163,184,0.5)" font-size="9">{{ p }}%</text>

        <polyline v-if="n > 1" :points="cpuLine" fill="none" stroke="#10b981" stroke-width="1.5" stroke-linejoin="round" />
        <polyline v-if="n > 1" :points="ramLine" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linejoin="round" />

        <g v-if="hoverIdx != null">
          <line :x1="hoverX" :x2="hoverX" y1="0" :y2="H" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
          <circle :cx="hoverX" :cy="yFor(cpu[hoverIdx])" r="3" fill="#10b981" />
          <circle :cx="hoverX" :cy="yFor(mem[hoverIdx])" r="3" fill="#38bdf8" />
        </g>
      </svg>

      <div
        v-if="hoverIdx != null"
        class="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-[11px] shadow-lg"
        :style="tipStyle"
      >
        <div class="text-slate-500">{{ agoLabel }}</div>
        <div><span style="color: #10b981">CPU</span> {{ cpu[hoverIdx] }}%</div>
        <div><span style="color: #38bdf8">RAM</span> {{ mem[hoverIdx] }}%</div>
      </div>

      <p v-if="n < 2" class="absolute inset-0 grid place-items-center text-xs text-slate-600">collecting data…</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ cpu: number[]; mem: number[]; intervalSec?: number }>(), { intervalSec: 7 })

const H = 160
const root = ref<HTMLElement | null>(null)
const w = ref(600)
let ro: ResizeObserver | null = null

onMounted(() => {
  const measure = () => {
    if (root.value) w.value = Math.max(120, root.value.clientWidth - 32) // minus p-4
  }
  measure()
  ro = new ResizeObserver(measure)
  if (root.value) ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())

const n = computed(() => Math.max(props.cpu.length, props.mem.length))
const yFor = (v: number) => H - (Math.min(100, Math.max(0, v)) / 100) * H
const xFor = (i: number) => (n.value < 2 ? 0 : (i / (n.value - 1)) * w.value)
const lineFor = (arr: number[]) => arr.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ')
const cpuLine = computed(() => lineFor(props.cpu))
const ramLine = computed(() => lineFor(props.mem))

const hoverIdx = ref<number | null>(null)
const hoverX = computed(() => (hoverIdx.value == null ? 0 : xFor(hoverIdx.value)))
function onMove(e: MouseEvent) {
  if (n.value < 2) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX - rect.left
  hoverIdx.value = Math.min(n.value - 1, Math.max(0, Math.round((x / w.value) * (n.value - 1))))
}
const agoLabel = computed(() => (hoverIdx.value == null ? '' : `${(n.value - 1 - hoverIdx.value) * props.intervalSec}s ago`))
const tipStyle = computed(() => ({ left: `${Math.min(w.value - 80, Math.max(0, hoverX.value + 8))}px` }))
</script>
