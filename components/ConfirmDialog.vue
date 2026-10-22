<template>
  <Teleport to="body">
    <Transition name="cd-fade">
      <div
        v-if="state.open"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
        @click.self="settle(false)"
        @keydown.esc="settle(false)"
      >
        <div ref="panel" class="cd-panel w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-5 sm:p-6" style="box-shadow: var(--shadow-pop)" role="alertdialog" aria-modal="true">
          <div class="flex gap-4">
            <div
              class="grid h-10 w-10 shrink-0 place-items-center rounded-full"
              :class="state.danger ? 'bg-red-500/12 text-red-400' : 'bg-accent/12 text-accent-light'"
            ><Icon :name="state.danger ? 'alert' : 'info'" class="h-5 w-5" /></div>
            <div class="min-w-0 pt-0.5">
              <h2 class="text-[15px] font-semibold text-slate-100">{{ state.title || state.message }}</h2>
              <p v-if="state.title" class="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-slate-400">{{ state.message }}</p>
              <p v-if="state.detail" class="mt-2 text-xs leading-relaxed" :class="state.danger ? 'text-red-300' : 'text-slate-500'">
                {{ state.detail }}
              </p>
            </div>
          </div>
          <div v-if="state.requireText" class="mt-5 sm:pl-14">
            <label class="field-label" for="cd-require">Type <span class="font-mono text-slate-100">{{ state.requireText }}</span> to confirm</label>
            <input id="cd-require" ref="requireInput" v-model="typed" class="input font-mono" autocomplete="off" spellcheck="false" />
          </div>
          <div class="mt-6 flex justify-end gap-2">
            <button
              ref="cancelBtn"
              class="btn"
              @click="settle(false)"
            >{{ state.cancelLabel || 'Cancel' }}</button>
            <button
              class="btn"
              :class="state.danger ? 'btn-danger-solid' : 'btn-primary'"
              :disabled="!canConfirm"
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
const requireInput = ref<HTMLInputElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const typed = ref('')
const canConfirm = computed(() => !state.value.requireText || typed.value.trim() === state.value.requireText)
useFocusTrap(panel, () => state.value.open)

// Focus the safe choice when the dialog opens (or the type-to-confirm field),
// and support Enter-to-confirm.
watch(
  () => state.value.open,
  (open) => {
    if (!open) return
    typed.value = ''
    nextTick(() => (state.value.requireText ? requireInput.value : cancelBtn.value)?.focus())
  },
)

function onKey(e: KeyboardEvent) {
  if (!state.value.open) return
  if (e.key === 'Enter') {
    // Enter on the Cancel button cancels; elsewhere it confirms (when allowed)
    if (document.activeElement === cancelBtn.value) return
    e.preventDefault()
    if (canConfirm.value) settle(true)
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
.cd-fade-enter-active .cd-panel {
  transition: transform 0.14s ease;
}
.cd-fade-enter-from .cd-panel {
  transform: scale(0.97) translateY(4px);
}
</style>
