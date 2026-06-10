<template>
  <svg
    :viewBox="`0 0 ${W} ${H}`"
    preserveAspectRatio="none"
    class="block h-full w-full overflow-visible"
    role="img"
  >
    <polyline
      v-if="line"
      :points="line"
      fill="none"
      :stroke="color"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <polygon v-if="area" :points="area" :fill="color" fill-opacity="0.12" stroke="none" />
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{ data: number[]; max?: number; color?: string }>(),
  { color: '#10b981' },
)

const W = 100
const H = 28

const peak = computed(() => props.max ?? Math.max(1, ...props.data))

const coords = computed(() => {
  const d = props.data
  if (d.length < 2) return [] as [number, number][]
  return d.map((v, i) => {
    const x = (i / (d.length - 1)) * W
    const y = H - Math.min(1, Math.max(0, v / peak.value)) * H
    return [x, y] as [number, number]
  })
})

const line = computed(() => coords.value.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '))
const area = computed(() => {
  const c = coords.value
  if (!c.length) return ''
  return `0,${H} ${line.value} ${W},${H}`
})
</script>
