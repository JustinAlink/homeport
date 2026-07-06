<template>
  <div class="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-5 flex flex-wrap items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back"><Icon name="arrow-left" class="h-[18px] w-[18px]" /></NuxtLink>
      <h1 class="text-xl font-semibold text-slate-100">App catalog</h1>
      <span v-if="data" class="text-xs text-slate-600">{{ data.apps.length }} apps</span>

      <!-- sources status: compact header control, details on demand -->
      <div class="relative ml-auto">
        <button
          class="flex items-center gap-2 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
          title="Template sources"
          @click="sourcesOpen = !sourcesOpen"
        >
          <span class="h-2 w-2 rounded-full" :class="sourcesHealthy ? 'bg-accent' : 'bg-red-400'" />
          {{ data ? data.sources.length : '…' }} sources
          <Icon :name="sourcesOpen ? 'chevron-up' : 'chevron-down'" class="h-3 w-3 text-slate-600" />
        </button>
        <div
          v-if="sourcesOpen && data"
          class="absolute right-0 z-20 mt-2 w-[26rem] max-w-[90vw] rounded-lg border border-white/10 bg-ink-900 p-3 shadow-xl shadow-black/40"
        >
          <div class="mb-2 flex items-center justify-between">
            <span class="text-xs font-semibold uppercase tracking-wider text-slate-500">Template sources</span>
            <button
              class="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-40"
              :disabled="refreshing"
              @click="refresh"
            >{{ refreshing ? 'Refreshing…' : 'Refresh' }}</button>
          </div>
          <div class="space-y-1.5">
            <div
              v-for="s in data.sources"
              :key="s.url"
              class="flex items-start gap-2 rounded-md bg-ink-950/60 px-2.5 py-2 text-xs"
            >
              <span class="mt-1 h-2 w-2 shrink-0 rounded-full" :class="s.ok ? 'bg-accent' : 'bg-red-400'" />
              <div class="min-w-0">
                <div class="truncate font-mono text-slate-300" :title="s.url">{{ s.url }}</div>
                <div v-if="s.ok" class="text-slate-600">
                  {{ s.count }} apps<template v-if="s.skipped"> · {{ s.skipped }} unsupported skipped</template>
                  <span v-if="s.format" class="uppercase"> · {{ s.format }}</span>
                </div>
                <div v-else class="text-red-400/80">{{ s.error }}</div>
              </div>
            </div>
          </div>
          <NuxtLink to="/settings#catalog" class="mt-2 block text-[11px] text-accent-light hover:underline">
            Manage sources in Settings →
          </NuxtLink>
        </div>
      </div>
    </header>

    <!-- source switcher: curated/community templates vs raw Docker Hub search -->
    <div class="mb-5 flex gap-1 border-b border-white/5 text-sm">
      <button
        v-for="t in [{ k: 'templates', label: 'Templates' }, { k: 'hub', label: 'Docker Hub' }, { k: 'github', label: 'GitHub' }]"
        :key="t.k"
        class="-mb-px border-b-2 px-3 py-2"
        :class="view === t.k ? 'border-accent text-accent-light' : 'border-transparent text-slate-400 hover:text-slate-200'"
        @click="view = t.k as 'templates' | 'hub' | 'github'"
      >{{ t.label }}</button>
    </div>

    <!-- Docker Hub: search hero + popular images -->
    <template v-if="view === 'hub'">
      <div class="mb-6 rounded-2xl border border-white/10 bg-ink-900 p-5">
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative min-w-[16rem] flex-1">
            <Icon name="search" class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              v-model="hubQuery"
              placeholder="Search all of Docker Hub — try jellyfin, nextcloud, postgres…"
              class="w-full rounded-lg border border-white/10 bg-ink-950 py-2.5 pl-10 pr-9 text-sm text-slate-100 outline-none focus:border-accent/50"
              @keydown.enter="searchHub"
            />
            <button
              v-if="hubQuery"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
              aria-label="Clear search"
              @click="hubQuery = ''"
            ><Icon name="x" class="h-4 w-4" /></button>
          </div>
          <select
            v-model="hubSort"
            class="rounded-md border border-white/10 bg-ink-950 px-2 py-2.5 text-xs text-slate-300 outline-none focus:border-accent/50"
          >
            <option value="match">Sort: best match</option>
            <option value="pulls">Sort: most pulls</option>
            <option value="stars">Sort: most stars</option>
          </select>
        </div>
        <p class="mt-2 text-[11px] text-slate-500">
          Any image here installs as a compose stack — homeport reads its ports and data paths for you.
        </p>
      </div>

      <p v-if="hubError" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ hubError }}</p>
      <template v-else>
        <div class="mb-3 flex items-center gap-2 text-xs">
          <span class="font-semibold uppercase tracking-wider text-slate-500">
            {{ hubSearched ? `Results for “${hubQuery.trim()}”` : 'Most pulled on Docker Hub' }}
          </span>
          <span v-if="hubLoading" class="animate-pulse text-slate-600">searching…</span>
        </div>
        <p v-if="!hubDisplay.length && !hubSearched && !hubTopLoaded" class="animate-pulse rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-600">
          Loading popular images…
        </p>
        <p v-else-if="!hubDisplay.length && !hubSearched && hubTopError" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
          {{ hubTopError }} — searching still works.
        </p>
        <p v-else-if="!hubDisplay.length" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
          No images match “{{ hubQuery.trim() }}”.
        </p>
        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="r in hubDisplay"
            :key="r.name"
            class="flex flex-col gap-2 rounded-2xl border border-white/10 bg-ink-900 p-5"
          >
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium text-slate-100">{{ r.name }}</span>
              <span
                v-if="r.official"
                class="shrink-0 rounded-full border border-ok/40 px-1.5 py-px text-[10px] uppercase tracking-wider text-ok"
              >official</span>
            </div>
            <p class="line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-slate-500">{{ r.description || 'no description' }}</p>
            <div class="mt-auto flex items-center gap-3 pt-1 text-[11px] text-slate-500">
              <span class="inline-flex items-center gap-1" title="pulls"><Icon name="download" class="h-3 w-3" />{{ formatCount(r.pulls) }}</span>
              <span class="inline-flex items-center gap-1" title="stars"><Icon name="check" class="h-3 w-3" />{{ formatCount(r.stars) }}</span>
              <a
                :href="`https://hub.docker.com/r/${r.official ? '_/' + r.name : r.name}`"
                target="_blank"
                rel="noopener noreferrer"
                class="text-sky-300/70 hover:text-sky-300 hover:underline"
              >hub ↗</a>
              <NuxtLink
                v-if="data?.installEnabled"
                :to="`/catalog/hub/${r.name}`"
                class="ml-auto rounded-md border border-accent/30 px-2.5 py-1 text-accent-light hover:bg-accent/10"
              >Install →</NuxtLink>
            </div>
          </div>
        </div>
      </template>
      <p v-if="data && !data.installEnabled" class="mt-4 text-xs text-slate-500">
        Installing images needs the <b class="text-slate-300">Compose stacks</b> capability (Settings → Capabilities).
      </p>
    </template>

    <!-- GitHub: search hero + top self-hosted repos → git-backed stack -->
    <template v-else-if="view === 'github'">
      <div class="mb-6 rounded-2xl border border-white/10 bg-ink-900 p-5">
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative min-w-[16rem] flex-1">
            <Icon name="search" class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              v-model="ghQuery"
              placeholder="Search GitHub — try immich, paperless, uptime-kuma…"
              class="w-full rounded-lg border border-white/10 bg-ink-950 py-2.5 pl-10 pr-9 text-sm text-slate-100 outline-none focus:border-accent/50"
              @keydown.enter="searchGithub"
            />
            <button
              v-if="ghQuery"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
              aria-label="Clear search"
              @click="ghQuery = ''"
            ><Icon name="x" class="h-4 w-4" /></button>
          </div>
          <select
            v-model="ghSort"
            class="rounded-md border border-white/10 bg-ink-950 px-2 py-2.5 text-xs text-slate-300 outline-none focus:border-accent/50"
          >
            <option value="match">Sort: best match</option>
            <option value="stars">Sort: most stars</option>
          </select>
        </div>
        <p class="mt-2 text-[11px] text-slate-500">
          A repo deploys as a git-backed stack — homeport uses its compose file, or builds from a Dockerfile
          when there's none. Updates then arrive with one click when the repo moves.
        </p>
      </div>

      <p v-if="ghError" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ ghError }}</p>
      <template v-else>
        <div class="mb-3 flex items-center gap-2 text-xs">
          <span class="font-semibold uppercase tracking-wider text-slate-500">
            {{ ghSearched ? `Results for “${ghQuery.trim()}”` : 'Popular self-hosted projects' }}
          </span>
          <span v-if="ghLoading" class="animate-pulse text-slate-600">searching…</span>
        </div>
        <p v-if="!ghDisplay.length && !ghSearched && !ghTopLoaded" class="animate-pulse rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-600">
          Loading popular repositories…
        </p>
        <p v-else-if="!ghDisplay.length && !ghSearched && ghTopError" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
          {{ ghTopError }} — searching still works.
        </p>
        <p v-else-if="!ghDisplay.length" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
          No repositories match “{{ ghQuery.trim() }}”.
        </p>
        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="r in ghDisplay"
            :key="r.name"
            class="flex flex-col gap-2 rounded-2xl border border-white/10 bg-ink-900 p-5"
          >
            <div class="flex items-center gap-2">
              <Icon name="git-branch" class="h-4 w-4 shrink-0 text-slate-500" />
              <span class="truncate text-sm font-medium text-slate-100">{{ r.name }}</span>
            </div>
            <p class="line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-slate-500">{{ r.description || 'no description' }}</p>
            <div class="mt-auto flex items-center gap-3 pt-1 text-[11px] text-slate-500">
              <span class="inline-flex items-center gap-1" title="stars"><Icon name="check" class="h-3 w-3" />{{ formatCount(r.stars) }}</span>
              <a :href="r.url" target="_blank" rel="noopener noreferrer" class="text-sky-300/70 hover:text-sky-300 hover:underline">github ↗</a>
              <NuxtLink
                v-if="data?.installEnabled"
                :to="`/stacks?git=${encodeURIComponent(r.cloneUrl)}&name=${hubStackName(r.name)}`"
                class="ml-auto rounded-md border border-accent/30 px-2.5 py-1 text-accent-light hover:bg-accent/10"
              >Deploy stack →</NuxtLink>
            </div>
          </div>
        </div>
      </template>
      <p v-if="data && !data.installEnabled" class="mt-4 text-xs text-slate-500">
        Deploying repositories needs the <b class="text-slate-300">Compose stacks</b> capability (Settings → Capabilities).
      </p>
    </template>

    <div v-else-if="error" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ error }}</div>

    <!-- skeleton grid while loading -->
    <div v-else-if="!data" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="i in 9" :key="i" class="flex animate-pulse gap-3.5 rounded-2xl border border-white/10 bg-ink-900 p-5">
        <div class="h-10 w-10 shrink-0 rounded-md bg-white/5" />
        <div class="min-w-0 flex-1 space-y-2 py-0.5">
          <div class="h-3.5 w-2/5 rounded bg-white/5" />
          <div class="h-3 w-4/5 rounded bg-white/5" />
        </div>
      </div>
    </div>

    <template v-else>
      <p v-if="!data.installEnabled" class="mb-4 rounded-lg border border-white/5 bg-ink-900 px-4 py-3 text-xs text-slate-500">
        Browsing only — installing apps needs the <b class="text-slate-300">Compose stacks</b> capability
        (Settings → Capabilities), since an installed app becomes a normal stack.
      </p>

      <!-- search + sort + category filter -->
      <div class="mb-5 flex flex-wrap items-center gap-2">
        <input
          v-model="query"
          placeholder="Search apps…"
          class="w-56 rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
        />
        <select
          v-model="sort"
          class="rounded-md border border-white/10 bg-ink-950 px-2 py-2 text-xs text-slate-300 outline-none focus:border-accent/50"
          title="Sort order"
        >
          <option value="default">Sort: source order</option>
          <option value="name">Sort: name A–Z</option>
        </select>
        <button
          v-for="c in visibleCategories"
          :key="c.name"
          class="rounded-full border px-2.5 py-1 text-[11px]"
          :class="c.name === category ? 'border-accent/50 bg-accent/10 text-accent-light' : 'border-white/10 text-slate-400 hover:bg-white/5'"
          @click="category = category === c.name ? '' : c.name"
        >{{ c.name }} <span class="text-slate-600">{{ c.count }}</span></button>
        <button
          v-if="categories.length > CATEGORY_LIMIT"
          class="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-white/5"
          @click="allCategories = !allCategories"
        >{{ allCategories ? 'show less' : `+${categories.length - CATEGORY_LIMIT} more` }}</button>
      </div>

      <p v-if="!filtered.length" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
        No apps match<template v-if="query"> “{{ query }}”</template>.
      </p>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="app in paged"
          :key="`${app.source}:${app.slug}`"
          :to="`/catalog/${app.slug}`"
          class="group flex gap-3.5 rounded-2xl border border-white/10 bg-ink-900 p-5 transition-all hover:-translate-y-px hover:border-accent/30 hover:shadow-lg hover:shadow-black/10"
        >
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ink-950/70">
            <ServiceIcon :name="app.name" :icon="app.icon" :size="30" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium text-slate-100 group-hover:text-white">{{ app.name }}</span>
              <span
                v-if="app.categories[0]"
                class="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-slate-600"
              >{{ app.categories[0] }}</span>
            </div>
            <p class="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{{ app.description || app.image }}</p>
            <div v-if="app.source !== 'built-in'" class="mt-1.5 truncate text-[10px] text-sky-300/50" :title="app.source">
              {{ sourceHost(app.source) }}
            </div>
          </div>
        </NuxtLink>
      </div>

      <!-- pagination -->
      <div v-if="pageCount > 1" class="mt-6 flex items-center justify-center gap-1.5 text-xs">
        <button
          class="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-slate-300 hover:bg-white/5 disabled:opacity-30"
          :disabled="page === 1"
          @click="go(page - 1)"
        ><Icon name="chevron-left" class="h-3 w-3" /> Prev</button>
        <button
          v-for="p in pageNumbers"
          :key="p.key"
          class="min-w-[2rem] rounded-md border px-2 py-1.5"
          :class="p.n === page ? 'border-accent/50 bg-accent/10 text-accent-light' : p.n ? 'border-white/10 text-slate-400 hover:bg-white/5' : 'cursor-default border-transparent text-slate-600'"
          :disabled="!p.n"
          @click="p.n && go(p.n)"
        >{{ p.n || '…' }}</button>
        <button
          class="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-slate-300 hover:bg-white/5 disabled:opacity-30"
          :disabled="page === pageCount"
          @click="go(page + 1)"
        >Next <Icon name="chevron-right" class="h-3 w-3" /></button>
        <span class="ml-3 text-slate-600">{{ filtered.length }} apps</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
