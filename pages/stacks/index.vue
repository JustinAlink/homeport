<template>
  <div class="mx-auto max-w-[1300px] px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-6 flex items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back"><Icon name="arrow-left" class="h-[18px] w-[18px]" /></NuxtLink>
      <div>
        <h1 class="text-xl font-semibold text-slate-100">Stacks</h1>
        <p class="mt-1 text-[13px] text-slate-500">
          Compose projects homeport manages — each is a folder with a compose file in
          <code class="text-slate-400">{{ data?.dir || '/stacks' }}</code>. Deploy, edit, or update them from git;
          catalog installs land here too.
        </p>
      </div>
      <button
        class="ml-auto rounded-md border border-accent/30 px-3 py-1.5 text-xs text-accent-light hover:bg-accent/10"
        @click="creating = true"
      >+ New stack</button>
    </header>

    <div v-if="error" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
      {{ error }}
    </div>
    <div v-else-if="!data" class="py-20 text-center text-slate-500">Loading…</div>

    <template v-else>
      <!-- create row -->
      <div v-if="creating" class="mb-4 space-y-3 rounded-lg border border-white/10 bg-ink-900 p-3">
        <div class="flex gap-1 text-xs">
          <button
            class="rounded-md px-2.5 py-1.5"
            :class="createMode === 'empty' ? 'bg-accent/15 text-accent-light' : 'text-slate-400 hover:bg-white/5'"
            @click="createMode = 'empty'"
          >Empty stack</button>
          <button
            class="rounded-md px-2.5 py-1.5"
            :class="createMode === 'git' ? 'bg-accent/15 text-accent-light' : 'text-slate-400 hover:bg-white/5'"
            @click="createMode = 'git'"
          >From git repository</button>
          <button class="ml-auto rounded-md border border-white/10 px-3 py-1.5 text-slate-400 hover:bg-white/5" @click="creating = false">Cancel</button>
        </div>

        <div v-if="createMode === 'empty'" class="flex items-center gap-2">
          <input
            v-model="newName"
            placeholder="stack name (becomes the directory + project name)"
            class="flex-1 rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
            @keydown.enter="createStack"
          />
          <button class="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-accent-light" @click="createStack">Create</button>
        </div>

        <div v-else class="space-y-2">
          <div class="flex flex-wrap gap-2">
            <input
              v-model="git.repo"
              placeholder="https://github.com/user/repo (needs a compose file at its root)"
              class="min-w-[16rem] flex-1 rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
            />
            <input
              v-model="git.ref"
              placeholder="branch (main)"
              class="w-36 rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
            />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <input
              v-model="git.name"
              :placeholder="`stack name (${gitNameHint || 'from the repo'})`"
              class="w-52 rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
            />
            <input
              v-model="git.token"
              type="password"
              placeholder="access token (private repos — stored server-side only)"
              class="min-w-[16rem] flex-1 rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
            />
            <button
              class="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-40"
              :disabled="!git.repo.trim() || gitCreating"
              @click="createFromGit"
            >{{ gitCreating ? 'Cloning…' : 'Clone & deploy' }}</button>
          </div>
          <p v-if="gitError" class="whitespace-pre-line text-[11px] text-red-400">{{ gitError }}</p>
        </div>
      </div>

      <p v-if="!data.stacks.length" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
        No stacks found in <code class="text-slate-400">{{ data.dir }}</code> — mount your compose directory there
        (e.g. <code class="text-slate-400">/opt/stacks:/stacks</code>), or create one with “New stack”.
      </p>

      <div class="space-y-2">
        <NuxtLink
          v-for="s in data.stacks"
          :key="s.name"
          :to="`/stacks/${s.name}`"
          class="flex items-center gap-4 rounded-xl border border-white/5 bg-ink-900 px-5 py-4 transition-colors hover:border-accent/30"
        >
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="dotCls(s.state)" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-[15px] font-medium text-slate-100">{{ s.name }}</span>
              <span
                v-if="s.git"
                class="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-400/30 px-1.5 py-px text-[9px] uppercase tracking-wider text-sky-300"
                title="Git-backed stack"
              ><Icon name="git-branch" class="h-2.5 w-2.5" />git</span>
              <span class="shrink-0 font-mono text-[11px] text-slate-600">{{ s.file }}</span>
            </div>
            <p class="mt-1 truncate text-xs text-slate-500">
              <template v-if="stackServices(s.name).length">{{ stackServices(s.name).join(' · ') }}</template>
              <template v-else>no running containers</template>
            </p>
          </div>
          <div v-if="stackTotals(s.name)" class="hidden shrink-0 text-right font-mono text-[11px] leading-5 text-slate-500 sm:block">
            <div>CPU {{ stackTotals(s.name)!.cpu }}%</div>
            <div>RAM {{ formatBytes(stackTotals(s.name)!.mem) }}</div>
          </div>
          <div class="shrink-0 text-right">
            <span class="block text-xs text-slate-500">{{ s.running }}/{{ s.total }} running</span>
            <span class="mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider" :class="pillCls(s.state)">{{ s.state }}</span>
          </div>
        </NuxtLink>
      </div>

      <template v-if="data.unmanaged.length">
        <h2 class="mb-2 mt-8 text-sm font-semibold uppercase tracking-wider text-slate-500">Unmanaged compose projects</h2>
        <p class="mb-2 text-xs text-slate-600">Running compose projects without a directory in {{ data.dir }} — their compose files aren't editable here, but you can still view and control their containers.</p>
        <div class="space-y-1.5">
          <NuxtLink
            v-for="u in data.unmanaged"
            :key="u.name"
            :to="`/stacks/${encodeURIComponent(u.name)}`"
            class="flex items-center gap-3 rounded-md border border-white/5 bg-ink-900/60 px-4 py-2 transition-colors hover:border-accent/30"
          >
            <span class="text-sm text-slate-300">{{ u.name }}</span>
            <span class="ml-auto text-xs text-slate-600">{{ u.running }}/{{ u.total }} running</span>
          </NuxtLink>
        </div>
      </template>
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
}
interface StacksResponse {
  stacks: StackRow[]
  unmanaged: { name: string; running: number; total: number }[]
  dir: string
}

const data = ref<StacksResponse | null>(null)

// enrich rows with what actually runs inside each stack (compose project)
const { data: svcData, start: svcStart, stop: svcStop } = useServices()
const { stats, start: statsStart, stop: statsStop } = useStats()
function stackServices(name: string): string[] {
  return (svcData.value?.services ?? []).filter((s) => s.project === name).map((s) => s.displayName)
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

const dotCls = (s: string) => (s === 'running' ? 'bg-ok' : s === 'partial' ? 'bg-amber-400' : 'bg-slate-600')
const pillCls = (s: string) =>
  s === 'running'
    ? 'border-ok/40 text-ok'
    : s === 'partial'
      ? 'border-amber-400/40 text-amber-300'
      : 'border-white/10 text-slate-500'

let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  load()
  svcStart()
  statsStart()
  poll = setInterval(load, 10_000)
})
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  svcStop()
  statsStop()
})

useHead({ title: 'Stacks — homeport' })
</script>
