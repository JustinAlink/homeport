<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="weight"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="path"
  />
</template>

<script setup lang="ts">
// Single icon registry — simple stroke primitives, sized by the caller's
// h-/w- classes, colored by currentColor. No emoji in UI chrome.
const props = withDefaults(defineProps<{ name: string; weight?: number }>(), { weight: 1.7 })

const ICONS = {
  anchor: '<circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>',
  dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  stacks: '<polygon points="12 2 22 8 12 14 2 8"/><polyline points="2 12.5 12 18.5 22 12.5"/><polyline points="2 17 12 23 22 17"/>',
  catalog: '<rect x="3" y="3" width="18" height="5" rx="1.5"/><rect x="3" y="11" width="8" height="10" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c-3 3.6-3 14.4 0 18"/><path d="M12 3c3 3.6 3 14.4 0 18"/>',
  sliders: '<line x1="6" y1="4" x2="6" y2="20"/><circle cx="6" cy="9" r="2"/><line x1="12" y1="4" x2="12" y2="20"/><circle cx="12" cy="15" r="2"/><line x1="18" y1="4" x2="18" y2="20"/><circle cx="18" cy="7" r="2"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7" y2="7"/><line x1="17" y1="17" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7" y2="17"/><line x1="17" y1="7" x2="19.1" y2="4.9"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><polyline points="21 3 21 9 15 9"/>',
  'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  'chart': '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  alert: '<path d="M10.3 3.8 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  play: '<polygon points="7 4 20 12 7 20"/>',
  square: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'chevron-up': '<polyline points="6 15 12 9 18 15"/>',
  'chevron-left': '<polyline points="14 6 8 12 14 18"/>',
  'chevron-right': '<polyline points="10 6 16 12 10 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.3" y2="16.3"/>',
  'git-branch': '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7"/><path d="M18 10.5c0 4-4 5-8 5"/>',
} as const

const path = computed(() => ICONS[props.name as keyof typeof ICONS] ?? '')
</script>
