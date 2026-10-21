<template>
  <div v-if="steps.length" class="card card-pad">
    <p class="mb-2.5 text-[13px] font-semibold text-slate-100">{{ title }}</p>
    <ol class="space-y-1.5">
      <li v-for="(s, i) in steps" :key="i" class="flex items-start gap-2.5 text-[13px]">
        <span
          class="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full"
          :class="s.ok ? 'bg-ok/15 text-ok' : 'bg-red-500/15 text-red-400'"
        ><Icon :name="s.ok ? 'check' : 'x'" class="h-2.5 w-2.5" :weight="2.6" /></span>
        <span class="min-w-0">
          <span class="text-slate-200">{{ s.step }}</span>
          <span v-if="s.detail" class="block break-words font-mono text-[11.5px] text-slate-500">{{ s.detail }}</span>
        </span>
      </li>
    </ol>
    <p v-if="redirecting" class="mt-3 flex items-center gap-2 text-[13px] text-accent-light">
      <Icon name="refresh" class="h-3.5 w-3.5 animate-spin" /> Container recreated, opening its new page…
    </p>
    <NuxtLink v-else-if="newPage" :to="newPage" class="btn btn-sm mt-3">Open the {{ noun }} container <Icon name="arrow-right" /></NuxtLink>
  </div>
</template>

<script setup lang="ts">
// The step-by-step result of a recreate / update / environment change.
withDefaults(
  defineProps<{
    steps: { step: string; ok: boolean; detail?: string }[]
    title?: string
    redirecting?: boolean
    newPage?: string
    noun?: string
  }>(),
  { title: 'Steps', redirecting: false, newPage: '', noun: 'updated' },
)
</script>
