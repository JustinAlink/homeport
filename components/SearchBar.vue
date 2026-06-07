<template>
  <input
    :value="modelValue"
    type="search"
    placeholder="Search…"
    class="w-36 rounded-md border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-slate-200 outline-none transition-all focus:w-56 focus:border-accent/40"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<script setup lang="ts">
defineProps<{ modelValue: string }>()
defineEmits<{ 'update:modelValue': [string] }>()
</script>
