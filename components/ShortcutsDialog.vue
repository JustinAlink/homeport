<template>
  <Teleport to="body">
    <Transition name="sd">
      <div v-if="open" class="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" @mousedown.self="$emit('close')">
        <div ref="panel" class="w-full max-w-lg rounded-2xl border border-white/10 bg-ink-900 p-5 sm:p-6" style="box-shadow: var(--shadow-pop)" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
          <div class="mb-4 flex items-center gap-3">
            <Icon name="command" class="h-4 w-4 text-slate-500" />
            <h2 class="text-[15px] font-semibold text-slate-100">Keyboard shortcuts</h2>
            <button class="btn btn-ghost btn-icon btn-sm ml-auto" aria-label="Close" @click="$emit('close')"><Icon name="x" /></button>
          </div>
          <div class="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <section v-for="g in groups" :key="g.title">
              <p class="eyebrow mb-2">{{ g.title }}</p>
              <ul class="space-y-1.5">
                <li v-for="s in g.items" :key="s.label" class="flex items-center justify-between gap-3 text-[13px] text-slate-300">
                  {{ s.label }}
                  <span class="flex shrink-0 items-center gap-1">
                    <template v-for="(k, i) in s.keys" :key="i">
                      <span v-if="k === 'then'" class="text-[11px] text-slate-500">then</span>
                      <span v-else class="kbd">{{ k }}</span>
                    </template>
                  </span>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{ open: boolean; mod: string }>()
defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => props.open)

const groups = computed(() => [
  {
    title: 'Anywhere',
    items: [
      { label: 'Jump to anything', keys: [props.mod, 'K'] },
      { label: 'This list', keys: ['?'] },
      { label: 'Close a dialog or panel', keys: ['Esc'] },
    ],
  },
  {
    title: 'Go to',
    items: GOTO.map((g) => ({ label: g.label, keys: ['G', 'then', g.key.toUpperCase()] })),
  },
  {
    title: 'Dashboard',
    items: [{ label: 'Filter containers', keys: ['/'] }],
  },
  {
    title: 'Editors',
    items: [{ label: 'Save a compose file', keys: [props.mod, 'S'] }],
  },
])
</script>

<style scoped>
.sd-enter-active,
.sd-leave-active {
  transition: opacity 0.12s ease;
}
.sd-enter-from,
.sd-leave-to {
  opacity: 0;
}
</style>
