<template>
  <div class="page">
    <PageHeader title="Networks">
      <template #subtitle>
        Docker networks on this host. Every network claims an address range, and a compose file that pins an already-taken
        subnet fails with “Pool overlaps”. Networks nothing references can be removed here.
      </template>
      <template #actions>
        <button class="btn" :disabled="loading" @click="load"><Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> Refresh</button>
        <button v-if="caps.control" class="btn btn-primary" @click="creating = !creating"><Icon name="plus" /> New network</button>
      </template>
    </PageHeader>

    <!-- create form -->
    <div v-if="creating" class="card mb-5 space-y-3 p-4 sm:p-5">
      <p class="card-title">New network</p>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="create.name"
          placeholder="network name (e.g. shared-backend)"
          class="min-w-[14rem] flex-1 input"
          @keydown.enter="createNetwork"
        />
        <input
          v-model="create.subnet"
          placeholder="subnet, optional (e.g. 172.30.0.0/16)"
          class="w-64 input font-mono"
          @keydown.enter="createNetwork"
        />
        <button
          class="btn btn-primary"
          :disabled="!create.name.trim() || createBusy"
          @click="createNetwork"
        >{{ createBusy ? 'Creating…' : 'Create' }}</button>
        <button class="btn btn-ghost" @click="creating = false">Cancel</button>
      </div>
      <p class="text-xs leading-relaxed text-slate-500">
        Leave the subnet empty to let docker pick a free range (recommended). Bridge driver. To connect two stacks, create a
        network here, then attach containers below, or declare it as <code>external: true</code> in both compose files to make
        it permanent.
      </p>
      <p v-if="createErr" class="whitespace-pre-line text-[11px] text-red-400">{{ createErr }}</p>
    </div>

    <div v-if="error" class="callout callout-warn">{{ error }}</div>
    <div v-else-if="!loaded" class="card h-64" />

    <template v-else>
      <p v-if="removeErr" class="mb-3 text-xs text-red-400">{{ removeErr }}</p>
      <div class="card row-list overflow-hidden">
        <div
          v-for="n in networks"
          :key="n.id"
          class="px-4 py-3 sm:px-5"
        >
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Icon name="network" class="h-4 w-4 shrink-0 text-slate-500" />
            <span class="font-mono text-[13.5px] text-slate-100">{{ n.name }}</span>
            <span v-if="n.builtin" class="badge" title="Created by docker itself, always present">built-in</span>
            <NuxtLink v-else-if="n.project" :to="`/stacks/${encodeURIComponent(n.project)}`" class="badge badge-info hover:brightness-125" :title="`Created by compose project ${n.project}: its compose file owns this network's settings`">{{ n.project }}</NuxtLink>
            <span class="font-mono text-xs text-slate-400">{{ n.subnets.join(' · ') || 'no subnet' }}</span>
            <span class="text-xs text-slate-500">{{ n.driver }}</span>
            <div class="ml-auto flex items-center gap-2">
              <span v-if="n.containers" class="text-xs text-slate-500">{{ `${n.containers} container${n.containers > 1 ? 's' : ''}` }}</span>
              <span v-else class="badge badge-warn">unused</span>
              <button
                v-if="caps.control && !n.builtin && n.containers === 0"
                :disabled="busy === n.name"
                class="btn btn-danger btn-sm"
                @click="remove(n.name)"
              >{{ busy === n.name ? 'Removing…' : 'Remove' }}</button>
            </div>
          </div>
          <div v-if="!n.builtin" class="mt-2 flex flex-wrap items-center gap-1.5 pl-7">
            <span
              v-for="c in n.attached || []"
              :key="c.id"
              class="chip gap-1 pr-1"
            >
              <NuxtLink :to="`/services/${encodeURIComponent(c.id)}`" class="hover:text-slate-100">{{ c.name }}</NuxtLink>
              <button
                v-if="caps.control"
                class="grid h-4 w-4 place-items-center rounded text-slate-500 hover:bg-red-500/15 hover:text-red-300"
                :title="`Detach ${c.name} from ${n.name}`"
                :aria-label="`Detach ${c.name}`"
                @click="detach(n.name, c)"
              ><Icon name="x" class="h-2.5 w-2.5" /></button>
            </span>
            <select
              v-if="caps.control && attachable(n).length"
              class="select input-sm h-6 w-auto rounded-md py-0 pl-2 pr-7 text-[11.5px] text-slate-400"
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
      <p class="mt-4 text-xs leading-relaxed text-slate-500">
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

const { confirm } = useConfirm()
const { caps, load: loadCaps } = useCapabilities()
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
  if (!(await confirm({ message: `Remove docker network “${name}”? No containers reference it.`, confirmLabel: 'Remove', danger: true }))) return
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
  if (!(await confirm({ message: `Detach “${c.name}” from “${network}”? Other containers reach it over this network right now.`, confirmLabel: 'Detach', danger: true }))) return
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
  loadCaps()
  svcStart()
})
onBeforeUnmount(svcStop)
useHead({ title: 'Networks · homeport' })
</script>
