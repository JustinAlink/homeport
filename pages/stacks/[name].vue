<template>
  <div class="page">
    <PageHeader :title="name" :crumbs="[{ label: 'Stacks', to: '/stacks' }]">
      <template #icon>
        <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-slate-400 ring-1 ring-inset ring-white/[0.08]">
          <Icon name="stacks" class="h-5 w-5" />
        </div>
      </template>
      <template #badges>
        <span v-if="file" class="badge font-mono">{{ file }}</span>
        <span v-if="gitInfo" class="badge badge-info"><Icon name="git-branch" class="h-3 w-3" />git</span>
        <component
          :is="stackOwnerUrl ? 'a' : 'span'"
          v-if="stackOwner"
          v-bind="stackOwnerUrl ? { href: stackOwnerUrl, target: '_blank', rel: 'noopener noreferrer' } : {}"
          class="badge badge-warn"
          :class="stackOwnerUrl ? 'hover:brightness-110' : ''"
          :title="`The compose file says it is managed by ${stackOwner} (x-homeport: managed-by), so homeport doesn't write it${stackOwnerUrl ? '. Opens ' + stackOwnerUrl : ''}`"
        >managed by {{ stackOwner }}<Icon v-if="stackOwnerUrl" name="external" class="h-3 w-3" /></component>
        <span
          v-if="source !== 'stacks' && !notManaged && !isNew"
          class="badge"
          :title="`Managed in place at ${stackDir}, not in homeport's stacks directory`"
        >external</span>
        <span v-if="isNew" class="badge badge-warn">new, not saved yet</span>
        <span v-if="deleting" class="badge badge-danger"><span class="dot h-1.5 w-1.5 animate-pulse bg-red-400" />deleting…</span>
        <span v-if="notManaged && rows.length" class="badge">unmanaged</span>
      </template>
      <template v-if="rows.length || missingRows.length" #subtitle>
        {{ runningCount }} of {{ serviceTotal }} service{{ serviceTotal === 1 ? '' : 's' }} running<template v-if="missingRows.length">: {{ missingRows.map((m) => m.name).join(', ') }} {{ missingRows.length > 1 ? 'have' : 'has' }} no container</template>
      </template>
      <template #actions>
        <!-- unmanaged project: no compose file, so act on the containers directly -->
        <template v-if="notManaged">
          <button
            v-if="caps.updates && updatable.length"
            :disabled="updRunning || !!bulkBusy"
            class="btn btn-primary"
            @click="updateAll"
          ><Icon name="arrow-up" /> {{ updRunning ? 'Updating…' : `Update all (${updatable.length})` }}</button>
          <template v-if="caps.control && rows.length">
            <button
              v-if="stackSvcs.some((s) => s.state !== 'running' && s.state !== 'restarting')"
              :disabled="!!bulkBusy || updRunning"
              class="btn"
              @click="bulk('start')"
            ><Icon name="play" /> {{ bulkBusy === 'start' ? 'Starting…' : 'Start all' }}</button>
            <div v-if="anyRunning" class="btn-group">
              <button :disabled="!!bulkBusy || updRunning" class="btn" @click="bulk('restart')">
                <Icon name="refresh" :class="bulkBusy === 'restart' ? 'animate-spin' : ''" /> {{ bulkBusy === 'restart' ? 'Restarting…' : 'Restart all' }}
              </button>
              <button :disabled="!!bulkBusy || updRunning" class="btn hover:!text-red-300" @click="bulk('stop')">
                <Icon name="square" /> {{ bulkBusy === 'stop' ? 'Stopping…' : 'Stop all' }}
              </button>
            </div>
          </template>
        </template>
        <template v-else-if="caps.control">
          <!-- whole-stack image update: pull newer images + recreate. A git stack needs
               it too: "Update from git" changes the compose file, it pulls no images. -->
          <button
            v-if="updatable.length"
            :disabled="opRunning"
            class="btn btn-primary"
            :title="`${updatable.map((s) => s.displayName).join(', ')} ${updatable.length > 1 ? 'have' : 'has'} a newer image: pull and recreate (docker compose pull, then up -d)`"
            @click="runAction('pull')"
          ><Icon name="arrow-up" /> {{ gitInfo ? 'Update images' : 'Update stack' }} ({{ updatable.length }})</button>
          <button
            v-if="gitInfo"
            :disabled="opRunning"
            class="btn"
            :class="gitInfo.behind ? 'btn-primary' : ''"
            :title="gitInfo.behind ? 'The repository has new commits' : 'Re-pull and redeploy from the repository'"
            @click="runAction('update')"
          ><Icon name="git-branch" /> {{ gitInfo.behind ? 'Update from git' : 'Redeploy from git' }}</button>
          <div class="btn-group">
            <button
              v-for="a in shownActions"
              :key="a.op"
              :disabled="opRunning || isNew"
              class="btn"
              :class="a.op === 'down' ? 'hover:!text-red-300' : ''"
              :title="a.title"
              @click="runAction(a.op)"
            ><Icon :name="a.icon" /> {{ a.label }}</button>
          </div>
          <button
            v-if="source === 'stacks' && !isNew"
            :disabled="opRunning"
            class="btn btn-danger btn-icon"
            title="Delete stack: compose down, then remove the stack directory"
            aria-label="Delete stack"
            @click="deletePanel = !deletePanel"
          ><Icon name="trash" /></button>
        </template>
      </template>
    </PageHeader>

    <!-- delete confirmation: what else should leave the machine with the stack -->
    <div v-if="deletePanel" class="card mb-5 border-red-500/25">
      <div class="card-header border-red-500/15">
        <span class="card-title text-red-300">Delete stack “{{ name }}”</span>
      </div>
      <div class="space-y-3 p-4 sm:p-5">
        <p class="text-[13px] text-slate-400">
          Containers are taken down, leftover project networks are removed, and the stack directory (compose file) is
          deleted. Pick what else should go. Everything below is <strong class="text-slate-200">irreversible</strong>.
        </p>
        <div class="space-y-2">
          <label class="check"><input v-model="del.volumes" type="checkbox" /> <span>Also delete its named volumes: <span class="text-red-300">all of the stack's data</span></span></label>
          <label class="check"><input v-model="del.images" type="checkbox" /> <span>Also delete its images (re-downloaded on a future install)</span></label>
          <label v-if="caps.proxyAdmin && !caps.viewer" class="check"><input v-model="del.proxyRoutes" type="checkbox" /> <span>Also remove its domains from the reverse proxy</span></label>
        </div>
        <div class="flex items-center gap-2 pt-1">
          <button :disabled="opRunning" class="btn btn-danger-solid" @click="deleteStack"><Icon name="trash" /> Delete permanently</button>
          <button class="btn btn-ghost" @click="deletePanel = false">Cancel</button>
        </div>
      </div>
    </div>

    <div v-if="loadError && !notManaged" class="callout callout-warn mb-5"><Icon name="alert" /><span>{{ loadError }}</span></div>

    <!-- operation output, right under the buttons that start it -->
    <div v-if="opLines.length || opRunning" class="card mb-5 overflow-hidden">
      <div class="card-header">
        <span class="flex items-center gap-2 text-[13px] font-medium" :class="opRunning ? 'text-slate-200' : opDropped ? 'text-amber-300' : opOk ? 'text-ok' : 'text-red-300'">
          <Icon v-if="opRunning" name="refresh" class="h-3.5 w-3.5 animate-spin" />
          <Icon v-else :name="opOk && !opDropped ? 'check' : 'alert'" class="h-3.5 w-3.5" />
          {{ opRunning ? 'Running…' : opDropped ? 'Lost the connection to the operation. It may still be running; reload to check.' : opOk ? 'Finished' : 'Failed' }}
        </span>
        <button v-if="!opRunning" class="btn btn-ghost btn-icon btn-sm ml-auto" aria-label="Dismiss output" @click="opLines = []"><Icon name="x" /></button>
      </div>
      <pre class="max-h-72 overflow-y-auto whitespace-pre-wrap bg-ink-950/60 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-slate-300">{{ opLines.join('\n') }}</pre>
    </div>

    <!-- docker network conflict helper (compose "Pool overlaps" failures) -->
    <div v-if="netIssue" class="card mb-5 border-amber-500/25">
      <div class="card-header"><span class="card-title flex items-center gap-2 text-amber-300"><Icon name="alert" class="h-4 w-4" /> Docker network conflict</span></div>
      <div class="p-4 sm:p-5">
        <p class="text-[13px] leading-relaxed text-slate-400">
          <template v-if="netIssue === 'overlap'">
            A network this stack defines asks for an address range an existing docker network already occupies. Change the
            subnet under <code>networks: … ipam</code> in the compose file (any free range works), or remove the conflicting
            network below if nothing uses it.
          </template>
          <template v-else>Docker has no free address pools left for a new network. Removing unused networks frees address space.</template>
        </p>
        <p v-if="netErr" class="mt-2 text-xs text-red-400">{{ netErr }}</p>
        <div v-if="networks.length" class="mt-3 overflow-hidden rounded-lg border border-white/[0.08]">
          <div
            v-for="n in networks"
            :key="n.id"
            class="flex items-center gap-3 border-t border-white/[0.06] px-3 py-2 text-xs first:border-t-0"
            :class="conflictNames.has(n.name) ? 'bg-amber-400/5' : ''"
          >
            <span class="font-mono text-slate-200">{{ n.name }}</span>
            <span v-if="conflictNames.has(n.name)" class="badge badge-warn">conflict</span>
            <span class="font-mono text-slate-500">{{ n.subnets.join(', ') || '·' }}</span>
            <span class="ml-auto text-slate-500">{{ n.containers ? `${n.containers} container${n.containers > 1 ? 's' : ''}` : 'unused' }}</span>
            <button
              v-if="!n.builtin && n.containers === 0"
              :disabled="netBusy === n.name"
              class="btn btn-danger btn-sm"
              @click="removeNetwork(n.name)"
            >{{ netBusy === n.name ? 'Removing…' : 'Remove' }}</button>
          </div>
        </div>
        <button class="btn btn-sm mt-3" :disabled="opRunning" @click="runAction('up')"><Icon name="play" /> Run “Up” again</button>
      </div>
    </div>

    <!-- unmanaged compose project: no compose file here, but the containers are real -->
    <template v-if="notManaged">
      <div v-if="!svcData" class="card h-24" />
      <div v-else-if="!rows.length" class="card">
        <EmptyState icon="stacks" :title="`No stack named “${name}”`" text="There's no stack directory or running compose project with this name.">
          <template #actions><NuxtLink to="/stacks" class="btn btn-sm">Back to stacks</NuxtLink></template>
        </EmptyState>
      </div>
      <div v-else class="callout callout-info mb-5">
        <Icon name="info" />
        <div>
          This compose project runs on the host, but homeport can't see its compose files, so it can't be edited or
          compose-operated from here. You can still control and update its containers below.
          <p class="mt-1 text-xs text-slate-500">
            To manage it fully, mount its project folder into the homeport container at the <strong class="text-slate-400">same
            path it has on the host</strong> (e.g. <code>-v /home/user/docker:/home/user/docker</code>). Visible projects are
            adopted automatically; a parent folder of many projects can also be added under Settings → Capabilities → Compose roots.
          </p>
        </div>
      </div>
      <p v-if="bulkMsg" class="callout mb-5 whitespace-pre-line" :class="bulkOk ? 'callout-info' : 'callout-danger'"><Icon :name="bulkOk ? 'check' : 'alert'" />{{ bulkMsg }}</p>

      <!-- whole-project update progress -->
      <div v-if="updLines.length || updRunning" class="card mb-5 overflow-hidden">
        <div class="card-header">
          <span class="flex items-center gap-2 text-[13px] font-medium" :class="updRunning ? 'text-slate-200' : 'text-ok'">
            <Icon :name="updRunning ? 'refresh' : 'check'" class="h-3.5 w-3.5" :class="updRunning ? 'animate-spin' : ''" />
            {{ updRunning ? 'Updating containers…' : 'Update finished' }}
          </span>
        </div>
        <pre class="max-h-64 overflow-y-auto whitespace-pre-wrap bg-ink-950/60 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-slate-300">{{ updLines.join('\n') }}</pre>
      </div>
    </template>

    <!-- services in this stack (compose project) -->
    <section v-if="rows.length || missingRows.length" class="mb-6">
      <div class="mb-2.5 flex items-baseline gap-2">
        <h2 class="section-title">Services</h2>
        <span class="text-xs text-slate-500">{{ runningCount }}/{{ serviceTotal }} running</span>
      </div>
      <div class="card row-list overflow-hidden">
        <NuxtLink
          v-for="s in rows"
          :key="s.id"
          :to="`/services/${encodeURIComponent(s.id)}`"
          class="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025] sm:px-5"
        >
          <ServiceIcon :name="s.displayName" :icon="s.icon" :size="28" :remote="svcData?.remoteIcons ?? true" />
          <div class="min-w-0 flex-1">
            <span class="flex items-center gap-2 truncate text-[13.5px] font-medium text-slate-100 group-hover:text-accent-light">
              {{ s.displayName }}
              <span v-if="updates.entryFor(s)?.status === 'update'" class="badge badge-info h-[18px] px-1 text-[10px]"><Icon name="arrow-up" class="h-2.5 w-2.5" />update</span>
            </span>
            <span class="block truncate font-mono text-[11px] text-slate-500">{{ s.image }}</span>
          </div>
          <span v-if="!liveIds.has(s.id)" class="shrink-0 animate-pulse text-xs text-amber-300">recreating…</span>
          <template v-else>
            <span v-if="stats[s.id]" class="hidden shrink-0 font-mono text-[11.5px] tabular-nums text-slate-500 sm:block">
              {{ stats[s.id].cpuPercent ?? '·' }}% · {{ formatBytes(stats[s.id].memBytes) }}
            </span>
            <span class="w-28 text-right"><StatusPill :state="s.state" :health="s.health" compact :text="s.statusText.replace(/\s*\(healthy\)/, '')" /></span>
          </template>
        </NuxtLink>
        <NotRunningCard v-for="m in missingRows" :key="'m:' + m.name" :name="m.name" :image="m.image" :stack="name" layout="row" />
      </div>
    </section>

    <!-- compose editor -->
    <section v-if="!notManaged" class="mb-6">
      <!-- a tracked file in a git stack: the next update from git resets it -->
      <p v-if="caps.control && gitTracked.isTracked(file || 'compose.yaml')" class="callout callout-warn mb-3 text-xs">
        <Icon name="git-branch" />
        <span>{{ gitTracked.note(file || 'compose.yaml') }}</span>
      </p>
      <div class="card overflow-hidden">
        <div class="card-header">
          <Icon name="file-text" class="h-4 w-4 text-slate-500" />
          <span class="card-title font-mono text-[12.5px]">{{ file || 'compose.yaml' }}</span>
          <span v-if="dirty" class="badge badge-warn">unsaved</span>
          <span v-if="saveMsg" class="whitespace-pre-line text-xs" :class="saveOk ? 'text-ok' : 'text-red-400'">{{ saveMsg }}</span>
          <div class="ml-auto flex items-center gap-2">
            <span v-if="caps.control" class="hidden items-center gap-1 text-[11px] text-slate-500 sm:flex"><span class="kbd">{{ modKey }}</span><span class="kbd">S</span> to save</span>
            <button v-if="caps.control" :disabled="saving || !dirty" class="btn btn-primary btn-sm" @click="save">{{ saving ? 'Saving…' : isNew ? 'Create stack' : 'Save' }}</button>
            <span v-else class="text-xs text-slate-500">read-only account</span>
          </div>
        </div>
        <div class="bg-[#0d1117]" @keydown="onEditorKey">
          <div ref="editorEl" class="max-h-[60vh] min-h-[16rem] overflow-auto text-[13px]" />
        </div>
      </div>
      <!-- external project location -->
      <p v-if="source !== 'stacks' && !isNew" class="mt-2 text-xs text-slate-500">
        Managed in place at <code>{{ stackDir }}</code>: edits and compose operations act on the real files there. Delete it from
        that directory if you want it gone.
      </p>
      <!-- git source -->
      <div v-if="gitInfo" class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/[0.08] bg-ink-900/60 px-3.5 py-2.5 text-xs">
        <Icon name="git-branch" class="h-3.5 w-3.5 text-sky-300" />
        <a :href="gitInfo.repo" target="_blank" rel="noopener" class="font-mono text-slate-300 hover:text-slate-100 hover:underline">{{ gitInfo.repo }}</a>
        <span class="text-slate-500">{{ gitInfo.branch }} @ <span class="font-mono">{{ gitInfo.commit }}</span></span>
        <span class="truncate text-slate-500" :title="gitInfo.subject">“{{ gitInfo.subject }}”</span>
        <span v-if="gitInfo.behind" class="badge badge-accent">{{ gitInfo.remoteCommit }} available</span>
        <button class="btn btn-ghost btn-sm ml-auto" :disabled="gitChecking" @click="loadGit(true)">
          <Icon name="refresh" :class="gitChecking ? 'animate-spin' : ''" /> {{ gitChecking ? 'Checking…' : 'Check for changes' }}
        </button>
      </div>
    </section>

    <!-- file browser: everything in the stack's directory -->
    <StackFiles v-if="!notManaged && !isNew" ref="filesRef" :stack="name" :compose-file="file" :read-only="!caps.control" :git="gitInfo" :managed-by="stackOwner" class="mb-6" />

    <!-- where the stack's data actually lives: named volumes + host binds that
         sit OUTSIDE the compose file (an installed app's config/data isn't a mystery) -->
    <StackMounts v-if="!notManaged && !isNew" :stack="name" @browse="onBrowse" />
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
const { confirm } = useConfirm()
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

