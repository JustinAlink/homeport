<template>
  <div class="page">
    <PageHeader title="Stacks">
      <template #subtitle>
        Compose projects homeport manages: folders with a compose file in
        <code>{{ data?.dir || '/stacks' }}</code><template v-if="data?.roots?.length"> or a compose root
          (<code>{{ data.roots.join(', ') }}</code>)</template>, plus running projects whose files homeport can see.
        Apps installed from the <NuxtLink to="/catalog" class="link">catalog</NuxtLink> land here too.
      </template>
      <template #actions>
        <NuxtLink to="/catalog" class="btn"><Icon name="catalog" /> Install an app</NuxtLink>
        <button class="btn btn-primary" @click="creating = !creating"><Icon name="plus" /> New stack</button>
      </template>
    </PageHeader>

    <div v-if="error" class="callout callout-warn mb-4"><Icon name="alert" /><span>{{ error }}</span></div>
    <div v-else-if="!data" class="space-y-2"><div v-for="i in 4" :key="i" class="card h-[72px]" /></div>

    <template v-else>
      <!-- create panel -->
      <div v-if="creating" class="card mb-5">
        <div class="card-header">
          <span class="card-title">New stack</span>
          <div class="segmented segmented-sm">
            <button :aria-pressed="createMode === 'empty'" @click="createMode = 'empty'">Empty</button>
            <button :aria-pressed="createMode === 'git'" @click="createMode = 'git'"><Icon name="git-branch" class="h-3 w-3" /> From git</button>
          </div>
          <button class="btn btn-ghost btn-icon btn-sm ml-auto" aria-label="Cancel" @click="creating = false"><Icon name="x" /></button>
        </div>

        <form v-if="createMode === 'empty'" class="flex flex-wrap items-end gap-3 p-4 sm:p-5" @submit.prevent="createStack">
          <div class="min-w-[220px] flex-1">
            <label class="field-label" for="new-stack">Name</label>
            <input id="new-stack" v-model="newName" class="input" placeholder="e.g. media" spellcheck="false" autofocus />
            <p class="field-hint">Becomes the directory and the compose project name. You write the compose file next.</p>
          </div>
          <button type="submit" class="btn btn-primary mb-[26px]" :disabled="!newName.trim()">Create</button>
        </form>

        <form v-else class="space-y-3 p-4 sm:p-5" @submit.prevent="createFromGit">
          <div class="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div>
              <label class="field-label" for="git-repo">Repository URL</label>
              <input id="git-repo" v-model="git.repo" class="input" placeholder="https://github.com/user/repo" spellcheck="false" />
              <p class="field-hint">Needs a compose file at its root.</p>
            </div>
            <div>
              <label class="field-label" for="git-ref">Branch</label>
              <input id="git-ref" v-model="git.ref" class="input" placeholder="main" spellcheck="false" />
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="field-label" for="git-name">Stack name <span class="font-normal text-slate-500">(optional)</span></label>
              <input id="git-name" v-model="git.name" class="input" :placeholder="gitNameHint || 'from the repo name'" spellcheck="false" />
            </div>
            <div>
              <label class="field-label" for="git-token">Access token <span class="font-normal text-slate-500">(private repos)</span></label>
              <input id="git-token" v-model="git.token" type="password" class="input" placeholder="stored server-side only" autocomplete="off" />
            </div>
          </div>
          <div class="flex items-center gap-3">
            <button type="submit" class="btn btn-primary" :disabled="!git.repo.trim() || gitCreating">{{ gitCreating ? 'Cloning…' : 'Clone & deploy' }}</button>
            <p v-if="gitError" class="whitespace-pre-line text-xs text-red-400">{{ gitError }}</p>
          </div>
        </form>
      </div>

      <div v-if="!data.stacks.length" class="card">
        <EmptyState icon="stacks" title="No stacks yet">
          Mount your compose directory at <code>{{ data.dir }}</code> (e.g. <code>/opt/stacks:/stacks</code>), create one
          here, or install an app from the catalog.
          <template #actions>
            <button class="btn btn-primary btn-sm" @click="creating = true"><Icon name="plus" /> New stack</button>
            <NuxtLink to="/catalog" class="btn btn-sm">Browse the catalog</NuxtLink>
          </template>
        </EmptyState>
      </div>

      <div v-else class="card row-list overflow-hidden">
        <NuxtLink
          v-for="s in data.stacks"
          :key="s.name"
          :to="`/stacks/${encodeURIComponent(s.name)}`"
          class="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-white/[0.025] sm:px-5"
        >
          <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-slate-400 ring-1 ring-inset ring-white/[0.06]">
            <Icon name="stacks" class="h-[18px] w-[18px]" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="truncate text-[14.5px] font-semibold text-slate-100 group-hover:text-accent-light">{{ s.name }}</span>
              <span v-if="s.git" class="badge badge-info" title="Git-backed stack"><Icon name="git-branch" class="h-3 w-3" />git</span>
              <span v-if="s.source && s.source !== 'stacks'" class="badge" :title="`Managed in place at ${s.dir}`">external</span>
              <span
                v-if="stackUpdates(s.name)"
                class="badge badge-accent"
                :title="`${stackUpdates(s.name)} service${stackUpdates(s.name) > 1 ? 's have' : ' has'} a newer image`"
              ><Icon name="arrow-up" class="h-3 w-3" />{{ stackUpdates(s.name) }} update{{ stackUpdates(s.name) > 1 ? 's' : '' }}</span>
            </div>
            <p class="mt-0.5 truncate text-xs text-slate-500">
              <template v-if="stackServices(s.name).length">{{ stackServices(s.name).join(' · ') }}</template>
              <template v-else>no running containers</template>
              <span class="font-mono text-slate-600"> · {{ s.file }}</span>
            </p>
          </div>
          <div v-if="stackTotals(s.name)" class="hidden w-40 shrink-0 justify-end gap-3 font-mono text-[11.5px] tabular-nums text-slate-500 md:flex">
            <span><span class="text-slate-600">CPU</span> {{ stackTotals(s.name)!.cpu }}%</span>
            <span><span class="text-slate-600">RAM</span> {{ formatBytes(stackTotals(s.name)!.mem) }}</span>
          </div>
          <div class="flex w-28 shrink-0 flex-col items-end gap-1">
            <span class="inline-flex items-center gap-1.5 text-xs font-medium" :class="stateText(s.state)">
              <span class="dot" :class="dotCls(s.state)" />{{ stateLabel(s.state) }}
            </span>
            <span class="text-[11.5px] tabular-nums text-slate-500">{{ s.running }}/{{ s.total }} running</span>
          </div>
          <Icon name="chevron-right" class="hidden h-4 w-4 shrink-0 text-slate-600 group-hover:text-slate-300 sm:block" />
        </NuxtLink>
      </div>

      <section v-if="data.unmanaged.length" class="mt-9">
        <h2 class="section-title">Unmanaged compose projects</h2>
        <p class="mb-3 mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
          Running compose projects whose files homeport can't see. You can view and control their containers, but not edit or
          compose-operate them. To manage one fully, mount its folder into the homeport container at the
          <strong class="text-slate-400">same path it has on the host</strong> (shown below) and it's adopted automatically. A parent
          folder of several projects can be added once under Settings → Capabilities → Compose roots.
        </p>
        <div class="card row-list overflow-hidden">
          <NuxtLink
            v-for="u in data.unmanaged"
            :key="u.name"
            :to="`/stacks/${encodeURIComponent(u.name)}`"
            class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.025] sm:px-5"
          >
            <span class="text-[13.5px] text-slate-200">{{ u.name }}</span>
            <span v-if="u.workingDir" class="truncate font-mono text-[11px] text-slate-500" :title="`compose files live at ${u.workingDir} on the host; mount it at this exact path to manage the project here`">{{ u.workingDir }}</span>
            <span class="ml-auto shrink-0 text-xs tabular-nums text-slate-500">{{ u.running }}/{{ u.total }} running</span>
          </NuxtLink>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
