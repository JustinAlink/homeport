<template>
  <section ref="rootEl">
    <div class="mb-2.5 flex flex-wrap items-center gap-2">
      <h2 class="section-title">Files</h2>
      <!-- breadcrumb -->
      <nav class="flex items-center gap-1 font-mono text-xs text-slate-500">
        <button class="hover:text-slate-200" @click="cd('')">{{ stack }}</button>
        <template v-for="(seg, i) in crumbs" :key="i">
          <span class="text-slate-700">/</span>
          <button class="hover:text-slate-200" @click="cd(crumbs.slice(0, i + 1).join('/'))">{{ seg }}</button>
        </template>
      </nav>
      <div class="ml-auto flex items-center gap-1.5">
        <template v-if="!readOnly">
          <button
            class="btn btn-sm"
            :class="naming?.mode === 'file' ? 'btn-accent' : ''"
            @click="openNaming('file')"
          ><Icon name="plus" /> File</button>
          <button
            class="btn btn-sm"
            :class="naming?.mode === 'folder' ? 'btn-accent' : ''"
            @click="openNaming('folder')"
          ><Icon name="plus" /> Folder</button>
          <button class="btn btn-sm" @click="uploadInput?.click()"><Icon name="arrow-up" /> Upload</button>
          <input ref="uploadInput" type="file" multiple class="hidden" @change="upload" />
        </template>
        <button class="btn btn-sm btn-icon" :disabled="loading" title="Refresh" aria-label="Refresh" @click="load">
          <Icon name="refresh" :class="loading ? 'animate-spin' : ''" />
        </button>
      </div>
    </div>

    <!-- inline naming row: new file / new folder / rename (no native prompt()
         — it is silently blocked in sandboxed/embedded views) -->
    <div v-if="naming" class="card mb-2 flex flex-wrap items-center gap-2 px-3 py-2">
      <span class="text-xs font-medium text-slate-400">
        {{ naming.mode === 'file' ? 'New file' : naming.mode === 'folder' ? 'New folder' : `Rename ${naming.target!.name}` }}
      </span>
      <input
        ref="nameInput"
        v-model="naming.value"
        :placeholder="naming.mode === 'folder' ? 'folder name' : 'file name (e.g. .env)'"
        class="min-w-[12rem] flex-1 input font-mono input-sm"
        @keydown.enter="confirmNaming"
        @keydown.esc="naming = null"
      />
      <span v-if="path" class="font-mono text-[10px] text-slate-600">in {{ path }}/</span>
      <button
        class="btn btn-primary btn-sm"
        :disabled="!naming.value.trim()"
        @click="confirmNaming"
      >{{ naming.mode === 'rename' ? 'Rename' : 'Create' }}</button>
      <button class="btn btn-sm btn-ghost" @click="naming = null">Cancel</button>
    </div>

    <p v-if="err" class="mb-2 whitespace-pre-line text-xs text-red-400">{{ err }}</p>

    <div class="card overflow-hidden">
      <div v-if="!entries.length && !path" class="p-6 text-center text-xs text-slate-600">empty directory</div>
      <div
        v-if="path"
        class="flex cursor-pointer items-center gap-2 border-b border-white/[0.06] px-4 py-2 text-xs text-slate-500 hover:bg-white/[0.03]"
        @click="cd(parentPath)"
      >
        <Icon name="arrow-left" class="h-3.5 w-3.5" /> ..
      </div>
      <div
        v-for="e in entries"
        :key="e.name"
        class="group flex items-center gap-3 border-b border-white/[0.06] px-4 py-2 last:border-b-0 hover:bg-white/[0.03]"
      >
        <button class="flex min-w-0 flex-1 items-center gap-2.5 text-left" @click="open(e)">
          <Icon :name="e.type === 'dir' ? 'stacks' : 'file'" class="h-4 w-4 shrink-0" :class="e.type === 'dir' ? 'text-sky-300/80' : 'text-slate-500'" />
          <span class="truncate font-mono text-[13px]" :class="e.type === 'dir' ? 'text-slate-200' : 'text-slate-300'">{{ e.name }}</span>
          <span v-if="rel(e.name) === composeFile" class="badge badge-accent shrink-0">compose</span>
        </button>
        <span class="shrink-0 font-mono text-[11px] text-slate-600">{{ e.type === 'file' ? formatBytes(e.size) : '' }}</span>
        <span class="hidden shrink-0 text-[11px] text-slate-600 sm:block">{{ ago(e.mtime) }}</span>
        <div
          class="flex shrink-0 items-center gap-1 transition-opacity"
          :class="pendingDelete === e.name ? '' : 'opacity-0 group-hover:opacity-100'"
        >
          <template v-if="pendingDelete === e.name">
            <span class="text-[10px] text-red-300">delete {{ e.type === 'dir' ? 'folder + contents' : 'file' }}?</span>
            <button class="btn btn-danger-solid btn-sm h-6 px-2 text-[11px]" @click="deleteEntry(e)">yes</button>
            <button class="btn btn-ghost btn-sm h-6 px-2 text-[11px]" @click="pendingDelete = ''">no</button>
          </template>
          <template v-else>
            <a
              v-if="e.type === 'file'"
              :href="`/api/stacks/${encodeURIComponent(stack)}/file?path=${encodeURIComponent(rel(e.name))}&download=1`"
              class="btn btn-ghost btn-sm h-6 px-2 text-[11px]"
              :download="e.name"
            >download</a>
            <template v-if="!readOnly">
              <button class="btn btn-ghost btn-sm h-6 px-2 text-[11px]" @click="openNaming('rename', e)">rename</button>
              <button class="btn btn-danger btn-sm h-6 px-2 text-[11px]" @click="pendingDelete = e.name">delete</button>
            </template>
          </template>
        </div>
      </div>
    </div>
    <p class="mt-2 text-xs text-slate-500">
      Everything lives in the stack's own directory: <code>.env</code> and config files land next to the compose file,
      exactly where compose expects them. Overwritten files keep a <code>.bak</code>.
    </p>

    <!-- editor modal -->
    <div v-if="editing !== null" class="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" @click.self="closeEditor">
      <div
        ref="modalEl"
        class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-ink-900"
        style="box-shadow: var(--shadow-pop)"
        role="dialog"
        aria-modal="true"
        :aria-label="`Edit ${editing}`"
        @keydown="onModalKey"
      >
        <div class="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
          <span class="font-mono text-sm text-slate-200">{{ editing }}</span>
          <span v-if="editing === composeFile" class="badge badge-accent" title="Validated with docker compose config on save">compose</span>
          <span v-if="fileDirty" class="badge badge-warn">unsaved</span>
          <button class="btn btn-ghost btn-icon btn-sm ml-auto" aria-label="Close" @click="closeEditor"><Icon name="x" /></button>
        </div>
        <div ref="editorEl" class="min-h-[16rem] flex-1 overflow-auto bg-[#0d1117] text-[13px]" />
        <div class="flex items-center gap-3 border-t border-white/5 px-4 py-2.5">
          <button
            v-if="!readOnly"
            :disabled="fileSaving"
            class="btn btn-primary btn-sm"
            @click="saveFile"
          >{{ fileSaving ? 'Saving…' : 'Save' }}</button>
          <span v-else class="text-[11px] text-slate-600">read-only account — changes can't be saved</span>
          <span v-if="fileMsg" class="whitespace-pre-line text-[11px]" :class="fileOk ? 'text-accent-light' : 'text-red-400'">{{ fileMsg }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
const props = defineProps<{ stack: string; composeFile?: string; readOnly?: boolean }>()

interface Entry {
  name: string
  type: 'file' | 'dir'
  size: number
  mtime: number
}

const path = ref('')
const entries = ref<Entry[]>([])
const loading = ref(false)
const err = ref('')
const uploadInput = ref<HTMLInputElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)

