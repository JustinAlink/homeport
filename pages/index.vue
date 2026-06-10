<template>
  <div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
    <header class="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
      <div class="flex items-center gap-2">
        <div class="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent">⚓</div>
        <h1 class="text-xl font-semibold text-slate-100">homeport</h1>
      </div>
      <div v-if="data" class="flex items-center gap-2 text-xs">
        <span class="rounded-full bg-accent/10 px-2 py-0.5 text-accent-light">{{ data.stats.running }} running</span>
        <span class="rounded-full bg-white/5 px-2 py-0.5 text-slate-400">{{ data.stats.total }} total</span>
        <span v-if="data.domainProvider" class="hidden rounded-full bg-white/5 px-2 py-0.5 text-slate-500 sm:inline">
          via {{ data.domainProvider }}
        </span>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <SearchBar v-model="q" />
        <button class="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5" title="Refresh" @click="refresh">↻</button>
        <button class="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/5" @click="logout">Log out</button>
      </div>
    </header>

    <div v-if="loading && !data" class="py-20 text-center text-slate-500">Loading…</div>
    <div v-else-if="error" class="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
      {{ error }}
    </div>

    <div v-else class="space-y-8">
      <StackGroup v-for="g in groups" :key="g.name" :name="g.name" :services="g.services" />
      <p v-if="!groups.length" class="py-20 text-center text-slate-500">No services match “{{ q }}”.</p>

      <section v-if="unmatched.length">
        <div class="mb-3 flex items-center gap-3">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500">Unmatched domains</h2>
          <span class="text-xs text-slate-600">{{ unmatched.length }}</span>
          <div class="h-px flex-1 bg-white/5" />
        </div>
        <div class="flex flex-wrap gap-2">
          <div v-for="u in unmatched" :key="u.upstream" class="rounded-md border border-white/5 bg-ink-900 px-3 py-1.5 text-xs">
            <span class="text-slate-300">{{ u.domains.join(', ') }}</span>
            <span class="text-slate-600"> → {{ u.upstream }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const { data, error, loading, refresh, start, stop } = useServices()
const stats = useStats()
const q = ref('')

onMounted(() => {
  start()
  stats.start()
})
onBeforeUnmount(() => {
  stop()
  stats.stop()
})

const visible = computed<Service[]>(() => (data.value?.services || []).filter((s) => !s.hidden))

const filtered = computed<Service[]>(() => {
  const term = q.value.trim().toLowerCase()
  if (!term) return visible.value
  return visible.value.filter((s) =>
    [s.displayName, s.name, s.image, s.group, ...s.domains.map((d) => d.domain)]
      .join(' ')
      .toLowerCase()
      .includes(term),
  )
})

const groups = computed(() => {
  const map = new Map<string, Service[]>()
  for (const s of filtered.value) {
    const arr = map.get(s.group) || []
    arr.push(s)
    map.set(s.group, arr)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, services]) => ({ name, services }))
})

const unmatched = computed(() => {
  const term = q.value.trim().toLowerCase()
  const list = data.value?.unmatched || []
  if (!term) return list
  return list.filter((u) => (u.domains.join(' ') + u.upstream).toLowerCase().includes(term))
})

async function logout() {
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } catch {}
  await navigateTo('/login')
}

useHead({ title: 'homeport' })
</script>
