<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex justify-end" @click.self="$emit('close')">
      <div class="absolute inset-0 bg-black/60" @click="$emit('close')" />
      <div class="relative flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-ink-950 shadow-2xl">
        <!-- header -->
        <div class="flex items-center gap-3 border-b border-white/5 px-4 py-3">
          <span class="text-sm font-medium text-slate-100">Logs</span>
          <span class="truncate font-mono text-xs text-slate-500">{{ name }}</span>
          <div class="ml-auto flex items-center gap-2 text-xs">
            <select v-model.number="tail" class="rounded border border-white/10 bg-ink-900 px-1.5 py-1 text-slate-300" @change="reconnect">
              <option :value="100">100</option>
              <option :value="200">200</option>
              <option :value="1000">1000</option>
              <option :value="5000">5000</option>
            </select>
            <button
              class="rounded border px-2 py-1"
              :class="follow ? 'border-accent/40 text-accent-light' : 'border-white/10 text-slate-400'"
              @click="toggleFollow"
            >{{ follow ? 'Following' : 'Paused' }}</button>
            <a
              :href="`/api/logs?id=${encodeURIComponent(id)}&tail=${tail}&follow=0&format=text`"
              class="rounded border border-white/10 px-2 py-1 text-slate-400 hover:bg-white/5"
              download
            >Download</a>
            <button class="rounded border border-white/10 px-2 py-1 text-slate-400 hover:bg-white/5" @click="$emit('close')">✕</button>
          </div>
        </div>

        <!-- log lines -->
        <div ref="scroller" class="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed">
          <div v-for="(l, i) in lines" :key="i" class="flex gap-2 whitespace-pre-wrap break-all">
            <span v-if="l.t" class="shrink-0 text-slate-600">{{ shortTime(l.t) }}</span>
            <span :class="l.s === 'stderr' ? 'text-amber-300/90' : 'text-slate-300'">{{ l.line }}</span>
          </div>
          <p v-if="!lines.length" class="py-8 text-center text-xs text-slate-600">waiting for log output…</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
interface LogLine {
  s: 'stdout' | 'stderr'
  t: string
  line: string
}

const props = defineProps<{ id: string; name: string }>()
defineEmits<{ close: [] }>()

const MAX_LINES = 5000
const lines = ref<LogLine[]>([])
const tail = ref(200)
const follow = ref(true)
const scroller = ref<HTMLElement | null>(null)
let es: EventSource | null = null

function connect() {
  es?.close()
  lines.value = []
  es = new EventSource(`/api/logs?id=${encodeURIComponent(props.id)}&tail=${tail.value}&follow=1`)
  es.onmessage = (e) => {
    try {
      const l = JSON.parse(e.data) as LogLine
      lines.value.push(l)
      if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES)
      if (follow.value) scrollToEnd()
    } catch {
      // ignore non-JSON (heartbeats)
    }
  }
}

function reconnect() {
  connect()
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

onMounted(connect)
onBeforeUnmount(() => es?.close())
</script>