// services the compose file declares that have no container (down, or failed to start)
const stacksStore = useStacks()
const missingRows = computed(() => (notManaged.value ? [] : stacksStore.byName(name)?.missing ?? []))
const serviceTotal = computed(() => rows.value.length + missingRows.value.length)

// whole-project update: recreate every container that has a newer image
const updatable = computed(() => rows.value.filter((s) => updates.entryFor(s)?.status === 'update'))
const updLines = ref<string[]>([])
const updRunning = ref(false)
async function updateAll() {
  const targets = [...updatable.value]
  if (!targets.length) return
  if (!(await confirm({ message: `Update ${targets.length} container${targets.length > 1 ? 's' : ''} in “${name}” to the latest images? Each is pulled and recreated in place.`, confirmLabel: 'Update all' }))) return
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
  if (verb && !(await confirm({ message: `${verb} ${targets.length} container${targets.length > 1 ? 's' : ''} in “${name}”?`, confirmLabel: verb, danger: action === 'stop' }))) return
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
// the file browser, so a "Data & mounts" bind-mount row can jump straight to it
const filesRef = ref<{ goto: (rel: string) => void } | null>(null)
function onBrowse(rel: string) {
  filesRef.value?.goto(rel)
}
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
      EditorView.editable.of(caps.value.control),
      EditorView.contentAttributes.of({ 'aria-label': `${name} compose file` }),
      EditorView.theme({ '&': { backgroundColor: 'transparent' }, '.cm-gutters': { backgroundColor: 'transparent' }, '.cm-gutterElement': { color: '#9aa3b2' } }),
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
  if (!(await gitTracked.confirmSave(file.value || 'compose.yaml'))) return
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
  { op: 'up', icon: 'play', label: 'Up', title: 'docker compose up -d' },
  { op: 'restart', icon: 'refresh', label: 'Restart', title: 'docker compose restart' },
  { op: 'pull', icon: 'download', label: 'Pull & up', title: 'docker compose pull, then up -d' },
  { op: 'down', icon: 'square', label: 'Down', title: 'docker compose down (stops and removes the containers)' },
] as const

