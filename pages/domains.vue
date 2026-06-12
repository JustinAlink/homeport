<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6">
    <header class="mb-6 flex items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back">←</NuxtLink>
      <div class="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent">⚓</div>
      <h1 class="text-xl font-semibold text-slate-100">Domains</h1>
      <span v-if="provider" class="font-mono text-xs text-slate-600">via {{ provider }}</span>
      <button
        v-if="caps.create"
        class="ml-auto rounded-md border border-accent/30 px-3 py-1.5 text-xs text-accent-light hover:bg-accent/10"
        @click="adding = !adding"
      >{{ adding ? 'Close' : '+ Add domain' }}</button>
    </header>

    <DomainForm v-if="adding" class="mb-4" @saved="onSaved" @cancel="adding = false" />

    <div v-if="error" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ error }}</div>
    <div v-else-if="!loaded" class="py-20 text-center text-slate-500">Loading…</div>

    <template v-else>
      <p v-if="!routes.length" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
        No domains configured.
      </p>
      <div class="space-y-2">
        <div
          v-for="r in routes"
          :key="r.id"
          class="rounded-lg border border-white/5 bg-ink-900 px-4 py-3"
        >
          <div v-if="editId !== r.id" class="flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span v-for="d in r.domains" :key="d" class="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent-light">
                  <span v-if="r.ssl" class="text-[10px]">🔒</span>{{ d }}
                </span>
              </div>
              <p class="mt-0.5 font-mono text-[11px] text-slate-500">→ {{ r.upstreamHost }}:{{ r.upstreamPort }}</p>
            </div>
            <span v-if="!r.managed" class="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase text-slate-500" title="Not created by homeport">read-only</span>
            <template v-else>
              <button v-if="caps.update" class="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/5" @click="editId = r.id">Edit</button>
              <button v-if="caps.delete" class="rounded border border-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10" @click="remove(r)">Delete</button>
            </template>
          </div>
          <DomainForm
            v-else
            :initial="r"
            submit-label="Save"
            cancelable
            @saved="onSaved"
            @cancel="editId = ''"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
interface AdminRoute {
  id: string
  domains: string[]
  upstreamHost: string
  upstreamPort: number
  ssl: boolean
  managed: boolean
}

const routes = ref<AdminRoute[]>([])
const provider = ref('')
const caps = ref({ create: false, update: false, delete: false })
const loaded = ref(false)
const error = ref('')
const adding = ref(false)
const editId = ref('')

async function load() {
  try {
    const r = await $fetch<{ provider: string; capabilities: any; routes: AdminRoute[] }>('/api/proxy/routes')
    provider.value = r.provider
    caps.value = r.capabilities
    routes.value = r.routes
    error.value = ''
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
    error.value = e?.statusMessage || 'Could not load domains'
  } finally {
    loaded.value = true
  }
}

function onSaved() {
  adding.value = false
  editId.value = ''
  load()
}

async function remove(r: AdminRoute) {
  if (!window.confirm(`Delete the route for ${r.domains.join(', ')}?`)) return
  try {
    await $fetch(`/api/proxy/routes?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' })
    load()
  } catch (e: any) {
    window.alert(e?.statusMessage || 'Delete failed')
  }
}

onMounted(load)
useHead({ title: 'Domains — homeport' })
</script>