const crumbs = computed(() => (path.value ? path.value.split('/') : []))
const parentPath = computed(() => crumbs.value.slice(0, -1).join('/'))
const composeFile = computed(() => props.composeFile || 'compose.yaml')
const rel = (name: string) => (path.value ? `${path.value}/${name}` : name)

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 129600) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

async function load() {
  loading.value = true
  try {
    const r = await $fetch<{ path: string; entries: Entry[] }>(
      `/api/stacks/${encodeURIComponent(props.stack)}/files`,
      { query: { path: path.value } },
    )
    entries.value = r.entries
    err.value = ''
  } catch (e: any) {
    err.value = errMsg(e, 'Could not list files')
  } finally {
    loading.value = false
  }
}

function cd(p: string) {
  path.value = p
  naming.value = null
  pendingDelete.value = ''
  load()
}

function open(e: Entry) {
  if (e.type === 'dir') return cd(rel(e.name))
  openEditor(rel(e.name))
}

// --- editor modal ---
const editing = ref<string | null>(null)
const editorEl = ref<HTMLElement | null>(null)
const fileSaving = ref(false)
const fileMsg = ref('')
const fileOk = ref(false)
let fileView: any = null
// unsaved-edit tracking for the editor: baseline = content as opened / last saved
const fileDirty = ref(false)
let fileBaseline = ''
const { confirm: confirmDialog } = useConfirm()
useUnsavedGuard(() => editing.value !== null && fileDirty.value, 'The file you are editing has unsaved changes.')

