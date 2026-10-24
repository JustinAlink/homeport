<template>
  <!-- compact: one row on the Updates page -->
  <div v-if="has && compact" class="flex flex-wrap items-center gap-2 sm:justify-end">
    <template v-if="entry?.newer">
      <span class="whitespace-nowrap font-mono text-xs text-slate-400">
        {{ tag }} <Icon name="arrow-right" class="inline h-3 w-3" /> <span class="text-slate-100">{{ entry.newer.tag }}</span>
      </span>
      <span class="badge" :class="bumpCls(entry.newer.bump)">{{ entry.newer.bump }}</span>
      <span v-if="rebuiltFirst" class="badge badge-ok" title="Your version was also rebuilt since you pinned it: the safe step">rebuilt</span>
    </template>
    <template v-else-if="entry?.rebuilt">
      <span class="whitespace-nowrap font-mono text-xs text-slate-400">{{ tag }}</span>
      <span class="badge badge-ok" title="The tag now points at a newer build than your pin: same version, usually security fixes">rebuilt</span>
    </template>
    <template v-if="switchMode">
      <button
        v-for="o in offers"
        :key="o.tag + (o.digest || '')"
        :disabled="isBusy"
        class="btn btn-sm"
        :class="o.primary ? 'btn-accent' : ''"
        :title="o.title"
        @click="go(o)"
      >{{ busyTag === o.tag ? 'Switching…' : o.label }}</button>
    </template>
    <a
      v-else-if="versions.ownerUrl(service)"
      :href="versions.ownerUrl(service)!"
      target="_blank"
      rel="noopener noreferrer"
      class="link text-[11.5px]"
      :title="versions.blockedReason(service)"
    >{{ versions.blockedShort(service) }} <Icon name="external" class="inline h-3 w-3" /></a>
    <span v-else class="text-[11.5px] text-slate-500" :title="versions.blockedReason(service)">{{ versions.blockedShort(service) }}</span>
    <button v-if="pinOffer" type="button" class="btn btn-sm btn-ghost" :title="`Copy ${pinOffer}`" @click="copyPin(pinOffer)">
      <Icon :name="copied ? 'check' : 'copy'" /> {{ copied ? 'Copied' : 'Copy pin' }}
    </button>
  </div>

  <!-- full: a card on the container's Update tab -->
  <div v-else-if="has" class="card">
    <div class="card-header">
      <span class="card-title">{{ entry?.newer ? 'Newer version' : 'Rebuilt image' }}</span>
      <span v-if="entry?.newer" class="badge h-6 px-2" :class="bumpCls(entry.newer.bump)">{{ entry.newer.bump }}</span>
    </div>
    <div class="space-y-3 p-4 sm:p-5">
      <p v-if="entry?.newer" class="text-[13px] leading-relaxed text-slate-300">
        You run <code>{{ tag }}</code>; <code class="text-slate-100">{{ entry.newer.tag }}</code> is out.
        <template v-if="entry.newerSameMajor">
          On your current major version, the newest is <code class="text-slate-100">{{ entry.newerSameMajor.tag }}</code> ({{ entry.newerSameMajor.bump }}), the safer step.
        </template>
      </p>
      <p v-if="entry?.rebuilt" class="text-[13px] leading-relaxed text-slate-300">
        <code>{{ tag }}</code> was rebuilt since you pinned it: same version, a newer build (usually security fixes in the
        base image). A digest pin never picks that up by itself.
      </p>
      <p v-if="entry?.newer?.bump === 'major'" class="callout callout-warn text-xs">{{ MAJOR_NOTE }}</p>
      <p class="text-xs text-slate-500">
        {{ moveNote }}
        <template v-if="switchMode === 'stack'">Switching writes the new {{ isDigestPin ? 'pin' : 'tag' }} into the stack's compose file.</template>
      </p>
      <div v-if="pins.length" class="space-y-1.5">
        <div v-for="p in pins" :key="p" class="flex min-w-0 items-center gap-2">
          <code class="min-w-0 flex-1 truncate rounded-md bg-ink-950/60 px-2 py-1 text-[11.5px] text-slate-300" :title="p">{{ p }}</code>
          <button type="button" class="btn btn-sm btn-ghost shrink-0" @click="copyPin(p)"><Icon :name="copiedPin === p ? 'check' : 'copy'" /> {{ copiedPin === p ? 'Copied' : 'Copy pin' }}</button>
        </div>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-3 sm:px-5">
      <template v-if="switchMode">
        <button
          v-for="o in offers"
          :key="o.tag + (o.digest || '')"
          :disabled="isBusy"
          class="btn"
          :class="o.primary ? 'btn-primary' : ''"
          @click="go(o)"
        >{{ busyTag === o.tag ? 'Switching…' : o.label }}</button>
      </template>
      <span v-else class="text-xs leading-relaxed text-slate-500">
        {{ versions.blockedReason(service) }}
        <a v-if="versions.ownerUrl(service)" :href="versions.ownerUrl(service)!" target="_blank" rel="noopener noreferrer" class="link">Open it <Icon name="external" class="inline h-3 w-3" /></a>
      </span>
      <a v-if="changelog" :href="changelog" target="_blank" rel="noopener noreferrer" class="btn btn-ghost">Changelog <Icon name="external" /></a>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'
