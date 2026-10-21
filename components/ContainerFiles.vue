<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="$emit('close')">
    <div class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-ink-900" style="box-shadow: var(--shadow-pop)">
      <!-- header -->
      <div class="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
        <Icon name="stacks" class="h-4 w-4 shrink-0 text-sky-300/80" />
        <span class="truncate font-mono text-sm text-slate-200" :title="`${root} in ${name}`">{{ title }}</span>
        <span class="badge shrink-0">in container</span>
        <span v-if="readOnly" class="badge badge-warn shrink-0">read-only</span>
        <button class="ml-auto text-slate-500 hover:text-slate-200" aria-label="Close" @click="$emit('close')"><Icon name="x" class="h-4 w-4" /></button>
      </div>

      <!-- browser -->
      <template v-if="editing === null">
        <div class="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-2">
          <nav class="flex items-center gap-1 font-mono text-xs text-slate-500">
            <button class="hover:text-slate-200" @click="cd('')">{{ rootLabel }}</button>
            <template v-for="(seg, i) in crumbs" :key="i">
              <span class="text-slate-700">/</span>
              <button class="hover:text-slate-200" @click="cd(crumbs.slice(0, i + 1).join('/'))">{{ seg }}</button>
            </template>
          </nav>
          <div class="ml-auto flex items-center gap-1.5">
            <button v-if="!readOnly" class="btn btn-sm" @click="newFile">+ File</button>
            <button class="btn btn-sm" :disabled="loading" @click="load">{{ loading ? '…' : 'Refresh' }}</button>
          </div>
        </div>

        <!-- inline new-file name (no native prompt — blocked in embedded views) -->
        <div v-if="naming" class="flex flex-wrap items-center gap-2 border-b border-white/5 bg-ink-900 px-4 py-2">
          <span class="text-xs font-medium text-slate-400">New file</span>
          <input
            ref="nameInput"
            v-model="newName"
            placeholder="file name (e.g. settings.yml)"
            class="min-w-[12rem] flex-1 input font-mono input-sm"
            @keydown.enter="confirmNewFile"
            @keydown.esc="naming = false"
          />
          <span v-if="path" class="font-mono text-[10px] text-slate-600">in {{ path }}/</span>
          <button class="btn btn-primary btn-sm" :disabled="!newName.trim()" @click="confirmNewFile">Create</button>
          <button class="btn btn-sm btn-ghost" @click="naming = false">Cancel</button>
        </div>

        <p v-if="err" class="whitespace-pre-line px-4 pt-2 text-xs text-red-400">{{ err }}</p>
        <p v-if="truncated" class="px-4 pt-2 text-[11px] text-amber-300/80">This directory is very large — the listing was truncated. Open a file by exact name from a smaller sub-path.</p>

        <div class="min-h-[12rem] flex-1 overflow-auto">
          <div v-if="!loading && !entries.length && !path" class="p-6 text-center text-xs text-slate-600">empty directory</div>
          <div
            v-if="path"
            class="flex cursor-pointer items-center gap-2 border-b border-white/[0.06] px-4 py-2 text-xs text-slate-500 hover:bg-white/[0.03]"
            @click="cd(parentPath)"
          ><Icon name="arrow-left" class="h-3.5 w-3.5" /> ..</div>
          <div
            v-for="e in entries"
            :key="e.name"
            class="group flex items-center gap-3 border-b border-white/[0.06] px-4 py-2 last:border-b-0 hover:bg-white/[0.03]"
          >
            <button class="flex min-w-0 flex-1 items-center gap-2.5 text-left" @click="open(e)">
              <Icon :name="e.type === 'dir' ? 'stacks' : 'file'" class="h-4 w-4 shrink-0" :class="e.type === 'dir' ? 'text-sky-300/80' : 'text-slate-500'" />
              <span class="truncate font-mono text-[13px]" :class="e.type === 'dir' ? 'text-slate-200' : 'text-slate-300'">{{ e.name }}</span>
            </button>
            <span class="shrink-0 font-mono text-[11px] text-slate-600">{{ e.type === 'file' ? formatBytes(e.size) : '' }}</span>
            <a
              v-if="e.type === 'file'"
              :href="downloadHref(e.name)"
              class="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400 opacity-0 transition-opacity hover:bg-white/5 group-hover:opacity-100"
              :download="e.name"
            >download</a>
          </div>
        </div>
        <p class="border-t border-white/5 px-4 py-2 text-[11px] text-slate-600">
          Files are read and written directly inside the container via <code>docker cp</code> — edits land in the volume/mount, no restart needed.
        </p>
      </template>

      <!-- editor -->
      <template v-else>
        <div class="flex items-center gap-2 border-b border-white/5 px-4 py-2">
          <button class="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200" @click="closeEditor"><Icon name="arrow-left" class="h-3.5 w-3.5" /> back</button>
          <span class="truncate font-mono text-sm text-slate-200">{{ editing }}</span>
        </div>
        <div ref="editorEl" class="min-h-[16rem] flex-1 overflow-auto bg-[#0d1117] text-[13px]" />
        <div class="flex items-center gap-3 border-t border-white/5 px-4 py-2.5">
          <button
            v-if="!readOnly"
            :disabled="fileSaving"
            class="btn btn-primary btn-sm"
            @click="saveFile"
          >{{ fileSaving ? 'Saving…' : 'Save' }}</button>
          <span v-else class="text-[11px] text-slate-600">read-only mount — changes can't be saved</span>
          <span v-if="fileMsg" class="whitespace-pre-line text-[11px]" :class="fileOk ? 'text-accent-light' : 'text-red-400'">{{ fileMsg }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ container: string; root: string; name: string; title: string; readOnly?: boolean }>()
