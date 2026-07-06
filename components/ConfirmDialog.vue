<template>
  <Teleport to="body">
    <Transition name="cd-fade">
      <div
        v-if="state.open"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
        @click.self="settle(false)"
        @keydown.esc="settle(false)"
      >
        <div class="w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-5 shadow-xl shadow-black/40">
          <h2 v-if="state.title" class="mb-2 text-sm font-semibold text-slate-100">{{ state.title }}</h2>
          <p class="whitespace-pre-line text-sm leading-relaxed text-slate-300">{{ state.message }}</p>
          <p v-if="state.detail" class="mt-2 text-xs leading-relaxed" :class="state.danger ? 'text-red-300' : 'text-slate-500'">
            {{ state.detail }}
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <button
              ref="cancelBtn"
              class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
              @click="settle(false)"
            >{{ state.cancelLabel || 'Cancel' }}</button>
            <button
              class="rounded-md px-3 py-1.5 text-xs font-semibold"
              :class="state.danger ? 'bg-red-500/90 text-white hover:bg-red-500' : 'bg-accent text-ink-950 hover:bg-accent-light'"
              @click="settle(true)"
            >{{ state.confirmLabel || 'Confirm' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const { state, settle } = useConfirm()
const cancelBtn = ref<HTMLButtonElement | null>(null)

// Focus the safe (cancel) button when the dialog opens, and support Enter-to-confirm.
watch(
  () => state.value.open,
  (open) => {
    if (!open) return
    nextTick(() => cancelBtn.value?.focus())
  },
)

function onKey(e: KeyboardEvent) {
  if (!state.value.open) return
  if (e.key === 'Enter') {
    e.preventDefault()
    settle(true)
  } else if (e.key === 'Escape') {
    settle(false)
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.cd-fade-enter-active,
.cd-fade-leave-active {
  transition: opacity 0.12s ease;
}
.cd-fade-enter-from,
.cd-fade-leave-to {
  opacity: 0;
}
</style>
