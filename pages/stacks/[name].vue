<template>
  <div class="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-5 flex flex-wrap items-center gap-3">
      <NuxtLink to="/stacks" class="text-slate-400 hover:text-slate-200" aria-label="Back"><Icon name="arrow-left" class="h-[18px] w-[18px]" /></NuxtLink>
      <h1 class="text-xl font-semibold text-slate-100">{{ name }}</h1>
      <span v-if="file" class="font-mono text-xs text-slate-600">{{ file }}</span>
      <span
        v-if="source !== 'stacks' && !notManaged && !isNew"
        class="rounded-full border border-violet-400/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-violet-300"
        :title="`Managed in place at ${stackDir} — not in homeport's stacks directory`"
      >external</span>
      <span v-if="isNew" class="rounded-full border border-amber-400/30 px-2 py-0.5 text-[10px] uppercase text-amber-300">new</span>
      <span v-if="notManaged && rows.length" class="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">unmanaged</span>
      <div v-if="notManaged" class="ml-auto flex items-center gap-2">
        <button
          v-if="caps.updates && updatable.length"
          :disabled="updRunning || !!bulkBusy"
          class="inline-flex items-center gap-1.5 rounded-md border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-xs text-sky-300 hover:bg-sky-400/20 disabled:opacity-40"
          @click="updateAll"
        ><Icon name="arrow-up" class="h-3.5 w-3.5" /> {{ updRunning ? 'Updating…' : `Update all (${updatable.length})` }}</button>
        <template v-if="caps.control && rows.length">
          <button
            v-if="stackSvcs.some((s) => s.state !== 'running' && s.state !== 'restarting')"
            :disabled="!!bulkBusy || updRunning"
            class="inline-flex items-center gap-1.5 rounded-md border border-accent/25 px-2.5 py-1.5 text-xs text-accent-light hover:bg-accent/10 disabled:opacity-40"
            @click="bulk('start')"
          ><Icon name="play" class="h-3.5 w-3.5" /> {{ bulkBusy === 'start' ? 'Starting…' : 'Start all' }}</button>
          <button
            v-if="anyRunning"
            :disabled="!!bulkBusy || updRunning"
            class="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
            @click="bulk('restart')"
          ><Icon name="refresh" class="h-3.5 w-3.5" :class="bulkBusy === 'restart' ? 'animate-spin' : ''" /> {{ bulkBusy === 'restart' ? 'Restarting…' : 'Restart all' }}</button>
          <button
            v-if="anyRunning"
            :disabled="!!bulkBusy || updRunning"
            class="inline-flex items-center gap-1.5 rounded-md border border-red-500/20 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            @click="bulk('stop')"
          ><Icon name="square" class="h-3.5 w-3.5" /> {{ bulkBusy === 'stop' ? 'Stopping…' : 'Stop all' }}</button>
        </template>
      </div>
      <div v-else class="ml-auto flex items-center gap-2">
        <button
          v-if="gitInfo"
          :disabled="opRunning"
          class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-40"
          :class="gitInfo.behind ? 'border-accent/40 bg-accent/10 text-accent-light' : 'border-white/10 text-slate-300 hover:bg-white/5'"
          :title="gitInfo.behind ? 'The repository has new commits' : 'Re-pull and redeploy from the repository'"
          @click="runAction('update')"
        ><Icon name="arrow-up" class="h-3.5 w-3.5" /> {{ gitInfo.behind ? 'Update available' : 'Update from Git' }}</button>
        <button
          v-for="a in actions"
          :key="a.op"
          :disabled="opRunning"
          class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-40"
          :class="a.cls"
          @click="runAction(a.op)"
        ><Icon :name="a.icon" class="h-3.5 w-3.5" /> {{ a.label }}</button>
        <button
          v-if="source === 'stacks'"
          :disabled="opRunning"
          class="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
          title="compose down, then remove the stack directory"
          @click="deletePanel = !deletePanel"
        ><Icon name="x" class="h-3.5 w-3.5" /> Delete</button>
      </div>
    </header>

    <!-- delete confirmation: what else should leave the machine with the stack -->
    <div v-if="deletePanel" class="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
      <p class="mb-2 text-sm font-semibold text-red-300">Delete stack “{{ name }}”</p>
      <p class="mb-3 text-xs text-slate-400">
        Containers are taken down, leftover project networks are removed, and the stack directory (compose file) is
        deleted. Pick what else should go — everything below is <strong>irreversible</strong>.
      </p>
      <div class="space-y-1.5 text-xs text-slate-300">
        <label class="flex items-center gap-2">
          <input v-model="del.volumes" type="checkbox" class="h-3 w-3" />
          also delete its named volumes — <span class="text-red-300/90">all the stack's data</span>
        </label>
        <label class="flex items-center gap-2">
          <input v-model="del.images" type="checkbox" class="h-3 w-3" />
          also delete its images (re-downloaded on a future install)
        </label>
        <label v-if="caps.proxyAdmin" class="flex items-center gap-2">
          <input v-model="del.proxyRoutes" type="checkbox" class="h-3 w-3" />
          also remove its domains from the reverse proxy
        </label>
      </div>
      <div class="mt-3 flex items-center gap-2">
        <button
          :disabled="opRunning"
          class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-40"
          @click="deleteStack"
        >Delete permanently</button>
        <button class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5" @click="deletePanel = false">Cancel</button>
      </div>
    </div>

    <!-- external project location -->
    <div v-if="source !== 'stacks' && !notManaged && !isNew" class="mb-4 rounded-md border border-white/5 bg-ink-900/60 px-3 py-2 text-xs text-slate-500">
      Managed in place at <code class="text-slate-400">{{ stackDir }}</code> — edits and compose operations act on the
      real files there; delete it from that directory if you want it gone.
    </div>

    <!-- git source line -->
    <div v-if="gitInfo" class="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-white/5 bg-ink-900/60 px-3 py-2 text-xs">
      <span class="rounded-full border border-sky-400/30 px-1.5 py-px text-[9px] uppercase tracking-wider text-sky-300">git</span>
      <a :href="gitInfo.repo" target="_blank" rel="noopener" class="font-mono text-slate-300 hover:text-slate-100 hover:underline">{{ gitInfo.repo }}</a>
      <span class="text-slate-600">{{ gitInfo.branch }} @ {{ gitInfo.commit }}</span>
      <span class="truncate text-slate-500" :title="gitInfo.subject">“{{ gitInfo.subject }}”</span>
      <span v-if="gitInfo.behind" class="rounded-full border border-accent/40 px-2 py-0.5 text-[10px] text-accent-light">
        {{ gitInfo.remoteCommit }} available
      </span>
      <button
        class="ml-auto rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 disabled:opacity-40"
        :disabled="gitChecking"
        @click="loadGit(true)"
      >{{ gitChecking ? 'Checking…' : 'Check' }}</button>
    </div>

    <div v-if="loadError && !notManaged" class="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ loadError }}</div>

    <!-- unmanaged compose project: no compose file here, but the containers are real -->
    <template v-if="notManaged">
      <div v-if="!svcData" class="py-20 text-center text-slate-500">Loading…</div>
      <div v-else-if="!rows.length" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
        No stack or running compose project named “{{ name }}” was found.
        <NuxtLink to="/stacks" class="text-accent-light hover:underline">Back to stacks</NuxtLink>
      </div>
      <div v-else class="mb-4 rounded-lg border border-white/5 bg-ink-900 p-4 text-sm text-slate-400">
        This compose project is running on the host, but homeport can't see its compose files —
        so it can't be edited or compose-operated from here. You can still control and update its containers below.
        <span class="mt-1 block text-xs text-slate-600">
          To manage it fully, mount its project folder into the homeport container at the <strong>same path it has on
          the host</strong> (e.g. <code class="text-slate-500">-v /home/user/docker:/home/user/docker</code>) — visible
          projects are adopted automatically; a parent folder of many projects can also be added under
          Settings → Compose roots.
        </span>
      </div>
      <p v-if="bulkMsg" class="mb-4 whitespace-pre-line text-xs" :class="bulkOk ? 'text-accent-light' : 'text-red-400'">{{ bulkMsg }}</p>

      <!-- whole-project update progress -->
      <div v-if="updLines.length || updRunning" class="mb-4 rounded-lg border border-white/5 bg-ink-950/60 p-3">
        <div class="mb-1 flex items-center gap-2 text-xs text-slate-500">
          <span class="h-1.5 w-1.5 rounded-full" :class="updRunning ? 'animate-pulse bg-amber-400' : 'bg-ok'" />
          {{ updRunning ? 'updating containers…' : 'update finished' }}
        </div>
        <pre class="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">{{ updLines.join('\n') }}</pre>
      </div>
    </template>

    <!-- editor -->
    <div v-if="!notManaged" class="rounded-lg border border-white/10 bg-[#0b0f14]">
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
        <span class="h-1.5 w-1.5 rounded-full" :class="opRunning ? 'animate-pulse bg-amber-400' : opOk ? 'bg-ok' : 'bg-red-400'" />
        {{ opRunning ? 'running…' : opOk ? 'finished' : 'failed' }}
      </div>
      <pre class="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">{{ opLines.join('\n') }}</pre>
    </div>

    <!-- docker network conflict helper (compose "Pool overlaps" failures) -->
    <div v-if="netIssue" class="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
      <h3 class="mb-1 text-sm font-semibold text-amber-300">Docker network conflict</h3>
      <p class="text-xs text-slate-400">
        <template v-if="netIssue === 'overlap'">
          A network this stack defines asks for an address range an existing docker network already occupies.
          Change the subnet under <code class="text-slate-500">networks: … ipam</code> in the compose file (any free
          range works), or remove the conflicting network below if nothing uses it.
        </template>
        <template v-else>
          Docker has no free address pools left for a new network — removing unused networks frees address space.
        </template>
      </p>
      <p v-if="netErr" class="mt-2 text-xs text-red-400">{{ netErr }}</p>
      <div v-if="networks.length" class="mt-3 space-y-1">
        <div
          v-for="n in networks"
          :key="n.id"
          class="flex items-center gap-3 rounded-md border px-3 py-1.5 text-xs"
          :class="conflictNames.has(n.name) ? 'border-amber-400/30 bg-amber-400/5' : 'border-white/5'"
        >
          <span class="font-mono text-slate-200">{{ n.name }}</span>
          <span v-if="conflictNames.has(n.name)" class="rounded-full border border-amber-400/40 px-1.5 py-px text-[10px] uppercase text-amber-300">conflict</span>
          <span class="font-mono text-slate-500">{{ n.subnets.join(', ') || '—' }}</span>
          <span class="ml-auto text-slate-500">{{ n.containers ? `${n.containers} container${n.containers > 1 ? 's' : ''}` : 'unused' }}</span>
          <button
            v-if="!n.builtin && n.containers === 0"
            :disabled="netBusy === n.name"
            class="rounded-md border border-red-500/25 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            @click="removeNetwork(n.name)"
          >{{ netBusy === n.name ? 'Removing…' : 'Remove' }}</button>
        </div>
      </div>
      <button
        class="mt-3 rounded-md border border-accent/25 px-3 py-1.5 text-xs text-accent-light hover:bg-accent/10 disabled:opacity-40"
        :disabled="opRunning"
        @click="runAction('up')"
      >Run “Up” again</button>
    </div>

    <!-- file browser: everything in the stack's directory -->
    <StackFiles v-if="!notManaged && !isNew" :stack="name" :compose-file="file" class="mt-6" />

    <!-- services in this stack (compose project) -->
    <section v-if="rows.length" class="mt-6">
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
        Services <span class="ml-1 font-normal normal-case text-slate-600">{{ runningCount }}/{{ rows.length }} running</span>
      </h2>
      <div class="space-y-1.5">
        <NuxtLink
          v-for="s in rows"
          :key="s.id"
          :to="`/services/${encodeURIComponent(s.id)}`"
          class="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-900 px-4 py-2.5 transition-colors hover:border-accent/30"
        >
          <ServiceIcon :name="s.displayName" :icon="s.icon" :size="28" :remote="svcData?.remoteIcons ?? true" />
          <div class="min-w-0 flex-1">
            <span class="flex items-center gap-2 truncate text-sm text-slate-200">
              {{ s.displayName }}
              <span
                v-if="updates.entryFor(s)?.status === 'update'"
                class="shrink-0 rounded-full border border-sky-400/30 bg-sky-400/10 px-1.5 py-px text-[10px] text-sky-300"
              >update</span>
            </span>
            <span class="block truncate font-mono text-[11px] text-slate-600">{{ s.image }}</span>
          </div>
          <span v-if="!liveIds.has(s.id)" class="shrink-0 animate-pulse text-[11px] text-amber-300">recreating…</span>
          <template v-else>
            <span v-if="stats[s.id]" class="hidden shrink-0 font-mono text-[11px] text-slate-500 sm:block">
              CPU {{ stats[s.id].cpuPercent ?? '—' }}% · RAM {{ formatBytes(stats[s.id].memBytes) }}
            </span>
            <StatusPill :state="s.state" :health="s.health" />
          </template>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const route = useRoute()