async function setupFileEditor(content: string, yamlMode: boolean) {
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
      EditorView.updateListener.of((u: any) => {
        if (u.docChanged) fileDirty.value = fileView.state.doc.toString() !== fileBaseline
      }),
      EditorView.theme({ '&': { backgroundColor: 'transparent' }, '.cm-gutters': { backgroundColor: 'transparent' } }),
    ],
  })
  fileBaseline = content
  fileDirty.value = false
}

async function openEditor(relPath: string, initial = '') {
  fileMsg.value = ''
  editing.value = relPath
  let content = initial
  if (initial === '') {
    try {
      const r = await $fetch<{ content: string }>(`/api/stacks/${encodeURIComponent(props.stack)}/file`, {
        query: { path: relPath },
      })
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
  await setupFileEditor(content, /\.ya?ml$/i.test(relPath))
}

const modalEl = ref<HTMLElement | null>(null)
useFocusTrap(modalEl, () => editing.value !== null)
function onModalKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (!props.readOnly && !fileSaving.value) saveFile()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeEditor()
  }
}

async function closeEditor() {
  if (fileDirty.value && !(await confirmDialog({ title: 'Discard unsaved changes?', message: `Your edits to ${editing.value} have not been saved.`, confirmLabel: 'Discard', danger: true }))) return
  fileView?.destroy()
  fileView = null
  fileDirty.value = false
  editing.value = null
}

async function saveFile() {
  if (editing.value === null) return
  fileSaving.value = true
  fileMsg.value = ''
  try {
    await $fetch(`/api/stacks/${encodeURIComponent(props.stack)}/file`, {
      method: 'PUT',
      body: { path: editing.value, content: fileView.state.doc.toString() },
    })
    fileBaseline = fileView.state.doc.toString()
    fileDirty.value = false
    fileOk.value = true
    fileMsg.value = 'Saved.'
    load()
  } catch (e: any) {
    fileOk.value = false
    fileMsg.value = errMsg(e, 'Save failed')
  } finally {
    fileSaving.value = false
  }
}

// --- actions (all inline UI — native prompt/confirm are silently blocked in
// sandboxed/embedded views, which made the old buttons look dead) ---
const naming = ref<{ mode: 'file' | 'folder' | 'rename'; value: string; target?: Entry } | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const pendingDelete = ref('')

async function openNaming(mode: 'file' | 'folder' | 'rename', target?: Entry) {
  naming.value = naming.value?.mode === mode && !target ? null : { mode, value: target?.name ?? '', target }
  if (naming.value) {
    await nextTick()
    nameInput.value?.focus()
  }
}

async function confirmNaming() {
  if (!naming.value) return
  const { mode, target } = naming.value
  const name = naming.value.value.trim()
  if (!name) return
  err.value = ''
  if (mode === 'file') {
    naming.value = null
    return openEditor(rel(name), '\n')
  }
  try {
    if (mode === 'folder') {
      await $fetch(`/api/stacks/${encodeURIComponent(props.stack)}/files`, {
        method: 'POST',
        body: { action: 'mkdir', path: rel(name) },
      })
    } else {
      if (name === target!.name) {
        naming.value = null
        return
      }
      await $fetch(`/api/stacks/${encodeURIComponent(props.stack)}/files`, {
        method: 'POST',
        body: { action: 'rename', path: rel(target!.name), to: rel(name) },
      })
    }
    naming.value = null
    load()
  } catch (e: any) {
    err.value = errMsg(e, mode === 'folder' ? 'Could not create the folder' : 'Could not rename')
  }
}

async function deleteEntry(e: Entry) {
  pendingDelete.value = ''
  try {
    await $fetch(`/api/stacks/${encodeURIComponent(props.stack)}/files`, {
      method: 'POST',
      body: { action: 'delete', path: rel(e.name) },
    })
    load()
  } catch (er: any) {
    err.value = errMsg(er, 'Could not delete')
  }
}

async function upload(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (!files.length) return
  const fd = new FormData()
  fd.append('path', path.value)
  for (const f of files) fd.append('file', f)
  try {
    await $fetch(`/api/stacks/${encodeURIComponent(props.stack)}/upload`, { method: 'POST', body: fd })
    load()
  } catch (e: any) {
    err.value = errMsg(e, 'Upload failed')
  }
}

// jump the browser to a folder (a "Data & mounts" bind-mount row uses this) and
// scroll it into view — the relative path comes straight from the mount source
function goto(rel: string) {
  cd(rel)
  nextTick(() => rootEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}
defineExpose({ goto })

onMounted(load)
onBeforeUnmount(() => fileView?.destroy())
</script>
