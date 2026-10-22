/** "g then <key>" navigation; shared by the key handler, the shortcut sheet and the palette hints. */
export const GOTO: { key: string; label: string; to: string }[] = [
  { key: 'd', label: 'Dashboard', to: '/' },
  { key: 'a', label: 'Activity', to: '/activity' },
  { key: 's', label: 'Stacks', to: '/stacks' },
  { key: 'u', label: 'Updates', to: '/updates' },
  { key: 'c', label: 'App catalog', to: '/catalog' },
  { key: 'o', label: 'Domains', to: '/domains' },
  { key: 'n', label: 'Networks', to: '/networks' },
  { key: 'v', label: 'Storage (volumes)', to: '/storage' },
  { key: 'e', label: 'Settings', to: '/settings' },
]

/** True when a key event should be left alone because the user is typing. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t?.closest?.('input, textarea, select, [contenteditable], .cm-editor, .xterm')
}
