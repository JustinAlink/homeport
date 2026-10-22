<template>
  <div>
    <label v-if="label" class="field-label flex items-baseline gap-1.5" :for="id">
      {{ label }}<span v-if="optional" class="text-[11px] font-normal text-slate-500">optional</span>
    </label>
    <slot :id="id" />
    <p v-if="hint || $slots.hint" class="field-hint"><slot name="hint">{{ hint }}</slot></p>
  </div>
</template>

<script setup lang="ts">
// A labelled form field. Placeholders vanish as soon as you type, so they can
// show an example but never be the only thing saying what a field is for.
defineProps<{ label?: string; hint?: string; optional?: boolean }>()
const id = useId()
</script>