interface StackRow {
  name: string
  state: 'running' | 'partial' | 'stopped'
  running: number
  total: number
  file?: string
  git?: boolean
  source?: 'stacks' | 'root' | 'adopted'
  dir?: string
}
interface StacksResponse {
  stacks: StackRow[]
  unmanaged: { name: string; running: number; total: number; workingDir?: string | null }[]
  dir: string
  roots?: string[]
}

const data = ref<StacksResponse | null>(null)

// enrich rows with what actually runs inside each stack (compose project)
const { data: svcData, start: svcStart, stop: svcStop } = useServices()
const { stats, start: statsStart, stop: statsStop } = useStats()
const updates = useUpdates()
function stackServices(name: string): string[] {
  return (svcData.value?.services ?? []).filter((s) => s.project === name).map((s) => s.displayName)
}
// how many of a stack's services have a newer image waiting
function stackUpdates(name: string): number {
  return (svcData.value?.services ?? []).filter((s) => s.project === name && updates.entryFor(s)?.status === 'update').length
}
function stackTotals(name: string): { cpu: number; mem: number } | null {
  const ids = (svcData.value?.services ?? []).filter((s) => s.project === name && s.state === 'running').map((s) => s.id)
  if (!ids.length) return null
  let cpu = 0
  let mem = 0
  for (const id of ids) {
    const st = stats.value[id]
    if (!st) continue
    cpu += st.cpuPercent ?? 0
    mem += st.memBytes
  }
  return { cpu: Math.round(cpu * 10) / 10, mem }
}
const error = ref('')
const creating = ref(false)
const newName = ref('')

