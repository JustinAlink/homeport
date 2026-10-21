<template>
  <div class="flex flex-col items-center px-6 py-14 text-center">
    <div class="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-slate-400">
      <Icon :name="icon" class="h-5 w-5" />
    </div>
    <p class="text-sm font-medium text-slate-200">{{ title }}</p>
    <p v-if="text || $slots.default" class="mt-1 max-w-md text-[13px] leading-relaxed text-slate-500"><slot>{{ text }}</slot></p>
    <div v-if="$slots.actions" class="mt-5 flex flex-wrap justify-center gap-2"><slot name="actions" /></div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ icon?: string; title: string; text?: string }>(), { icon: 'box' })
</script>
