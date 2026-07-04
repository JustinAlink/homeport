<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <header class="mb-5 flex flex-wrap items-center gap-3">
      <NuxtLink to="/stacks" class="text-slate-400 hover:text-slate-200" aria-label="Back">←</NuxtLink>
      <h1 class="text-xl font-semibold text-slate-100">{{ name }}</h1>
      <span v-if="file" class="font-mono text-xs text-slate-600">{{ file }}</span>
      <span v-if="isNew" class="rounded-full border border-amber-400/30 px-2 py-0.5 text-[10px] uppercase text-amber-300">new</span>
      <div class="ml-auto flex items-center gap-2">
        <button
          v-if="gitInfo"
          :disabled="opRunning"
          class="rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-40"
          :class="gitInfo.behind ? 'border-accent/40 bg-accent/10 text-accent-light' : 'border-white/10 text-slate-300 hover:bg-white/5'"
          :title="gitInfo.behind ? 'The repository has new commits' : 'Re-pull and redeploy from the repository'"
          @click="runAction('update')"
        >{{ gitInfo.behind ? '⬆ Update available' : '↑ Update from Git' }}</button>
        <button
          v-for="a in actions"
          :key="a.op"
          :disabled="opRunning"
          class="rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-40"
          :class="a.cls"
          @click="runAction(a.op)"
        >{{ a.label }}</button>
      </div>
    </header>

    <!-- git source line -->
    <div v-if="gitInfo" class="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-white/5 bg-ink-900/60 px-3 py-2 text-xs">
      <span class="rounded-full border border-sky-400/30 px-1.5 py-px text-[9px] uppercase tracking-wider text-sky-300">git</span>
      <a :href="gitInfo.repo" target="_blank" rel="noopener" class="font-mono text-slate-300 hover:text-slate-100 hover:underline">{{ gitInfo.repo }}</a>
      <span class="text-slate-600">{{ gitInfo.branch }} @ {{ gitInfo.commit }}</span>
      <span class="truncate text-slate-500" :title="gitInfo.subject">“{{ gitInfo.subject }}”</span>
      <span v-if="gitInfo.behind" class="rounded-full border border-accent/40 px-2 py-0.5 text-[10px] text-accent-light">
        ⬆ {{ gitInfo.remoteCommit }} available
      </span>
      <button
        class="ml-auto rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 disabled:opacity-40"
        :disabled="gitChecking"
        @click="loadGit(true)"
      >{{ gitChecking ? 'Checking…' : '↻ Check' }}</button>
    </div>

    <div v-if="loadError" class="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ loadError }}</div>

    <!-- editor -->
    <div class="rounded-lg border border-white/10 bg-[#0b0f14]">
      <div ref="editorEl" class="max-h-[55vh] min-h-[16rem] overflow-auto text-[13px]" />
      <div class="flex items-center gap-3 border-t border-white/5 px-3 py-2">
        <button
          :disabled="saving || !dirty"
          class="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-40"
          @click="save"
        >{{ saving ? 'Saving…' : 'Save' }}</button>
        <span v-if="dirty" class="text-[11px] text-amber-300/80">unsaved changes</span>
        <span v-if="saveMsg" class="whitespace-pre-line text-[11px]" :class="saveOk ? 'text-accent-light' : 'text-red-400'">{{ saveMsg }}</span>
      </div>
    </div>

    <!-- operation output -->
    <div v-if="opLines.length || opRunning" class="mt-4 rounded-lg border border-white/5 bg-ink-950/60 p-3">
      <div class="mb-1 flex items-center gap-2 text-xs text-slate-500">
        <span class="h-1.5 w-1.5 rounded-full" :class="opRunning ? 'animate-pulse bg-amber-400' : opOk ? 'bg-accent' : 'bg-red-400'" />
        {{ opRunning ? 'running…' : opOk ? 'finished' : 'failed' }}
      </div>
      <pre class="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">{{ opLines.join('\n') }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const name = String(route.params.name)
const isNew = ref(String(route.query.new || '') === '1')

const file = ref('')
const loadError = ref('')
const editorEl = ref<HTMLElement | null>(null)
const dirty = ref(false)
const saving = ref(false)
const saveMsg = ref('')
const saveOk = ref(false)

let view: any = null
let savedContent = ''

const NEW_TEMPLATE = `services:\n  app:\n    image: nginx:alpine\n    restart: unless-stopped\n    ports:\n      - "8080:80"\n`

async function setupEditor(content: string) {
  const [{ EditorView, basicSetup }, { yaml }, { oneDark }] = await Promise.all([
    import('codemirror'),
    import('@codemirror/lang-yaml'),
    import('@codemirror/theme-one-dark'),
  ])
  view?.destroy()
  view = new EditorView({
    doc: content,
    parent: editorEl.value!,
    extensions: [
      basicSetup,
      yaml(),
      oneDark,
      EditorView.updateListener.of((u: any) => {
        if (u.docChanged) dirty.value = view.state.doc.toString() !== savedContent
      }),
      EditorView.theme({ '&': { backgroundColor: 'transparent' }, '.cm-gutters': { backgroundColor: 'transparent' } }),
    ],
  })
}

async function load() {
  if (isNew.value) {
    file.value = 'compose.yaml'
    savedContent = ''
    await setupEditor(NEW_TEMPLATE)
    dirty.value = true
    return
  }
  try {
    const s = await $fetch<{ name: string; file: string; content: string }>(`/api/stacks/${encodeURIComponent(name)}`)
    file.value = s.file
    savedContent = s.content
    await setupEditor(s.content)
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
    loadError.value = errMsg(e, 'Could not load this stack')
  }
}

async function save() {
  saving.value = true
  saveMsg.value = ''
  try {
    const content = view.state.doc.toString()
    await $fetch(`/api/stacks/${encodeURIComponent(name)}${isNew.value ? '?create=1' : ''}`, {
      method: 'PUT',
      body: { content },
    })
    savedContent = content
    dirty.value = false
    isNew.value = false
    saveOk.value = true
    saveMsg.value = 'Saved & validated.'
  } catch (e: any) {
    saveOk.value = false
    saveMsg.value = errMsg(e, 'Save failed')
  } finally {
    saving.value = false
  }
}

// --- actions + op streaming ---
const actions = [
  { op: 'up', label: '▶ Up', cls: 'border-accent/25 text-accent-light hover:bg-accent/10' },
  { op: 'restart', label: '↻ Restart', cls: 'border-white/10 text-slate-300 hover:bg-white/5' },
  { op: 'pull', label: '⬆ Pull & up', cls: 'border-sky-400/25 text-sky-300 hover:bg-sky-400/10' },
  { op: 'down', label: '■ Down', cls: 'border-red-500/20 text-red-300 hover:bg-red-500/10' },
] as const

const opLines = ref<string[]>([])
const opRunning = ref(false)
const opOk = ref<boolean | null>(null)
let es: EventSource | null = null

function attachOp(opId: string, onDone?: () => void) {
  es?.close()
  es = new EventSource(`/api/ops/${opId}`)
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.line !== undefined) opLines.value.push(msg.line)
      if (msg.done) {
        opOk.value = msg.ok
        opRunning.value = false
        es?.close()
        onDone?.()
      }
    } catch {}
  }
  es.onerror = () => {
    opRunning.value = false
    es?.close()
  }
}