async function load() {
  try {
    data.value = await $fetch<StacksResponse>('/api/stacks')
    error.value = ''
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
    error.value = errMsg(e, 'Could not load stacks')
  }
}

function createStack() {
  const name = newName.value.trim()
  if (!name) return
  navigateTo(`/stacks/${encodeURIComponent(name)}?new=1`)
}

// --- create from git ---
const createMode = ref<'empty' | 'git'>('empty')
const git = reactive({ repo: '', ref: '', name: '', token: '' })
const gitCreating = ref(false)
const gitError = ref('')
const gitNameHint = computed(() => git.repo.split('/').pop()?.replace(/\.git$/, '') ?? '')

async function createFromGit() {
  gitCreating.value = true
  gitError.value = ''
  try {
    const res = await $fetch<{ stack: string; opId: string }>('/api/stacks/from-git', {
      method: 'POST',
      body: {
        repo: git.repo.trim(),
        ref: git.ref.trim() || 'main',
        name: git.name.trim() || undefined,
        token: git.token.trim() || undefined,
      },
    })
    navigateTo(`/stacks/${encodeURIComponent(res.stack)}?op=${encodeURIComponent(res.opId)}`)
  } catch (e: any) {
    gitError.value = errMsg(e, 'Could not create the stack')
  } finally {
    gitCreating.value = false
  }
}

const dotCls = (s: string) => (s === 'running' ? 'bg-ok' : s === 'partial' ? 'bg-amber-400' : 'bg-slate-500')
const stateText = (s: string) => (s === 'running' ? 'text-ok' : s === 'partial' ? 'text-amber-300' : 'text-slate-400')
const stateLabel = (s: string) => (s === 'running' ? 'Running' : s === 'partial' ? 'Partly up' : 'Stopped')

let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  // arriving from the catalog's GitHub tab — open the from-git form prefilled
  const q = useRoute().query
  if (q.new) creating.value = true // "New stack" from the command palette
  if (q.git) {
    creating.value = true
    createMode.value = 'git'
    git.repo = String(q.git)
    git.name = String(q.name || '')
  }
  load()
  svcStart()
  statsStart()
  updates.refresh()
  poll = setInterval(load, 10_000)
})
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  svcStop()
  statsStop()
})

useHead({ title: 'Stacks · homeport' })
</script>
