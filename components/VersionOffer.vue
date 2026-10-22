<template>
  <!-- compact: one row on the Updates page -->
  <div v-if="entry?.newer && compact" class="flex flex-wrap items-center gap-2 sm:justify-end">
    <span class="whitespace-nowrap font-mono text-xs text-slate-400">
      {{ tag }} <Icon name="arrow-right" class="inline h-3 w-3" /> <span class="text-slate-100">{{ entry.newer.tag }}</span>
    </span>
    <span class="badge" :class="bumpCls(entry.newer.bump)">{{ entry.newer.bump }}</span>
    <template v-if="switchMode">
      <button
        v-if="entry.newerSameMajor"
        :disabled="isBusy"
        class="btn btn-sm"
        :title="`Newest release on your current major version (${entry.newerSameMajor.bump})`"
        @click="go(entry.newerSameMajor.tag, entry.newerSameMajor.bump)"
      >{{ busyTag === entry.newerSameMajor.tag ? 'Switching…' : `Switch to ${entry.newerSameMajor.tag}` }}</button>
      <button :disabled="isBusy" class="btn btn-sm btn-accent" @click="go(entry.newer.tag, entry.newer.bump)">
        {{ busyTag === entry.newer.tag ? 'Switching…' : `Switch to ${entry.newer.tag}` }}
      </button>
    </template>
  </div>

  <!-- full: a card on the container's Update tab -->
  <div v-else-if="entry?.newer" class="card">
    <div class="card-header">
      <span class="card-title">Newer version</span>
      <span class="badge h-6 px-2" :class="bumpCls(entry.newer.bump)">{{ entry.newer.bump }}</span>
    </div>
    <div class="space-y-3 p-4 sm:p-5">
      <p class="text-[13px] leading-relaxed text-slate-300">
        You run <code>{{ tag }}</code>; <code class="text-slate-100">{{ entry.newer.tag }}</code> is out.
        <template v-if="entry.newerSameMajor">
          On your current major version, the newest is <code class="text-slate-100">{{ entry.newerSameMajor.tag }}</code> ({{ entry.newerSameMajor.bump }}), the safer step.
        </template>
      </p>
      <p v-if="entry.newer.bump === 'major'" class="callout callout-warn text-xs">{{ MAJOR_NOTE }}</p>
      <p class="text-xs text-slate-500">
        {{ moveNote }}
        <template v-if="switchMode === 'stack'">Switching writes the new tag into the stack's compose file.</template>
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-3 sm:px-5">
      <template v-if="switchMode">
        <button
          v-if="entry.newerSameMajor"
          :disabled="isBusy"
          class="btn btn-primary"
          @click="go(entry.newerSameMajor.tag, entry.newerSameMajor.bump)"
        >{{ busyTag === entry.newerSameMajor.tag ? 'Switching…' : `Switch to ${entry.newerSameMajor.tag}` }}</button>
        <button
          :disabled="isBusy"
          class="btn"
          :class="entry.newerSameMajor ? '' : 'btn-primary'"
          @click="go(entry.newer.tag, entry.newer.bump)"
        >{{ busyTag === entry.newer.tag ? 'Switching…' : `Switch to ${entry.newer.tag}` }}</button>
      </template>
      <span v-else class="text-xs leading-relaxed text-slate-500">{{ versions.blockedReason(service) }}</span>
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
const tag = computed(() => imageTag(props.service.image))
const switchMode = computed(() => versions.mode(props.service))
const busyTag = computed(() => versions.busy.value[props.service.id] || '')
const isBusy = computed(() => !!busyTag.value)
const changelog = computed(() => updates.changelogUrlFor(props.service))

onMounted(() => versions.ensureReady())

// what the current tag does by itself, so it's clear the newer version needs a switch
const moveNote = computed(() => {
  const line = props.entry?.tagKind === 'line' ? lineOf(tag.value) : undefined
  const next = props.entry?.newer?.tag
  if (line) return `${tag.value} keeps getting ${line.label} releases by itself, but never ${next}: that takes a switch.`
  if (props.entry?.tagKind === 'exact') return `${tag.value} is a fixed release: it can be rebuilt, but it never becomes ${next} until you switch.`
  return `${tag.value} doesn't become ${next} by itself: that takes a switch.`
})

const bumpCls = (b: Bump) => (b === 'major' ? 'badge-warn' : b === 'minor' ? 'badge-info' : '')

async function go(next: string, bump: Bump) {
  emit('switched', await versions.switchTo(props.service, next, bump))
}
</script>