async function runAction(op: string) {
  if (op === 'down' && !window.confirm(`Take stack “${name}” down?`)) return
  if (
    op === 'update' &&
    !window.confirm(`Update “${name}” to the latest commit from its repository?\nAny local edits to the stack files are overwritten.`)
  )
    return
  if (op !== 'update' && dirty.value && !window.confirm('You have unsaved changes — run anyway?')) return
  opLines.value = []
  opOk.value = null
  opRunning.value = true
  try {
    const { opId } = await $fetch<{ opId: string }>(`/api/stacks/${encodeURIComponent(name)}/action`, {
      method: 'POST',
      body: { op },
    })
    attachOp(opId, op === 'update' ? () => { load(); loadGit() } : undefined)
  } catch (e: any) {
    opLines.value.push(errMsg(e, 'could not start the operation'))
    opOk.value = false
    opRunning.value = false
  }
}

// --- git-backed stacks ---
interface GitInfo {
  git: boolean
  repo: string
  branch: string
  commit: string
  subject: string
  behind: boolean | null
  remoteCommit?: string
}
const gitInfo = ref<GitInfo | null>(null)
const gitChecking = ref(false)

async function loadGit(force = false) {
  gitChecking.value = force
  try {
    const g = await $fetch<GitInfo>(`/api/stacks/${encodeURIComponent(name)}/git`, {
      query: force ? { check: 1 } : {},
    })
    gitInfo.value = g.git ? g : null
  } catch {
    gitInfo.value = null // non-git stack or stacks disabled — no bar
  } finally {
    gitChecking.value = false
  }
}

onMounted(() => {
  load()
  if (!isNew.value) loadGit()
  // arriving from "Clone & deploy" — attach to the in-flight clone op
  const opId = String(useRoute().query.op || '')
  if (opId) {
    opRunning.value = true
    attachOp(opId, () => { load(); loadGit() })
  }
})
onBeforeUnmount(() => {
  es?.close()
  view?.destroy()
})

useHead({ title: `${name} — stacks — homeport` })
</script>
