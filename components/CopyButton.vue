<template>
  <button
    type="button"
    class="inline-grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
    :title="copied ? 'Copied' : `Copy ${label}`"
    :aria-label="`Copy ${label}`"
    @click.stop.prevent="copy"
  >
    <Icon :name="copied ? 'check' : 'copy'" class="h-3.5 w-3.5" :class="copied ? 'text-ok' : ''" />
  </button>
</template>

<script setup lang="ts">
// One-click copy for ids, image refs, URLs. Falls back to a hidden textarea
// where the async clipboard API is unavailable (plain-HTTP LAN installs).
const props = withDefaults(defineProps<{ text: string; label?: string }>(), { label: 'to clipboard' })
const copied = ref(false)
async function copy() {
  try {
    await navigator.clipboard.writeText(props.text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = props.text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {}
    ta.remove()
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1400)
}
</script>
