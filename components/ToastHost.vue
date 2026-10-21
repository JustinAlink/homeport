<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-[110] flex flex-col items-center gap-2 p-4 sm:items-end">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border border-white/10 bg-ink-900/95 px-3.5 py-3 text-[13px] text-slate-200 backdrop-blur-md"
          style="box-shadow: var(--shadow-pop)"
          role="status"
        >
          <span class="mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full" :class="styleFor(t.kind)">
            <Icon :name="iconFor(t.kind)" class="h-3 w-3" :weight="2.4" />
          </span>
          <span class="min-w-0 flex-1 whitespace-pre-line break-words leading-relaxed">{{ t.message }}</span>
          <button class="shrink-0 text-slate-500 hover:text-slate-200" aria-label="Dismiss" @click="dismiss(t.id)">
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
    error: 'bg-red-500/15 text-red-400',
    success: 'bg-ok/15 text-ok',
    info: 'bg-sky-400/15 text-sky-400',
  })[k] || 'bg-sky-400/15 text-sky-400'

const iconFor = (k: string) => ({ error: 'x', success: 'check', info: 'info' })[k] || 'info'
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