const name = String(route.params.name)
const isNew = ref(String(route.query.new || '') === '1')

const file = ref('')
const source = ref<'stacks' | 'root' | 'adopted'>('stacks')
const stackDir = ref('')
const loadError = ref('')
const notManaged = ref(false) // no stack dir for this name — unmanaged compose project view

// live services belonging to this compose project (both managed + unmanaged views)
const { data: svcData, refresh: svcRefresh, start: svcStart, stop: svcStop } = useServices()
const { stats, start: statsStart, stop: statsStop } = useStats()
const { caps, load: loadCaps } = useCapabilities()
const updates = useUpdates()
const stackSvcs = computed(() => (svcData.value?.services ?? []).filter((s) => s.project === name))
const runningCount = computed(() => stackSvcs.value.filter((s) => s.state === 'running' || s.state === 'restarting').length)
const anyRunning = computed(() => runningCount.value > 0)

// Containers vanish from the live list for a few seconds while an update
// recreates them — keep showing the last-seen set so the page doesn't collapse
// into "this project doesn't exist" mid-operation.
const seenSvcs = ref<Service[]>([])
watchEffect(() => {
  if (stackSvcs.value.length) seenSvcs.value = stackSvcs.value
})
const rows = computed(() => (stackSvcs.value.length ? stackSvcs.value : seenSvcs.value))
const liveIds = computed(() => new Set(stackSvcs.value.map((s) => s.id)))

