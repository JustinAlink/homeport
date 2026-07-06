<template>
  <div class="mx-auto max-w-[1300px] px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-6 flex items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back"><Icon name="arrow-left" class="h-[18px] w-[18px]" /></NuxtLink>
      <div>
        <h1 class="text-xl font-semibold text-slate-100">Networks</h1>
        <p class="mt-1 text-[13px] text-slate-500">
          Docker networks on this host — every network claims an address range, and a compose file that pins an
          already-taken subnet fails with “Pool overlaps”. Networks nothing references can be removed here.
        </p>
      </div>
      <button
        class="ml-auto rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
        :disabled="loading"
        @click="load"
      >{{ loading ? 'Refreshing…' : 'Refresh' }}</button>
    </header>

    <div v-if="error" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ error }}</div>
    <div v-else-if="!loaded" class="py-20 text-center text-slate-500">Loading…</div>

    <template v-else>
      <p v-if="removeErr" class="mb-3 text-xs text-red-400">{{ removeErr }}</p>
      <div class="space-y-2">
        <div
          v-for="n in networks"
          :key="n.id"
          class="rounded-xl border border-white/5 bg-ink-900 px-5 py-3.5"
        >
          <div class="flex flex-wrap items-center gap-3">
            <span class="font-mono text-[15px] text-slate-100">{{ n.name }}</span>
            <span v-if="n.builtin" class="rounded-full border border-white/10 px-1.5 py-px text-[9px] uppercase tracking-wider text-slate-500" title="Created by docker itself — always present">built-in</span>
            <span v-else-if="n.project" class="rounded-full border border-sky-400/25 px-1.5 py-px text-[9px] uppercase tracking-wider text-sky-300" :title="`Created by compose project ${n.project}`">{{ n.project }}</span>
            <span class="font-mono text-xs text-slate-500">{{ n.subnets.join(' · ') || 'no subnet' }}</span>
            <span class="text-xs text-slate-600">{{ n.driver }}</span>
            <span class="ml-auto text-xs" :class="n.containers ? 'text-slate-500' : 'text-amber-300/70'">
              {{ n.containers ? `${n.containers} container${n.containers > 1 ? 's' : ''}` : 'unused' }}
            </span>
            <button
              v-if="!n.builtin && n.containers === 0"
              :disabled="busy === n.name"
              class="rounded-md border border-red-500/25 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
              @click="remove(n.name)"
            >{{ busy === n.name ? 'Removing…' : 'Remove' }}</button>
          </div>
          <div v-if="n.attached?.length" class="mt-2 flex flex-wrap gap-1.5">
            <NuxtLink
              v-for="c in n.attached"
              :key="c.id"
              :to="`/services/${encodeURIComponent(c.id)}`"
              class="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400 hover:border-accent/40 hover:text-slate-200"
            >{{ c.name }}</NuxtLink>
          </div>
        </div>
      </div>
      <p class="mt-4 text-[11px] text-slate-600">
        Removal refuses built-in networks and anything still referenced by a container (running or stopped).
        Compose-created networks normally disappear with their stack's <code>down</code> — leftovers here usually
        mean containers were deleted individually.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
interface NetRow {
  id: string
  name: string
  driver: string
  builtin: boolean
  subnets: string[]
  containers: number
  attached?: { id: string; name: string }[]
  project?: string | null
}

const networks = ref<NetRow[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
const busy = ref('')
const removeErr = ref('')

async function load() {
  loading.value = true
  try {
    networks.value = (await $fetch<{ networks: NetRow[] }>('/api/networks')).networks
    error.value = ''
    loaded.value = true
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
    error.value = errMsg(e, 'Could not list networks')
  } finally {
    loading.value = false
  }
}

async function remove(name: string) {
  if (!window.confirm(`Remove docker network “${name}”? No containers reference it.`)) return
  busy.value = name
  removeErr.value = ''
  try {
    await $fetch('/api/networks/remove', { method: 'POST', body: { name } })
    await load()
  } catch (e: any) {
    removeErr.value = errMsg(e, 'Could not remove the network')
  } finally {
    busy.value = ''
  }
}

onMounted(load)
useHead({ title: 'Networks — homeport' })
</script>
