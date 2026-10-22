// A promise-based confirmation dialog rendered in the DOM (see
// components/ConfirmDialog.vue, mounted once in app.vue). Replaces window.confirm,
// which is silently blocked in sandboxed/embedded views — there a native confirm
// returns false and the action just never runs, so the button looks dead.

export interface ConfirmOptions {
  title?: string
  message: string
  /** Extra emphasis line (e.g. "This cannot be undone."). */
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red styling for destructive actions. */
  danger?: boolean
  /** Type-to-confirm: the confirm button stays disabled until this exact text is typed. */
  requireText?: string
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
}

// Module-level resolver — confirm() is only ever called from a client interaction,
// so there's no SSR cross-request concern.
let resolver: ((v: boolean) => void) | null = null

export function useConfirmState() {
  return useState<ConfirmState>('hp:confirm', () => ({ open: false, message: '' }))
}

export function useConfirm() {
  const state = useConfirmState()

  function confirm(opts: ConfirmOptions | string): Promise<boolean> {
    const o = typeof opts === 'string' ? { message: opts } : opts
    resolver?.(false) // resolve any dangling prompt as cancelled
    state.value = { open: true, confirmLabel: 'Confirm', cancelLabel: 'Cancel', danger: false, ...o }
    return new Promise<boolean>((resolve) => {
      resolver = resolve
    })
  }

  function settle(value: boolean) {
    if (!state.value.open) return
    state.value = { ...state.value, open: false }
    const r = resolver
    resolver = null
    r?.(value)
  }

  return { confirm, settle, state }
}