interface CatalogAppRow {
  slug: string
  name: string
  description: string
  categories: string[]
  icon: string
  image: string
  source: string
}
interface CatalogResponse {
  apps: CatalogAppRow[]
  sources: { url: string; ok: boolean; count: number; skipped: number; format?: string; error?: string }[]
  installEnabled: boolean
}

const PAGE_SIZE = 24

const data = ref<CatalogResponse | null>(null)
const error = ref('')
const refreshing = ref(false)
const sourcesOpen = ref(false)

// filters live in the URL (?q&cat&sort&page) so links/back-button/refresh keep them
const route = useRoute()
const router = useRouter()
const query = ref(String(route.query.q ?? ''))
const category = ref(String(route.query.cat ?? ''))
const sort = ref(String(route.query.sort ?? '') === 'name' ? 'name' : 'default')
const page = ref(Math.max(1, Number.parseInt(String(route.query.page ?? '1'), 10) || 1))

const TAB_KEYS = ['templates', 'hub', 'github'] as const
type TabKey = (typeof TAB_KEYS)[number]
const initialTab = String(route.query.tab ?? '')
const view = ref<TabKey>((TAB_KEYS as readonly string[]).includes(initialTab) ? (initialTab as TabKey) : 'templates')

watch([query, category, sort, page, view], () => {
  const q: Record<string, string> = {}
  if (view.value !== 'templates') q.tab = view.value
  if (query.value.trim()) q.q = query.value.trim()
  if (category.value) q.cat = category.value
  if (sort.value !== 'default') q.sort = sort.value
  if (page.value > 1) q.page = String(page.value)
  router.replace({ query: q })
})