// whole-project update: recreate every container that has a newer image
const updatable = computed(() => rows.value.filter((s) => updates.entryFor(s)?.status === 'update'))
const updLines = ref<string[]>([])
const updRunning = ref(false)
async function updateAll() {
  const targets = [...updatable.value]
  if (!targets.length) return
  if (!window.confirm(`Update ${targets.length} container${targets.length > 1 ? 's' : ''} in “${name}” to the latest images? Each is pulled and recreated in place.`)) return
  updRunning.value = true
  updLines.value = []
  for (const s of targets) {
    updLines.value.push(`${s.displayName}: pulling and recreating…`)
    try {
      await $fetch('/api/updates/apply', { method: 'POST', body: { id: s.id, image: s.image } })
      updLines.value[updLines.value.length - 1] = `${s.displayName}: updated`
    } catch (e: any) {
      updLines.value[updLines.value.length - 1] = `${s.displayName}: FAILED — ${errMsg(e, 'update failed')}`
    }
    await svcRefresh()
  }
  updRunning.value = false
  await Promise.all([svcRefresh(), updates.refresh()])
}

// bulk container controls for unmanaged projects (no compose file to run ops with)
const bulkBusy = ref<'' | 'start' | 'stop' | 'restart'>('')
const bulkMsg = ref('')
const bulkOk = ref(true)
async function bulk(action: 'start' | 'stop' | 'restart') {
  const targets = stackSvcs.value.filter((s) =>
    s.kind === 'container' && (action === 'start' ? s.state !== 'running' && s.state !== 'restarting' : s.state === 'running' || s.state === 'restarting'),
  )
  if (!targets.length) return
  const verb = action === 'stop' ? 'Stop' : action === 'restart' ? 'Restart' : ''
  if (verb && !window.confirm(`${verb} ${targets.length} container${targets.length > 1 ? 's' : ''} in “${name}”?`)) return
  bulkBusy.value = action
  bulkMsg.value = ''
  const errors: string[] = []
  for (const s of targets) {
    try {
      await $fetch('/api/control', { method: 'POST', body: { id: s.id, action } })
    } catch (e: any) {
      errors.push(`${s.displayName}: ${errMsg(e, 'failed')}`)
    }
  }
  bulkBusy.value = ''
  bulkOk.value = !errors.length
  bulkMsg.value = errors.length ? errors.join('\n') : ''
  svcRefresh()
}
const editorEl = ref<HTMLElement | null>(null)
const dirty = ref(false)
const saving = ref(false)
const saveMsg = ref('')
const saveOk = ref(false)