import type { UpdateEntry } from '~/composables/useUpdates'
import type { Bump } from '~/utils/updateText'

const props = defineProps<{ service: Service; entry?: UpdateEntry; compact?: boolean }>()
const emit = defineEmits<{ switched: [{ ok: boolean; newId?: string }] }>()

const versions = useVersionSwitch()
const updates = useUpdates()
const toast = useToast()
const tag = computed(() => imageTag(props.service.image))
const isDigestPin = computed(() => props.service.image.includes('@'))
const has = computed(() => !!(props.entry?.newer || props.entry?.rebuilt))
const switchMode = computed(() => versions.mode(props.service))
const busyTag = computed(() => versions.busy.value[props.service.id] || '')
const isBusy = computed(() => !!busyTag.value)
const changelog = computed(() => updates.changelogUrlFor(props.service))

onMounted(() => versions.ensureReady())

interface Offer { tag: string; bump: Bump; digest?: string; label: string; title?: string; primary: boolean }
// what can be switched to: the safe same-major step first, then the newest; a
// digest pin only when its digest is known (otherwise the pin would be lost)
const offers = computed<Offer[]>(() => {
  const e = props.entry
  if (!e) return []
  const ok = (d?: string) => !isDigestPin.value || !!d
  const out: Offer[] = []
  if (rebuiltFirst.value) out.push({ tag: tag.value, bump: 'patch', digest: e.rebuilt!.digest, label: 'Use the rebuilt image', title: 'Same version, newer build', primary: true })
  if (e.newerSameMajor && ok(e.newerSameMajor.digest)) {
    out.push({ ...e.newerSameMajor, label: `Switch to ${e.newerSameMajor.tag}`, title: `Newest release on your current major version (${e.newerSameMajor.bump})`, primary: !out.length })
  }
  if (e.newer && ok(e.newer.digest)) out.push({ ...e.newer, label: `Switch to ${e.newer.tag}`, primary: !out.length })
  return out
})

// A rebuild of the version you run is the safest step: offered first when there's
// nothing newer, or only a major jump (a newer minor/patch already includes it)
const rebuiltFirst = computed(() => !!props.entry?.rebuilt && (!props.entry.newer || props.entry.newer.bump === 'major'))

// what to paste where the version actually lives (a playbook, a repo): exact pins
const pins = computed(() => {
  const e = props.entry
  if (!e) return [] as string[]
  const list: string[] = []
  if (rebuiltFirst.value) list.push(pinFor(props.service.image, tag.value, e.rebuilt!.digest))
  if (e.newerSameMajor) list.push(pinFor(props.service.image, e.newerSameMajor.tag, e.newerSameMajor.digest))
  if (e.newer) list.push(pinFor(props.service.image, e.newer.tag, e.newer.digest))
  return isDigestPin.value ? list.filter((p) => p.includes('@')) : list
})
const pinOffer = computed(() => pins.value[0] ?? '')

// what the current tag does by itself, so it's clear the newer version needs a switch
const moveNote = computed(() => {
  if (isDigestPin.value) return `${tag.value} is pinned by digest: nothing changes, not even a rebuild, until the pin does.`
  const line = props.entry?.tagKind === 'line' ? lineOf(tag.value) : undefined
  const next = props.entry?.newer?.tag
  if (line) return `${tag.value} keeps getting ${line.label} releases by itself, but never ${next}: that takes a switch.`
  if (props.entry?.tagKind === 'exact') return `${tag.value} is a fixed release: it can be rebuilt, but it never becomes ${next} until you switch.`
  return `${tag.value} doesn't become ${next} by itself: that takes a switch.`
})

const copied = ref(false)
const copiedPin = ref('')
async function copyPin(p: string) {
  try {
    await navigator.clipboard.writeText(p)
    copied.value = true
    copiedPin.value = p
    setTimeout(() => {
      copied.value = false
      copiedPin.value = ''
    }, 1500)
  } catch {
    toast.error('Could not copy; select the text instead')
  }
}

const bumpCls = (b: Bump) => (b === 'major' ? 'badge-warn' : b === 'minor' ? 'badge-info' : '')

async function go(o: Offer) {
  emit('switched', await versions.switchTo(props.service, o.tag, o.bump, o.digest))
}
</script>