// --- Docker Hub: popular list + search ---
interface HubResult { name: string; description: string; stars: number; pulls: number; official: boolean }
const hubQuery = ref('')
const hubResults = ref<HubResult[]>([])
const hubTop = ref<HubResult[]>([])
const hubTopLoaded = ref(false)
const hubTopError = ref('')
const hubSort = ref<'match' | 'pulls' | 'stars'>('match')
const hubLoading = ref(false)
const hubSearched = ref(false)
const hubError = ref('')

async function loadHubTop() {
  if (hubTopLoaded.value) return
  try {
    const r = await $fetch<{ results: HubResult[] }>('/api/hub/top')
    hubTop.value = r.results
  } catch (e: any) {
    hubTopError.value = errMsg(e, 'Could not load popular images')
  } finally {
    hubTopLoaded.value = true
  }
}

async function searchHub() {
  const q = hubQuery.value.trim()
  if (!q) {
    hubSearched.value = false
    hubResults.value = []
    return
  }
  hubLoading.value = true
  hubError.value = ''
  try {
    const r = await $fetch<{ results: HubResult[] }>('/api/hub/search', { query: { q } })
    hubResults.value = r.results
    hubSearched.value = true
  } catch (e: any) {
    hubError.value = errMsg(e, 'Docker Hub search failed')
  } finally {
    hubLoading.value = false
  }
}

