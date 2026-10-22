// Warns before unsaved edits are thrown away: in-app navigation gets the
// app's own confirm dialog, closing or reloading the tab gets the browser's
// native "leave site?" prompt (the only thing allowed during unload).
export function useUnsavedGuard(isDirty: () => boolean, message = 'Your changes have not been saved.') {
  const { confirm } = useConfirm()

  onBeforeRouteLeave(async () => {
    if (!isDirty()) return true
    return await confirm({ title: 'Leave without saving?', message, confirmLabel: 'Discard changes', danger: true })
  })

  function onUnload(e: BeforeUnloadEvent) {
    if (!isDirty()) return
    e.preventDefault()
    e.returnValue = ''
  }
  onMounted(() => window.addEventListener('beforeunload', onUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onUnload))
}
