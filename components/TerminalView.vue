<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex items-center gap-2 px-1 pb-2 text-xs">
      <span class="flex items-center gap-1.5 text-slate-500">
        <span class="h-1.5 w-1.5 rounded-full" :class="statusDot" />{{ statusText }}
      </span>
      <button
        v-if="status === 'closed'"
        class="rounded border border-white/10 px-2 py-1 text-slate-300 hover:bg-white/5"
        @click="connect"
      >Reconnect</button>
    </div>
    <div ref="el" class="min-h-0 flex-1 overflow-hidden rounded-md border border-white/5 bg-[#0b0f14] p-2" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ id: string; name: string }>()

const el = ref<HTMLElement | null>(null)
const status = ref<'connecting' | 'open' | 'closed'>('connecting')
const statusText = computed(() => ({ connecting: 'connecting…', open: 'connected', closed: 'disconnected' })[status.value])
const statusDot = computed(() => ({ connecting: 'bg-amber-400', open: 'bg-accent', closed: 'bg-red-400' })[status.value])

let term: any = null
let fit: any = null
let ws: WebSocket | null = null
let ro: ResizeObserver | null = null

async function connect() {
  status.value = 'connecting'
  // lazy-load xterm so it never lands in the main bundle
  const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
  // @ts-expect-error css module
  await import('@xterm/xterm/css/xterm.css')

  term?.dispose()
  term = new Terminal({
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    cursorBlink: true,
    theme: { background: '#0b0f14', foreground: '#cbd5e1', cursor: '#5eead4' },
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  if (el.value) term.open(el.value)
  fit.fit()

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${proto}//${location.host}/api/terminal?id=${encodeURIComponent(props.id)}&name=${encodeURIComponent(props.name)}`)
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    status.value = 'open'
    sendResize()
    term.focus()
  }
  ws.onmessage = (e) => {
    term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data))
  }
  ws.onclose = () => (status.value = 'closed')
  ws.onerror = () => (status.value = 'closed')

  term.onData((data: string) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }))
  })

  ro?.disconnect()
  ro = new ResizeObserver(() => {
    fit?.fit()
    sendResize()
  })
  if (el.value) ro.observe(el.value)
}

function sendResize() {
  if (ws?.readyState === WebSocket.OPEN && term) {
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
  }
}

onMounted(connect)
onBeforeUnmount(() => {
  ro?.disconnect()
  ws?.close()
  term?.dispose()
})
</script>
