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
  /** A second way forward next to Confirm (only through choose(), never confirm()). */
  altLabel?: string
}

export type Choice = 'confirm' | 'alt' | 'cancel'

interface ConfirmState extends ConfirmOptions {
  open: boolean
}

// Module-level resolver — confirm() is only ever called from a client interaction,
// so there's no SSR cross-request concern.
let resolver: ((v: Choice) => void) | null = null

export function useConfirmState() {
  return useState<ConfirmState>('hp:confirm', () => ({ open: false, message: '' }))
}

export function useConfirm() {
  const state = useConfirmState()

  function open(o: ConfirmOptions): Promise<Choice> {
    resolver?.('cancel') // resolve any dangling prompt as cancelled
    state.value = { open: true, confirmLabel: 'Confirm', cancelLabel: 'Cancel', danger: false, ...o }
    return new Promise<Choice>((resolve) => {
      resolver = resolve
    })
  }

  /** Yes / no. The alternative button is never shown here, so a caller can't mistake it for "yes". */
  async function confirm(opts: ConfirmOptions | string): Promise<boolean> {
    const o = typeof opts === 'string' ? { message: opts } : { ...opts, altLabel: undefined }
    return (await open(o)) === 'confirm'
  }

  /** Confirm, a named alternative (altLabel), or cancel. */
  function choose(opts: ConfirmOptions): Promise<Choice> {
    return open(opts)
  }

  function settle(value: boolean | 'alt') {
    if (!state.value.open) return
    state.value = { ...state.value, open: false }
    const r = resolver
    resolver = null
    r?.(value === 'alt' ? 'alt' : value ? 'confirm' : 'cancel')
  }

  return { confirm, choose, settle, state }
}
