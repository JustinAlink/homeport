<template>
  <div class="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10">
    <header class="mb-5 flex flex-wrap items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back">←</NuxtLink>
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
          <span class="text-slate-600">{{ sourcesOpen ? '▴' : '▾' }}</span>
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
            >{{ refreshing ? 'Refreshing…' : '↻ Refresh' }}</button>
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

    <div v-if="error" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ error }}</div>

    <!-- skeleton grid while loading -->
    <div v-else-if="!data" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="i in 9" :key="i" class="flex animate-pulse gap-3 rounded-lg border border-white/5 bg-ink-900 p-4">
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

      <!-- search + category filter -->
      <div class="mb-5 flex flex-wrap items-center gap-2">
        <input
          v-model="query"
          placeholder="Search apps…"
          class="w-56 rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
        />
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
        >{{ allCategories ? 'less ▴' : `+${categories.length - CATEGORY_LIMIT} more ▾` }}</button>
      </div>

      <p v-if="!filtered.length" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
        No apps match<template v-if="query"> “{{ query }}”</template>.
      </p>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="app in paged"
          :key="`${app.source}:${app.slug}`"
          :to="`/catalog/${app.slug}`"
          class="group flex gap-3 rounded-lg border border-white/5 bg-ink-900 p-4 transition-all hover:-translate-y-px hover:border-accent/30 hover:shadow-lg hover:shadow-black/20"
        >
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ink-950/70">
            <ServiceIcon :name="app.name" :icon="app.icon" :size="30" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium text-slate-100 group-hover:text-white">{{ app.name }}</span>
              <span
                v-if="app.categories[0]"
                class="ml-auto shrink-0 rounded-full border border-white/10 px-1.5 py-px text-[9px] uppercase tracking-wider text-slate-500"
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
          class="rounded-md border border-white/10 px-2.5 py-1.5 text-slate-300 hover:bg-white/5 disabled:opacity-30"
          :disabled="page === 1"
          @click="go(page - 1)"
        >‹ Prev</button>
        <button
          v-for="p in pageNumbers"
          :key="p.key"
          class="min-w-[2rem] rounded-md border px-2 py-1.5"
          :class="p.n === page ? 'border-accent/50 bg-accent/10 text-accent-light' : p.n ? 'border-white/10 text-slate-400 hover:bg-white/5' : 'cursor-default border-transparent text-slate-600'"
          :disabled="!p.n"
          @click="p.n && go(p.n)"
        >{{ p.n || '…' }}</button>
        <button
          class="rounded-md border border-white/10 px-2.5 py-1.5 text-slate-300 hover:bg-white/5 disabled:opacity-30"
          :disabled="page === pageCount"
          @click="go(page + 1)"
        >Next ›</button>
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
const query = ref('')
const category = ref('')
const refreshing = ref(false)
const sourcesOpen = ref(false)
const page = ref(1)

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

// pagination — reset to page 1 whenever the filter changes
watch([query, category], () => (page.value = 1))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const paged = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

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

onMounted(() => load())
useHead({ title: 'App catalog — homeport' })
</script>