let view: any = null
let savedContent = ''

// "New stack" from the Docker Hub tab seeds the template with the chosen image
const seedImageRaw = String(route.query.image || '')
const seedImage = /^[a-z0-9][a-z0-9._/-]*$/i.test(seedImageRaw) ? seedImageRaw : ''
const NEW_TEMPLATE = seedImage
  ? `services:\n  app:\n    image: ${seedImage}${seedImage.includes(':') ? '' : ':latest'}\n    restart: unless-stopped\n    # ports:\n    #   - "8080:80"\n    # volumes:\n    #   - ./data:/data\n`
  : `services:\n  app:\n    image: nginx:alpine\n    restart: unless-stopped\n    ports:\n      - "8080:80"\n`

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
    const s = await $fetch<{ name: string; file: string; content: string; source?: 'stacks' | 'root' | 'adopted'; dir?: string }>(
      `/api/stacks/${encodeURIComponent(name)}`,
    )
    file.value = s.file
    source.value = s.source ?? 'stacks'
    stackDir.value = s.dir ?? ''
    savedContent = s.content
    await setupEditor(s.content)
  } catch (e: any) {
    const code = e?.statusCode ?? e?.response?.status
    if (code === 401) return navigateTo('/login')
    // 404 = no stack dir; 403 = stacks disabled — either way, fall back to the
    // unmanaged-project view driven by the live container list
    if (code === 404 || code === 403) {
      notManaged.value = true
      return
    }
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
  { op: 'up', icon: 'play', label: 'Up', cls: 'border-accent/25 text-accent-light hover:bg-accent/10' },
  { op: 'restart', icon: 'refresh', label: 'Restart', cls: 'border-white/10 text-slate-300 hover:bg-white/5' },
  { op: 'pull', icon: 'download', label: 'Pull & up', cls: 'border-sky-400/25 text-sky-300 hover:bg-sky-400/10' },
  { op: 'down', icon: 'square', label: 'Down', cls: 'border-red-500/20 text-red-300 hover:bg-red-500/10' },
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

// --- docker network conflict helper ---
// a failed op whose output matches docker's address-space errors gets a card
// listing live networks, with one-click removal of unused ones
const netIssue = computed<null | 'overlap' | 'exhausted'>(() => {
  if (opRunning.value || opOk.value !== false) return null
  const text = opLines.value.join('\n')
  if (/pool overlaps with other one on this address space/i.test(text)) return 'overlap'
  if (/(could not find an available, non-overlapping|all predefined address pools have been fully subnetted)/i.test(text))
    return 'exhausted'
  return null
})
// networks the server-side hints named as conflicting — highlighted in the card
const conflictNames = computed(() => {
  const out = new Set<string>()
  for (const m of opLines.value.join('\n').matchAll(/overlaps existing network "([^"]+)"/g)) out.add(m[1])
  return out
})
interface NetRow {
  id: string
  name: string
  driver: string
  builtin: boolean
  subnets: string[]
  containers: number
}
const networks = ref<NetRow[]>([])
const netBusy = ref('')
const netErr = ref('')
watch(netIssue, (v) => {
  if (v) loadNetworks()
})
async function loadNetworks() {
  try {
    networks.value = (await $fetch<{ networks: NetRow[] }>('/api/networks')).networks
    netErr.value = ''
  } catch (e: any) {
    netErr.value = errMsg(e, 'could not list networks')
  }
}
async function removeNetwork(netName: string) {
  if (!window.confirm(`Remove docker network “${netName}”? No containers reference it.`)) return
  netBusy.value = netName
  try {
    await $fetch('/api/networks/remove', { method: 'POST', body: { name: netName } })
    await loadNetworks()
  } catch (e: any) {
    netErr.value = errMsg(e, 'could not remove the network')
  } finally {
    netBusy.value = ''
  }
}

const deletePanel = ref(false)
const del = reactive({ volumes: false, images: false, proxyRoutes: false })

async function deleteStack() {
  if (
    del.volumes &&
    !window.confirm(`Also delete ALL named volumes of “${name}”? Databases and app data in them are gone for good.`)
  )
    return
  deletePanel.value = false
  opLines.value = []
  opOk.value = null
  opRunning.value = true
  try {
    const { opId } = await $fetch<{ opId: string }>(`/api/stacks/${encodeURIComponent(name)}/delete`, {
      method: 'POST',
      body: { volumes: del.volumes, images: del.images, proxyRoutes: del.proxyRoutes },
    })
    attachOp(opId, () => {
      if (opOk.value) setTimeout(() => navigateTo('/stacks', { replace: true }), 1200)
    })
  } catch (e: any) {
    opLines.value.push(errMsg(e, 'could not start the delete'))
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
  loadCaps()
  svcStart()
  statsStart()
  updates.refresh()
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
  svcStop()
  statsStop()
})

useHead({ title: `${name} — stacks — homeport` })
</script>
