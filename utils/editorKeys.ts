// Escape inside a CodeMirror panel (the search box) is the editor's own: it closes
// that panel. Anywhere else in the dialog it closes the dialog. defaultPrevented
// can't tell the two apart: CodeMirror prevents every Escape that reaches it (it
// arms "Escape then Tab leaves the editor"), so a check on it meant Escape never
// closed a file editor at all.
export function inEditorPanel(e: KeyboardEvent): boolean {
  const t = e.target as Element | null
  return !!t?.closest?.('.cm-panel')
}