// debounced search-as-you-type; clearing the box returns to the popular list
let hubTimer: ReturnType<typeof setTimeout> | null = null
watch(hubQuery, () => {
  if (hubTimer) clearTimeout(hubTimer)
  hubError.value = ''
  if (!hubQuery.value.trim()) {
    hubSearched.value = false
    hubResults.value = []
    return
  }
  hubTimer = setTimeout(searchHub, 450)
})

function sortHub(list: HubResult[]): HubResult[] {
  const out = [...list]
  if (hubSort.value === 'pulls') out.sort((a, b) => b.pulls - a.pulls)
  else if (hubSort.value === 'stars') out.sort((a, b) => b.stars - a.stars)
  return out
}
const hubDisplay = computed(() => sortHub(hubSearched.value ? hubResults.value : hubTop.value))

function formatCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

// --- GitHub: popular list + search ---
interface GhResult { name: string; description: string; stars: number; url: string; cloneUrl: string }
const ghQuery = ref('')
const ghResults = ref<GhResult[]>([])
const ghTop = ref<GhResult[]>([])
const ghTopLoaded = ref(false)
const ghTopError = ref('')
const ghSort = ref<'match' | 'stars'>('match')
const ghLoading = ref(false)
const ghSearched = ref(false)
const ghError = ref('')

