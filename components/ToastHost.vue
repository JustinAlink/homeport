<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-[110] flex flex-col items-center gap-2 p-4 sm:items-end">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg shadow-black/30 backdrop-blur"
          :class="styleFor(t.kind)"
          role="status"
        >
          <Icon :name="iconFor(t.kind)" class="mt-0.5 h-4 w-4 shrink-0" />
          <span class="min-w-0 flex-1 whitespace-pre-line break-words leading-relaxed">{{ t.message }}</span>
          <button class="shrink-0 text-current/60 hover:text-current" aria-label="Dismiss" @click="dismiss(t.id)">
            <Icon name="x" class="h-3.5 w-3.5" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const { toasts, dismiss } = useToast()

const styleFor = (k: string) =>
  ({
    error: 'border-red-500/30 bg-red-500/10 text-red-200',
    success: 'border-ok/30 bg-ok/10 text-ok',
    info: 'border-white/10 bg-ink-900/90 text-slate-200',
  })[k] || 'border-white/10 bg-ink-900/90 text-slate-200'

const iconFor = (k: string) => ({ error: 'alert', success: 'check', info: 'alert' })[k] || 'alert'
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
