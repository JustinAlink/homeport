<template>
  <div class="space-y-5">
    <p v-if="disabled" class="callout callout-info text-xs">
      <Icon name="info" /><span>Alerts are off, so nothing is being sent. Silences apply once they are on.</span>
    </p>

    <!-- pause everything: acts at once -->
    <div>
      <p class="field-label">Pause all alerts</p>
      <p class="field-hint mb-2">Checks keep running and pages keep showing the real state; only notifications are held. Anything still down afterwards alerts once.</p>
      <div v-if="paused" class="flex flex-wrap items-center gap-2 text-[13px] text-slate-300">
        <Icon name="bell-off" class="h-4 w-4 text-slate-400" />
        Paused {{ untilText(paused.until) }}<template v-if="paused.note"> ({{ paused.note }})</template>
        <button type="button" class="btn btn-sm" :disabled="busy" @click="pauseAll(null)">Resume now</button>
      </div>
      <div v-else class="flex flex-wrap gap-2">
        <button v-for="p in pausePresets" :key="p.label" type="button" class="btn btn-sm" :disabled="busy" @click="pauseAll(p.until)">{{ p.label }}</button>
      </div>
    </div>

    <!-- snoozed apps: acts at once -->
    <div>
      <p class="field-label">Snoozed apps</p>
      <ul v-if="snoozed.length" class="mt-1.5 divide-y divide-white/[0.06] rounded-lg border border-white/[0.08]">
        <li v-for="s in snoozed" :key="s.key" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
          <span class="font-medium text-slate-200">{{ s.name }}</span>
          <span class="text-slate-500">{{ s.untilRecovered ? 'until it recovers' : untilText(s.until) }}<template v-if="s.note"> · {{ s.note }}</template></span>
          <button type="button" class="btn btn-ghost btn-sm ml-auto" :disabled="busy" @click="resume(s.key, s.name)">Resume</button>
        </li>
      </ul>
      <p v-else class="field-hint mt-1">None. Snooze an app from its own page (the “Snooze alerts” button).</p>
    </div>

    <!-- recurring windows: configuration, saved with the page -->
    <div>
      <p class="field-label">Maintenance windows</p>
      <p class="field-hint mb-2">
        Every week on the chosen days, no alert is sent between the two times (a window may run past midnight).
        Times are the server's: <span class="font-mono text-slate-300">{{ tz }}</span><template v-if="serverClock">, now {{ serverClock }}</template>.
        Saved with the rest of this page.
      </p>
      <div v-for="(w, i) in windows" :key="w.id" class="mb-2 space-y-2 rounded-lg border border-white/[0.08] bg-ink-950/40 p-3">
        <div class="flex flex-wrap items-center gap-1.5" role="group" :aria-label="`Days for window ${i + 1}`">
          <button
            v-for="d in DAYS"
            :key="d.n"
            type="button"
            class="h-7 w-10 rounded-md border text-xs font-medium transition-colors"
            :class="w.days.includes(d.n) ? 'border-accent/50 bg-accent/15 text-accent-light' : 'border-white/[0.1] text-slate-400 hover:text-slate-200'"
            :aria-pressed="w.days.includes(d.n)"
            @click="toggleDay(i, d.n)"
          >{{ d.short }}</button>
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <Field v-slot="{ id }" label="From">
            <input :id="id" :value="w.start" type="time" class="input w-28" @input="set(i, { start: ($event.target as HTMLInputElement).value })" />
          </Field>
          <Field v-slot="{ id }" label="Until">
            <input :id="id" :value="w.end" type="time" class="input w-28" @input="set(i, { end: ($event.target as HTMLInputElement).value })" />
          </Field>
          <Field v-slot="{ id }" label="What happens then" optional class="min-w-40 flex-1">
            <input :id="id" :value="w.note ?? ''" class="input" maxlength="80" placeholder="e.g. nightly backups" @input="set(i, { note: ($event.target as HTMLInputElement).value })" />
          </Field>
          <button type="button" class="btn btn-ghost btn-icon" :aria-label="`Remove window ${i + 1}`" @click="remove(i)"><Icon name="trash" /></button>
        </div>
        <p v-if="problem(w)" class="text-xs text-amber-300" role="alert">{{ problem(w) }}</p>
      </div>
      <button type="button" class="btn btn-sm" @click="add"><Icon name="plus" /> Add window</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MaintenanceWindow } from '~/shared/utils/silence'

const props = defineProps<{ modelValue: MaintenanceWindow[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [MaintenanceWindow[]] }>()

const DAYS = [
  { n: 1, short: 'Mon' },
  { n: 2, short: 'Tue' },
  { n: 3, short: 'Wed' },
  { n: 4, short: 'Thu' },
  { n: 5, short: 'Fri' },
  { n: 6, short: 'Sat' },
  { n: 0, short: 'Sun' },
]

const silences = useSilences()
const toast = useToast()
const busy = ref(false)
onMounted(() => silences.refresh())

const windows = computed(() => props.modelValue ?? [])
const tz = computed(() => silences.data.value?.timeZone ?? 'UTC')
const serverClock = computed(() => {
  const d = silences.data.value
  if (!d) return ''
  return new Date(d.serverTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: d.timeZone })
})
const paused = computed(() => silences.globalSilence.value?.kind === 'pause' ? (silences.globalSilence.value as { until: number; note: string | null }) : null)
const snoozed = computed(() =>
  Object.entries(silences.data.value?.snoozes ?? {})
    .filter(([, s]) => s.until > Date.now())
    .map(([key, s]) => ({ key, name: key.split('|').slice(1).join('|'), ...s }))
    .sort((a, b) => a.until - b.until),
)
const pausePresets = computed(() => {
  const now = Date.now()
  const [, , tomorrow] = snoozePresets(now)
  return [
    { label: '1 hour', until: now + 3600_000 },
    { label: '4 hours', until: now + 4 * 3600_000 },
    { label: 'Until tomorrow 09:00', until: tomorrow.until },
  ]
})

async function pauseAll(until: number | null) {
  busy.value = true
  try {
    await silences.pause(until)
    toast.success(until ? `All alerts paused ${untilText(until)}` : 'Alerts are back on')
  } catch (e: any) {
    toast.error(errMsg(e, 'Could not change the pause'))
  } finally {
    busy.value = false
  }
}
async function resume(key: string, name: string) {
  busy.value = true
  try {
    await silences.snooze(key, null)
    toast.success(`Alerts for ${name} are back on`)
  } catch (e: any) {
    toast.error(errMsg(e, 'Could not resume'))
  } finally {
    busy.value = false
  }
}

const update = (next: MaintenanceWindow[]) => emit('update:modelValue', next)
function set(i: number, patch: Partial<MaintenanceWindow>) {
  update(windows.value.map((w, j) => (j === i ? { ...w, ...patch } : w)))
}
function toggleDay(i: number, d: number) {
  const w = windows.value[i]
  set(i, { days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d].sort() })
}
function add() {
  update([...windows.value, { id: Math.random().toString(36).slice(2, 10), days: [1, 2, 3, 4, 5, 6, 0], start: '02:00', end: '04:00' }])
}
function remove(i: number) {
  update(windows.value.filter((_, j) => j !== i))
}
function problem(w: MaintenanceWindow): string {
  if (!w.days.length) return 'Pick at least one day.'
  if (!w.start || !w.end) return 'Set both times.'
  if (w.start === w.end) return 'The two times are the same: the window would be empty.'
  return ''
}
</script>
