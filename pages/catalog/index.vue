<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <header class="mb-6 flex flex-wrap items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back">←</NuxtLink>
      <div class="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent">⚓</div>
      <h1 class="text-xl font-semibold text-slate-100">App catalog</h1>
      <span v-if="data" class="text-xs text-slate-600">{{ data.apps.length }} apps</span>
      <button
        class="ml-auto rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
        :disabled="refreshing"
        title="Refetch template sources"
        @click="refresh"
      >{{ refreshing ? 'Refreshing…' : '↻ Refresh sources' }}</button>
    </header>

    <div v-if="error" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ error }}</div>
    <div v-else-if="!data" class="py-20 text-center text-slate-500">Loading…</div>

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
          v-for="c in categories"
          :key="c"
          class="rounded-full border px-2.5 py-1 text-[11px]"
          :class="c === category ? 'border-accent/50 bg-accent/10 text-accent-light' : 'border-white/10 text-slate-400 hover:bg-white/5'"
          @click="category = category === c ? '' : c"
        >{{ c }}</button>
      </div>

      <p v-if="!filtered.length" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
        No apps match.
      </p>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="app in filtered"
          :key="app.slug"
          :to="`/catalog/${app.slug}`"
          class="flex gap-3 rounded-lg border border-white/5 bg-ink-900 p-4 transition-colors hover:border-accent/30"
        >
          <ServiceIcon :name="app.name" :icon="app.icon" :size="38" class="shrink-0" />
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium text-slate-100">{{ app.name }}</span>
              <span
                v-if="app.source !== 'built-in'"
                class="shrink-0 rounded-full border border-sky-400/30 px-1.5 py-px text-[9px] uppercase tracking-wider text-sky-300"
                :title="app.source"
              >source</span>
            </div>
            <p class="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{{ app.description }}</p>
          </div>
        </NuxtLink>
      </div>

      <!-- sources -->
      <h2 class="mb-2 mt-10 text-sm font-semibold uppercase tracking-wider text-slate-500">Template sources</h2>
      <div class="space-y-1.5">
        <div
          v-for="s in data.sources"
          :key="s.url"
          class="flex flex-wrap items-center gap-3 rounded-md border border-white/5 bg-ink-900/60 px-4 py-2 text-xs"
        >
          <span class="h-2 w-2 shrink-0 rounded-full" :class="s.ok ? 'bg-accent' : 'bg-red-400'" />
          <span class="font-mono text-slate-300">{{ s.url }}</span>
          <span v-if="s.ok" class="text-slate-600">{{ s.count }} apps<template v-if="s.skipped"> · {{ s.skipped }} unsupported skipped</template></span>
          <span v-else class="text-red-400/80">{{ s.error }}</span>
          <span v-if="s.format" class="ml-auto rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase text-slate-500">{{ s.format }}</span>
        </div>
      </div>
      <p class="mt-2 text-xs text-slate-600">
        Add more sources (homeport or Portainer <code class="text-slate-500">templates.json</code> URLs) in
        <NuxtLink to="/settings" class="text-accent-light hover:underline">Settings</NuxtLink>.
      </p>
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

const data = ref<CatalogResponse | null>(null)
const error = ref('')
const query = ref('')
const category = ref('')
const refreshing = ref(false)

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

const categories = computed(() => {
  const all = new Set<string>()
  for (const a of data.value?.apps ?? []) for (const c of a.categories) all.add(c)
  return [...all].sort()
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return (data.value?.apps ?? []).filter((a) => {
    if (category.value && !a.categories.includes(category.value)) return false
    if (!q) return true
    return `${a.name} ${a.description} ${a.image}`.toLowerCase().includes(q)
  })
})

onMounted(() => load())
useHead({ title: 'App catalog — homeport' })
</script>