// "Update stack (N)" already is pull & up, so don't offer the same thing twice
const shownActions = computed(() =>
  updatable.value.length ? actions.filter((a) => a.op !== 'pull') : actions,
)

// unsaved compose edits: guard in-app navigation and tab close
useUnsavedGuard(() => dirty.value && !notManaged.value && !saving.value, `Your edits to ${name}'s compose file have not been saved.`)

// Ctrl/Cmd+S inside the editor saves instead of opening the browser's save dialog
const modKey = ref('Ctrl')
onMounted(() => {
  if (/Mac|iPhone|iPad/.test(navigator.platform)) modKey.value = '⌘'
})
function onEditorKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (caps.value.control && dirty.value && !saving.value) save()
  }
}

const opLines = ref<string[]>([])
const opRunning = ref(false)
// refresh after every compose operation (up/down change which services have containers)
watch(
  () => opRunning.value,
  (running) => {
    if (!running) stacksStore.refresh()
  },
)
const opOk = ref<boolean | null>(null)
const opDropped = ref(false)
let es: EventSource | null = null

function attachOp(opId: string, onDone?: () => void, onDropped?: () => void) {
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
    // A dropped stream isn't a failure — the op runs server-side. Don't paint it
    // red; let the caller confirm the real outcome (delete re-checks the stack).
    if (opOk.value === null) {
      opDropped.value = true
      onDropped?.()
    }
    opRunning.value = false
    es?.close()
  }
}

