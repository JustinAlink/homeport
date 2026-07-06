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
      <div class="ml-auto flex items-center gap-2">
        <button
          class="rounded-md border border-accent/30 px-3 py-1.5 text-xs text-accent-light hover:bg-accent/10"
          @click="creating = !creating"
        >+ New network</button>
        <button
          class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
          :disabled="loading"
          @click="load"
        >{{ loading ? 'Refreshing…' : 'Refresh' }}</button>
      </div>
    </header>

    <!-- create form -->
    <div v-if="creating" class="mb-4 space-y-2 rounded-lg border border-white/10 bg-ink-900 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="create.name"
          placeholder="network name (e.g. shared-backend)"
          class="min-w-[14rem] flex-1 rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
          @keydown.enter="createNetwork"
        />
        <input
          v-model="create.subnet"
          placeholder="subnet — optional (e.g. 172.30.0.0/16)"
          class="w-64 rounded-md border border-white/10 bg-ink-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-accent/50"
          @keydown.enter="createNetwork"
        />
        <button
          class="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-40"
          :disabled="!create.name.trim() || createBusy"
          @click="createNetwork"
        >{{ createBusy ? 'Creating…' : 'Create' }}</button>
        <button class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-400 hover:bg-white/5" @click="creating = false">Cancel</button>
      </div>
      <p class="text-[11px] text-slate-600">
        Leave the subnet empty to let docker pick a free range (recommended). Bridge driver.
        To connect two stacks, create a network here, then attach containers below — or declare it as
        <code class="text-slate-500">external: true</code> in both compose files to make it permanent.
      </p>
      <p v-if="createErr" class="whitespace-pre-line text-[11px] text-red-400">{{ createErr }}</p>
    </div>

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
            <span v-else-if="n.project" class="rounded-full border border-sky-400/25 px-1.5 py-px text-[9px] uppercase tracking-wider text-sky-300" :title="`Created by compose project ${n.project} — its compose file owns this network's settings`">{{ n.project }}</span>
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
          <div v-if="!n.builtin" class="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              v-for="c in n.attached || []"
              :key="c.id"
              class="group inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400"
            >
              <NuxtLink :to="`/services/${encodeURIComponent(c.id)}`" class="hover:text-slate-200">{{ c.name }}</NuxtLink>
              <button
                class="text-slate-600 hover:text-red-300"
                :title="`Detach ${c.name} from ${n.name}`"
                @click="detach(n.name, c)"
              ><Icon name="x" class="h-2.5 w-2.5" /></button>
            </span>
            <select
              v-if="attachable(n).length"
              class="rounded-md border border-white/10 bg-ink-950 px-1.5 py-0.5 text-[11px] text-slate-400 outline-none focus:border-accent/50"
              :value="''"
              @change="attach(n.name, ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''"
            >
              <option value="" disabled>+ attach container…</option>
              <option v-for="s in attachable(n)" :key="s.id" :value="s.id">{{ s.displayName }}</option>
            </select>
          </div>
          <p v-if="rowErr[n.name]" class="mt-1 text-[11px] text-red-400">{{ rowErr[n.name] }}</p>
        </div>
      </div>
      <p class="mt-4 text-[11px] text-slate-600">
        Removal refuses built-in networks and anything still referenced by a container (running or stopped).
        Attach/detach applies immediately but is runtime-only for compose-managed containers — the compose file's
        <code>networks:</code> section wins when the stack is next recreated; add the network there (with
        <code>external: true</code>) to make it stick. Subnets can't be edited in place — docker has no such API;
        change the subnet in the owning compose file (or remove an unused network and recreate it here).
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
const rowErr = reactive<Record<string, string>>({})

// fleet list feeds the attach dropdown
const { data: svcData, start: svcStart, stop: svcStop } = useServices()

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

// --- create ---
const creating = ref(false)
const create = reactive({ name: '', subnet: '' })
const createBusy = ref(false)
const createErr = ref('')
async function createNetwork() {
  if (!create.name.trim()) return
  createBusy.value = true
  createErr.value = ''
  try {
    await $fetch('/api/networks/create', { method: 'POST', body: { name: create.name.trim(), subnet: create.subnet.trim() } })
    creating.value = false
    create.name = ''
    create.subnet = ''
    await load()
  } catch (e: any) {
    createErr.value = errMsg(e, 'Could not create the network')
  } finally {
    createBusy.value = false
  }
}

// --- attach / detach ---
function attachable(n: NetRow) {
  const attachedIds = new Set((n.attached || []).map((c) => c.id))
  return (svcData.value?.services ?? []).filter((s) => s.kind === 'container' && !attachedIds.has(s.id))
}
async function attach(network: string, id: string) {
  if (!id) return
  rowErr[network] = ''
  try {
    await $fetch('/api/networks/connect', { method: 'POST', body: { network, id } })
    await load()
  } catch (e: any) {
    rowErr[network] = errMsg(e, 'Could not attach the container')
  }
}
async function detach(network: string, c: { id: string; name: string }) {
  if (!window.confirm(`Detach “${c.name}” from “${network}”? Other containers reach it over this network right now.`)) return
  rowErr[network] = ''
  try {
    await $fetch('/api/networks/disconnect', { method: 'POST', body: { network, id: c.id } })
    await load()
  } catch (e: any) {
    rowErr[network] = errMsg(e, 'Could not detach the container')
  }
}

onMounted(() => {
  load()
  svcStart()
})
onBeforeUnmount(svcStop)
useHead({ title: 'Networks — homeport' })
</script>
