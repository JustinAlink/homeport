<template>
  <div ref="root" class="relative">
    <!-- snoozed: say until when, and offer to resume -->
    <div v-if="current" class="btn-group">
      <span class="btn pointer-events-none !text-slate-300" :title="current.note || undefined">
        <Icon name="bell-off" />{{ current.untilRecovered ? 'Snoozed until it recovers' : `Snoozed ${untilText(current.until)}` }}
      </span>
      <button v-if="canEdit" type="button" class="btn" :disabled="busy" @click="resume">Resume</button>
    </div>
    <button
      v-else-if="canEdit"
      ref="trigger"
      type="button"
      class="btn"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="menuId"
      @click="toggle"
    ><Icon name="bell-off" /> Snooze alerts</button>

    <div
      v-if="open"
      :id="menuId"
      ref="menu"
      role="menu"
      :aria-label="`Snooze alerts for ${name}`"
      class="card absolute right-0 z-40 mt-1.5 w-60 overflow-hidden py-1"
      style="box-shadow: var(--shadow-pop)"
      @keydown="onMenuKey"
    >
      <p class="px-3 pb-1.5 pt-1 text-[11px] text-slate-500">Silence down, unhealthy and certificate alerts for {{ name }}, and its domains.</p>
      <button
        v-for="p in presets"
        :key="p.label"
        type="button"
        role="menuitem"
        class="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] text-slate-200 hover:bg-white/[0.05] focus:bg-white/[0.06] focus:outline-none"
        @click="pick(p.until)"
      >{{ p.label }}<span v-if="!p.label.includes(':')" class="text-[11px] text-slate-500">{{ shortTime(p.until) }}</span></button>
      <button
        type="button"
        role="menuitem"
        class="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-200 hover:bg-white/[0.05] focus:bg-white/[0.06] focus:outline-none"
        title="Ends by itself once the app has been in trouble and is fine again, its domains included (at the latest in a week)"
        @click="pick(Date.now() + 7 * 86_400_000, true)"
      >Until it recovers</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Snooze one app's alerts from its own page. Checks keep running and the page keeps
// showing the real state; only notifications are held (see shared/utils/silence.ts).
const props = defineProps<{ appKey: string; name: string; canEdit: boolean }>()
const silences = useSilences()
const toast = useToast()
const open = ref(false)
const busy = ref(false)
const root = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menuId = `snooze-${Math.random().toString(36).slice(2, 8)}`

const current = computed(() => {
  const sn = silences.data.value?.snoozes[props.appKey]
  return sn && sn.until > Date.now() ? sn : null
})
const presets = computed(() => snoozePresets())
const shortTime = (t: number) => untilText(t).replace(/^until /, '')

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    menu.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }
}
function close(refocus = true) {
  open.value = false
  if (refocus) trigger.value?.focus()
}
function onMenuKey(e: KeyboardEvent) {
  const items = [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  const i = items.indexOf(document.activeElement as HTMLButtonElement)
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    items[(i + 1) % items.length]?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    items[(i - 1 + items.length) % items.length]?.focus()
  } else if (e.key === 'Tab') close(false)
}
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close(false)
}
onMounted(() => document.addEventListener('click', onDocClick, true))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true))

async function pick(until: number, untilRecovered = false) {
  busy.value = true
  try {
    await $fetch('/api/alerts/snooze', { method: 'POST', body: { key: props.appKey, until, untilRecovered } })
    await silences.refresh()
    close()
    toast.success(untilRecovered ? `Alerts for ${props.name} snoozed until it recovers` : `Alerts for ${props.name} snoozed ${untilText(until)}`)
  } catch (err: any) {
    toast.error(errMsg(err, 'Could not snooze'))
  } finally {
    busy.value = false
  }
}
async function resume() {
  busy.value = true
  try {
    await silences.snooze(props.appKey, null)
    toast.success(`Alerts for ${props.name} are back on`)
  } catch (err: any) {
    toast.error(errMsg(err, 'Could not resume'))
  } finally {
    busy.value = false
  }
}
</script>