async function loadGhTop() {
  if (ghTopLoaded.value) return
  try {
    const r = await $fetch<{ results: GhResult[] }>('/api/github/top')
    ghTop.value = r.results
  } catch (e: any) {
    ghTopError.value = errMsg(e, 'Could not load popular repositories')
  } finally {
    ghTopLoaded.value = true
  }
}

async function searchGithub() {
  const q = ghQuery.value.trim()
  if (!q) {
    ghSearched.value = false
    ghResults.value = []
    return
  }
  ghLoading.value = true
  ghError.value = ''
  try {
    const r = await $fetch<{ results: GhResult[] }>('/api/github/search', { query: { q, sort: ghSort.value } })
    ghResults.value = r.results
    ghSearched.value = true
  } catch (e: any) {
    ghError.value = errMsg(e, 'GitHub search failed')
  } finally {
    ghLoading.value = false
  }
}

// debounced search-as-you-type; clearing returns to the popular list
let ghTimer: ReturnType<typeof setTimeout> | null = null
watch(ghQuery, () => {
  if (ghTimer) clearTimeout(ghTimer)
  ghError.value = ''
  if (!ghQuery.value.trim()) {
    ghSearched.value = false
    ghResults.value = []
    return
  }
  ghTimer = setTimeout(searchGithub, 500)
})
// the sort lives server-side (different result set) — re-run an active search on change
watch(ghSort, () => {
  if (ghSearched.value) searchGithub()
})

