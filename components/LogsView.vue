<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex flex-wrap items-center gap-2 pb-2.5 text-xs">
      <select v-model.number="tail" class="select input-sm w-auto" aria-label="Lines to load" @change="connect">
        <option :value="100">Last 100 lines</option>
        <option :value="200">Last 200 lines</option>
        <option :value="1000">Last 1000 lines</option>
        <option :value="5000">Last 5000 lines</option>
      </select>
      <div class="relative min-w-[160px] flex-1 sm:max-w-xs">
        <Icon name="filter" class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input v-model="filterText" class="input input-sm pl-8" placeholder="Filter lines…" aria-label="Filter log lines" spellcheck="false" />
      </div>
      <button class="btn btn-sm" :class="follow ? 'btn-accent' : ''" :title="follow ? 'Pause auto-scroll' : 'Resume auto-scroll'" @click="toggleFollow">
        {{ follow ? 'Following' : 'Paused' }}
      </button>
      <a
        :href="`/api/logs?id=${encodeURIComponent(id)}&tail=${tail}&follow=0&format=text`"
        class="btn btn-sm"
        download
      ><Icon name="download" /> Download</a>
      <span class="ml-auto flex items-center gap-1.5 text-slate-500">
        <span class="dot h-1.5 w-1.5" :class="statusDot" />{{ statusText }}
      </span>
      <button
        v-if="status === 'closed' || status === 'failed'"
        class="btn btn-sm"
        @click="connect"
      >Reconnect</button>
      <slot name="actions" />
    </div>

    <p v-if="status === 'failed'" class="callout callout-warn mb-2 py-2 text-xs">
      The log stream dropped. If homeport sits behind a reverse proxy, it may be buffering the stream — or the
      logs capability / socket-proxy access was lost. Reconnect to retry.
    </p>

    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#0d1117] px-3 py-2 font-mono text-[11.5px] leading-relaxed">
      <div v-for="(l, i) in shownLines" :key="i" class="flex gap-3 whitespace-pre-wrap break-all rounded px-1 hover:bg-white/[0.03]">
        <span v-if="l.t" class="shrink-0 select-none text-[#6e7681]">{{ shortTime(l.t) }}</span>
        <span :class="l.s === 'stderr' ? 'text-[#f0b72f]' : 'text-[#c9d1d9]'">{{ l.line }}</span>
      </div>
      <p v-if="lines.length && !shownLines.length" class="py-8 text-center text-xs text-[#6e7681]">No lines match “{{ filterText }}”.</p>
      <p v-if="!lines.length && status === 'open'" class="py-8 text-center text-xs text-[#6e7681]">
        connected — no log output yet
      </p>
      <p v-else-if="!lines.length && status === 'connecting'" class="py-8 text-center text-xs text-[#6e7681]">
        connecting to the log stream…
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface LogLine {
  s: 'stdout' | 'stderr'
  t: string
  line: string
}

const props = defineProps<{ id: string }>()

const MAX_LINES = 5000
const lines = ref<LogLine[]>([])
// client-side filter over the loaded lines (case-insensitive substring)
const filterText = ref('')
const shownLines = computed(() => {
  const t = filterText.value.trim().toLowerCase()
  return t ? lines.value.filter((l) => l.line.toLowerCase().includes(t)) : lines.value
})
const tail = ref(200)
const follow = ref(true)
const scroller = ref<HTMLElement | null>(null)
const status = ref<'connecting' | 'open' | 'closed' | 'failed'>('connecting')
let es: EventSource | null = null

const statusText = computed(
  () => ({ connecting: 'connecting…', open: 'live', closed: 'disconnected', failed: 'stream lost' })[status.value],
)
const statusDot = computed(
  () => ({ connecting: 'bg-amber-400 animate-pulse', open: 'bg-ok', closed: 'bg-slate-500', failed: 'bg-red-400' })[status.value],
)

function connect() {
  es?.close()
  lines.value = []
  status.value = 'connecting'
  es = new EventSource(`/api/logs?id=${encodeURIComponent(props.id)}&tail=${tail.value}&follow=1`)
  es.onopen = () => (status.value = 'open')
  es.onmessage = (e) => {
    status.value = 'open'
    try {
      const l = JSON.parse(e.data) as LogLine
      lines.value.push(l)
      if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES)
      if (follow.value) scrollToEnd()
    } catch {
      // ignore non-JSON
    }
  }
  // Without this the stream could break and leave an eternal "waiting…" spinner.
  es.onerror = () => {
    status.value = 'failed'
    es?.close()
  }
}

function toggleFollow() {
  follow.value = !follow.value
  if (follow.value) scrollToEnd()
}

function scrollToEnd() {
  nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  })
}

const shortTime = (t: string) => {
  const m = t.match(/T(\d{2}:\d{2}:\d{2})/)
  return m ? m[1] : t
}

watch(() => props.id, connect)
onMounted(connect)
onBeforeUnmount(() => es?.close())
</script>