async function runAction(op: string) {
  if (op === 'down' && !(await confirm({ message: `Take stack “${name}” down?`, confirmLabel: 'Down', danger: true }))) return
  if (
    op === 'update' &&
    !(await confirm({
      message: `Update “${name}” to the latest commit from its repository?`,
      detail: 'Any local edits to the stack files are overwritten.',
      confirmLabel: 'Update',
    }))
  )
    return
  if (op !== 'update' && dirty.value && !(await confirm({ message: 'You have unsaved changes — run anyway?', confirmLabel: 'Run anyway' }))) return
  opLines.value = []
  opOk.value = null
  opDropped.value = false
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
  if (!(await confirm({ message: `Remove docker network “${netName}”? No containers reference it.`, confirmLabel: 'Remove', danger: true }))) return
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
const deleting = ref(false)
const del = reactive({ volumes: false, images: false, proxyRoutes: false })

async function deleteStack() {
  if (
    del.volumes &&
    !(await confirm({
      title: `Delete “${name}” and all of its data?`,
      message: 'Every named volume of this stack is deleted with it: databases, uploads, app settings.',
      detail: 'This cannot be undone.',
      confirmLabel: 'Delete stack and data',
      danger: true,
      requireText: name,
    }))
  )
    return
  deletePanel.value = false
  opLines.value = []
  opOk.value = null
  opDropped.value = false
  opRunning.value = true
  deleting.value = true
  try {
    const { opId } = await $fetch<{ opId: string }>(`/api/stacks/${encodeURIComponent(name)}/delete`, {
      method: 'POST',
      body: { volumes: del.volumes, images: del.images, proxyRoutes: del.proxyRoutes },
    })
    // Leave for /stacks once the stack is actually gone — on a clean finish OR a
    // dropped stream (which still means the delete ran server-side). Relying only
    // on a live "done, ok" event left the page stuck here whenever the stream dropped.
    attachOp(
      opId,
      () => {
        if (opOk.value !== false) leaveWhenGone()
      },
      () => leaveWhenGone(),
    )
  } catch (e: any) {
    opLines.value.push(errMsg(e, 'could not start the delete'))
    opOk.value = false
    opRunning.value = false
    deleting.value = false
  }
}

// After the delete op ends, confirm the stack is really gone (it may still be
// finishing when a stream drops), then navigate away. If it's still there after
// a few seconds the delete failed — stay so the op log explains why.
async function leaveWhenGone() {
  for (let i = 0; i < 12; i++) {
    try {
      await $fetch(`/api/stacks/${encodeURIComponent(name)}`)
    } catch (e: any) {
      if ((e?.statusCode ?? e?.response?.status) === 404) return navigateTo('/stacks', { replace: true })
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  deleting.value = false
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
  tracked?: string[]
}
const gitInfo = ref<GitInfo | null>(null)
const stackOwner = computed(() => stacksStore.managedBy(name))
const stackOwnerUrl = computed(() => stacksStore.managedByUrl(name))
const gitTracked = useExternalSource(() => ({ git: gitInfo.value, managedBy: stackOwner.value }))
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
  loadCaps().then(() => stacksStore.refresh())
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

useHead({ title: `${name} · Stacks · homeport` })
</script>