defineEmits<{ close: [] }>()

interface Entry {
  name: string
  type: 'file' | 'dir'
  size: number
  mtime: number
}

const path = ref('') // relative to root
const entries = ref<Entry[]>([])
const loading = ref(false)
const truncated = ref(false)
const err = ref('')

const rootLabel = computed(() => props.root.split('/').filter(Boolean).pop() || props.root)
const crumbs = computed(() => (path.value ? path.value.split('/') : []))
const parentPath = computed(() => crumbs.value.slice(0, -1).join('/'))
const rel = (name: string) => (path.value ? `${path.value}/${name}` : name)

const query = (extra: Record<string, string> = {}) => ({ id: props.container, root: props.root, ...extra })

function downloadHref(name: string): string {
  const p = new URLSearchParams({ id: props.container, root: props.root, path: rel(name), download: '1' })
  return `/api/containers/file?${p.toString()}`
}

async function load() {
  loading.value = true
  try {
    const r = await $fetch<{ entries: Entry[]; truncated: boolean }>('/api/containers/files', { query: query({ path: path.value }) })
    entries.value = r.entries
    truncated.value = r.truncated
    err.value = ''
  } catch (e: any) {
    err.value = errMsg(e, 'Could not list files')
  } finally {
    loading.value = false
  }
}

function cd(p: string) {
  path.value = p
  load()
}

function open(e: Entry) {
  if (e.type === 'dir') return cd(rel(e.name))
  openEditor(rel(e.name))
}

// --- editor ---
const editing = ref<string | null>(null)
const editorEl = ref<HTMLElement | null>(null)
const fileSaving = ref(false)
const fileMsg = ref('')
const fileOk = ref(false)
let fileView: any = null

async function setupEditor(content: string, yamlMode: boolean) {
  const [{ EditorView, basicSetup }, { oneDark }, yamlExt] = await Promise.all([
    import('codemirror'),
    import('@codemirror/theme-one-dark'),
    yamlMode ? import('@codemirror/lang-yaml') : Promise.resolve(null),
  ])
  fileView?.destroy()
  fileView = new EditorView({
    doc: content,
    parent: editorEl.value!,
    extensions: [
      basicSetup,
      ...(yamlExt ? [yamlExt.yaml()] : []),
      oneDark,
      EditorView.editable.of(!props.readOnly),
      EditorView.theme({ '&': { backgroundColor: 'transparent' }, '.cm-gutters': { backgroundColor: 'transparent' } }),
    ],
  })
}

async function openEditor(relPath: string, initial = '') {
  fileMsg.value = ''
  editing.value = relPath
  let content = initial
  if (initial === '') {
    try {
      const r = await $fetch<{ content: string }>('/api/containers/file', { query: query({ path: relPath }) })
      content = r.content
    } catch (e: any) {
      const code = e?.statusCode ?? e?.response?.status
      if (code === 404) content = '' // new file
      else {
        editing.value = null
        err.value = errMsg(e, 'Could not open the file')
        return
      }
    }
  }
  await nextTick()
  await setupEditor(content, /\.ya?ml$/i.test(relPath))
}

function closeEditor() {
  fileView?.destroy()
  fileView = null
  editing.value = null
  load()
}

// inline "new file" naming (native prompt() is silently blocked in embedded views)
const naming = ref(false)
const newName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
async function newFile() {
  naming.value = !naming.value
  if (naming.value) {
    await nextTick()
    nameInput.value?.focus()
  }
}
function confirmNewFile() {
  const n = newName.value.trim()
  if (!n) return
  naming.value = false
  newName.value = ''
  openEditor(rel(n), '\n') // blank editor; saving creates it
}

async function saveFile() {
  if (editing.value === null) return
  fileSaving.value = true
  fileMsg.value = ''
  try {
    await $fetch('/api/containers/file', {
      method: 'PUT',
      body: { id: props.container, root: props.root, path: editing.value, content: fileView.state.doc.toString() },
    })
    fileOk.value = true
    fileMsg.value = 'Saved.'
  } catch (e: any) {
    fileOk.value = false
    fileMsg.value = errMsg(e, 'Save failed')
  } finally {
    fileSaving.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => fileView?.destroy())
</script>
