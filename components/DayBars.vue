<template>
  <div>
    <!-- One bar per day. A slider so the days are not hover-only: Tab reaches it,
         the arrow keys (Home, End, Page Up/Down) step through the days, and screen
         readers read each day from aria-valuetext. Pointer: hover or tap a day. -->
    <div
      data-testid="day-bars"
      role="slider"
      tabindex="0"
      :aria-label="label"
      aria-valuemin="1"
      :aria-valuemax="days.length"
      :aria-valuenow="cursor + 1"
      :aria-valuetext="dayText(cursor)"
      class="flex h-8 cursor-default touch-manipulation items-stretch gap-[2px] rounded-md sm:gap-[3px]"
      @keydown="onKey"
      @focus="focused = true"
      @blur="focused = false"
      @pointerleave="hover = null"
    >
      <span
        v-for="(d, i) in days"
        :key="d.from"
        class="min-w-0 flex-1 rounded-[2px] transition-opacity duration-100"
        :class="[TONE[toneOf(i)], active != null && active !== i ? 'opacity-35' : '']"
        @pointerenter="hover = i"
        @pointerdown="cursor = i"
      />
    </div>
    <div class="mt-1.5 flex items-center gap-3 text-[11.5px] text-slate-500" aria-hidden="true">
      <span class="shrink-0">{{ days.length }} days ago</span>
      <span class="min-w-0 flex-1 truncate text-center" :class="active != null ? 'text-slate-300' : ''">{{ active != null ? dayText(active) : summary }}</span>
      <span class="shrink-0">Today</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UptimeTone } from '~/utils/uptime'

// Daily uptime bars, shared by the status page and a container's uptime card.
// The caller words each day (dayText) and colours it (toneOf); this component
// owns the interaction, so both pages get the same keyboard and screen-reader access.
const props = defineProps<{
  days: { from: number }[]
  /** accessible name, e.g. "Daily uptime of Jellyfin" */
  label: string
  toneOf: (i: number) => UptimeTone
  dayText: (i: number) => string
  /** shown under the bars while no day is picked */
  summary: string
}>()

const TONE: Record<UptimeTone, string> = {
  ok: 'bg-ok/80',
  warn: 'bg-amber-400',
  bad: 'bg-red-400',
  none: 'bg-white/[0.08]',
}

const cursor = ref(Math.max(0, props.days.length - 1))
const hover = ref<number | null>(null)
const focused = ref(false)
// a refresh keeps the same days: only clamp, so the picked day doesn't jump
watch(() => props.days.length, (n) => (cursor.value = Math.min(cursor.value, Math.max(0, n - 1))))

const active = computed(() => hover.value ?? (focused.value ? cursor.value : null))

function onKey(e: KeyboardEvent) {
  const last = props.days.length - 1
  const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -7, PageUp: 7 }
  let next: number | null = null
  if (e.key in step) next = cursor.value + step[e.key]
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = last
  if (next == null) return
  e.preventDefault()
  cursor.value = Math.min(last, Math.max(0, next))
  hover.value = null
}
</script>
