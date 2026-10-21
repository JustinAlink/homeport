<template>
  <nav class="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist">
    <div class="flex min-w-max items-center gap-1 border-b border-white/[0.08]">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="modelValue === t.key"
        class="relative -mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[13px] font-medium transition-colors"
        :class="modelValue === t.key ? 'border-accent text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'"
        @click="$emit('update:modelValue', t.key)"
      >
        <Icon v-if="t.icon" :name="t.icon" class="h-3.5 w-3.5" />
        {{ t.label }}
        <span v-if="t.dot" class="dot h-1.5 w-1.5 bg-sky-400" aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
// Underlined tab strip that scrolls sideways on narrow screens instead of
// clipping the last tabs.
defineProps<{ tabs: { key: string; label: string; icon?: string; dot?: boolean }[]; modelValue: string }>()
defineEmits<{ 'update:modelValue': [string] }>()
</script>
