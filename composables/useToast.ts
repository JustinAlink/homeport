// Transient toast notifications rendered in the DOM (see components/ToastHost.vue,
// mounted once in app.vue). Replaces window.alert for reporting action failures —
// window.alert is suppressed in sandboxed/embedded views, so a failed stop/delete
// used to surface nowhere at all.

export type ToastKind = 'error' | 'success' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

let counter = 0

export function useToasts() {
  return useState<Toast[]>('hp:toasts', () => [])
}

export function useToast() {
  const toasts = useToasts()

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function push(kind: ToastKind, message: string, ms = kind === 'error' ? 8000 : 4000) {
    const id = ++counter
    toasts.value = [...toasts.value, { id, kind, message }]
    if (import.meta.client) setTimeout(() => dismiss(id), ms)
    return id
  }

  return {
    toasts,
    dismiss,
    error: (message: string) => push('error', message),
    success: (message: string) => push('success', message),
    info: (message: string) => push('info', message),
  }
}
