<template>
  <article class="px-4 py-4 sm:px-5" :aria-labelledby="nameId">
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <h3 :id="nameId" class="truncate text-[14.5px] font-medium leading-snug text-slate-100">{{ item.name }}</h3>
        <p v-if="item.domain && item.domain !== item.name" class="truncate text-xs text-slate-500">{{ item.domain }}</p>
      </div>
      <span class="inline-flex shrink-0 items-center gap-1.5 pt-px text-[13px] font-medium" :class="STATE[item.state].text">
        <span class="dot" :class="STATE[item.state].dot" />{{ STATE_TEXT[item.state] }}
      </span>
    </div>

    <div class="mt-3">
      <DayBars
        v-if="days.length"
        :days="days"
        :label="`Daily uptime of ${item.name}`"
        :tone-of="toneOf"
        :day-text="dayText"
        :summary="summary"
      />
      <template v-else>
        <div data-testid="day-bars" class="flex h-8 gap-[2px] sm:gap-[3px]" aria-hidden="true">
          <span v-for="i in 30" :key="i" class="min-w-0 flex-1 rounded-[2px] bg-white/[0.07]" />
        </div>
        <div class="mt-1.5 flex items-center gap-3 text-[11.5px] text-slate-500" aria-hidden="true">
          <span class="shrink-0">30 days ago</span>
          <span class="min-w-0 flex-1 truncate text-center">No data yet</span>
          <span class="shrink-0">Today</span>
        </div>
      </template>
    </div>

    <!-- three columns on a phone (a figure like 87.58% never wraps a third one onto its own line), one row from sm up -->
    <dl class="mt-2.5 grid grid-cols-3 gap-x-3 text-xs sm:flex sm:gap-x-5">
      <div v-for="w in WINDOWS" :key="w.key" class="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-1.5">
        <dt class="text-slate-500">{{ w.label }}</dt>
        <dd class="font-medium tabular-nums text-slate-300">{{ formatUptime(item.uptime[w.key]) }}</dd>
      </div>
    </dl>
  </article>
</template>

<script setup lang="ts">
import { formatUptime } from '~/utils/uptime'
import { STATE_TEXT, statusDayTone, type PublicStatusItem, type StatusState, type UptimeWindow } from '~/shared/utils/status-page'

// One app or domain on the public status page. Everything here is rendered as
// text: names and the notice come from the admin, never as HTML.
const props = defineProps<{ item: PublicStatusItem; /** the offset the days were computed for */ tz: number }>()

const nameId = useId()

const STATE: Record<StatusState, { text: string; dot: string }> = {
  operational: { text: 'text-ok', dot: 'bg-ok' },
  degraded: { text: 'text-amber-300', dot: 'bg-amber-400' },
  down: { text: 'text-red-300', dot: 'bg-red-400' },
  unknown: { text: 'text-slate-400', dot: 'bg-slate-500' },
}
const WINDOWS: { key: UptimeWindow; label: string }[] = [
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
]

const days = computed(() => props.item.days)
// today's bar also carries what is wrong right now (statusDayTone)
const toneOf = (i: number) => statusDayTone(days.value[i]?.ratio, i === days.value.length - 1, props.item.state)

// Day names in a fixed locale and from the offset the server used, not the
// browser's clock: the server-rendered page and the hydrated one must read the same.
const DAY_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
function dayText(i: number): string {
  const d = days.value[i]
  if (!d) return ''
  const label = `${i === days.value.length - 1 ? 'Today, ' : ''}${DAY_FMT.format(new Date(d.from - props.tz * 60_000))}`
  return `${label}: ${d.ratio == null ? 'no data' : `${formatUptime(d.ratio)} up`}`
}

const summary = computed(() => {
  const known = days.value.map((d, i) => ({ d, i })).filter(({ d }) => d.ratio != null)
  if (!known.length) return 'No data yet'
  const full = known.filter(({ i }) => toneOf(i) === 'ok').length
  return `${full} of ${known.length} days fully up`
})
</script>
