<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6">
    <header class="mb-6 flex items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back">←</NuxtLink>
      <div class="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent">⚓</div>
      <h1 class="text-xl font-semibold text-slate-100">Stacks</h1>
      <span v-if="data" class="font-mono text-xs text-slate-600">{{ data.dir }}</span>
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
      <div v-if="creating" class="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 p-3">
        <input
          v-model="newName"
          placeholder="stack name (becomes the directory + project name)"
          class="flex-1 rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
          @keydown.enter="createStack"
        />
        <button class="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-accent-light" @click="createStack">Create</button>
        <button class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-400 hover:bg-white/5" @click="creating = false">Cancel</button>
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
          class="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-900 px-4 py-3 transition-colors hover:border-accent/30"
        >
          <span class="h-2 w-2 shrink-0 rounded-full" :class="dotCls(s.state)" />
          <span class="text-sm font-medium text-slate-100">{{ s.name }}</span>
          <span class="font-mono text-[11px] text-slate-600">{{ s.file }}</span>
          <span class="ml-auto text-xs text-slate-500">{{ s.running }}/{{ s.total }} running</span>
          <span class="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider" :class="pillCls(s.state)">{{ s.state }}</span>
        </NuxtLink>
      </div>

      <template v-if="data.unmanaged.length">
        <h2 class="mb-2 mt-8 text-sm font-semibold uppercase tracking-wider text-slate-500">Unmanaged compose projects</h2>
        <p class="mb-2 text-xs text-slate-600">Running compose projects without a directory in {{ data.dir }} — visible, but not editable here.</p>
        <div class="space-y-1.5">
          <div v-for="u in data.unmanaged" :key="u.name" class="flex items-center gap-3 rounded-md border border-white/5 bg-ink-900/60 px-4 py-2">
            <span class="text-sm text-slate-300">{{ u.name }}</span>
            <span class="ml-auto text-xs text-slate-600">{{ u.running }}/{{ u.total }} running</span>
          </div>
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
}
interface StacksResponse {
  stacks: StackRow[]
  unmanaged: { name: string; running: number; total: number }[]
  dir: string
}

const data = ref<StacksResponse | null>(null)
const error = ref('')
const creating = ref(false)
const newName = ref('')

async function load() {
  try {
    data.value = await $fetch<StacksResponse>('/api/stacks')
    error.value = ''
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
    error.value = e?.statusMessage || e?.message || 'Could not load stacks'
  }
}

function createStack() {
  const name = newName.value.trim()
  if (!name) return
  navigateTo(`/stacks/${encodeURIComponent(name)}?new=1`)
}

const dotCls = (s: string) => (s === 'running' ? 'bg-accent' : s === 'partial' ? 'bg-amber-400' : 'bg-slate-600')
const pillCls = (s: string) =>
  s === 'running'
    ? 'border-accent/40 text-accent-light'
    : s === 'partial'
      ? 'border-amber-400/40 text-amber-300'
      : 'border-white/10 text-slate-500'

let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  load()
  poll = setInterval(load, 10_000)
})
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
})

useHead({ title: 'Stacks — homeport' })
</script>