const ghDisplay = computed(() => (ghSearched.value ? ghResults.value : ghTop.value))

/** "linuxserver/jellyfin" → a valid stack/dir name suggestion ("jellyfin"). */
function hubStackName(repo: string): string {
  const last = repo.split('/').pop() || repo
  return last.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'app'
}

async function load(refresh = false) {
  try {
    data.value = await $fetch<CatalogResponse>('/api/catalog', { query: refresh ? { refresh: 1 } : {} })
    error.value = ''
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
    error.value = errMsg(e, 'Could not load the catalog')
  }
}

async function refresh() {
  refreshing.value = true
  await load(true)
  refreshing.value = false
}

const sourcesHealthy = computed(() => (data.value?.sources ?? []).every((s) => s.ok))
const sourceHost = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// categories ranked by app count; the long tail hides behind "+N more"
const CATEGORY_LIMIT = 8
const allCategories = ref(false)
const categories = computed(() => {
  const counts = new Map<string, number>()
  for (const a of data.value?.apps ?? []) for (const c of a.categories) counts.set(c, (counts.get(c) ?? 0) + 1)
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
})
const visibleCategories = computed(() => {
  const list = allCategories.value ? categories.value : categories.value.slice(0, CATEGORY_LIMIT)
  // keep the active category visible even when it lives in the hidden tail
  if (category.value && !list.some((c) => c.name === category.value)) {
    const active = categories.value.find((c) => c.name === category.value)
    if (active) return [...list, active]
  }
  return list
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return (data.value?.apps ?? []).filter((a) => {
    if (category.value && !a.categories.includes(category.value)) return false
    if (!q) return true
    return `${a.name} ${a.description} ${a.image}`.toLowerCase().includes(q)
  })
})

const sorted = computed(() =>
  sort.value === 'name' ? [...filtered.value].sort((a, b) => a.name.localeCompare(b.name)) : filtered.value,
)

// pagination — reset to page 1 whenever the filter changes; clamp when it shrinks
watch([query, category, sort], () => (page.value = 1))
const pageCount = computed(() => Math.max(1, Math.ceil(sorted.value.length / PAGE_SIZE)))
watch(pageCount, (n) => {
  if (page.value > n) page.value = n
})
const paged = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

function go(p: number) {
  page.value = Math.min(Math.max(1, p), pageCount.value)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/** Compact page list: 1 … around-current … last (nulls render as ellipses). */
const pageNumbers = computed(() => {
  const total = pageCount.value
  const cur = page.value
  const nums: (number | null)[] = []
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - cur) <= 1) nums.push(n)
    else if (nums[nums.length - 1] !== null) nums.push(null)
  }
  return nums.map((n, i) => ({ n, key: n ?? `gap-${i}` }))
})

// lazy-load a tab's popular list the first time it's shown
watch(
  view,
  (v) => {
    if (v === 'hub') loadHubTop()
    else if (v === 'github') loadGhTop()
  },
  { immediate: true },
)

onMounted(() => load())
useHead({ title: 'App catalog — homeport' })
</script>
