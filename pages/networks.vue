<template>
  <div class="page">
    <PageHeader title="Networks">
      <template #subtitle>
        Containers can reach each other by name only when they share a network. Every stack gets a private network of its
        own automatically; shared networks connect stacks, for example your reverse proxy to the apps it serves.
      </template>
      <template v-if="gateCaps.stacks || !gateLoaded" #actions>
        <button class="btn" :disabled="loading" @click="load"><Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> Refresh</button>
        <button v-if="caps.control" class="btn btn-primary" @click="creating = !creating"><Icon name="plus" /> New network</button>
      </template>
    </PageHeader>

    <CapabilityGate need="stacks" feature="Network management" text="This page shows which containers can reach each other and lets you connect them, create shared networks and remove unused ones. It comes with compose stack management." icon="network">
      <!-- create form -->
      <form v-if="creating" class="card mb-5 space-y-3 p-4 sm:p-5" @submit.prevent="createNetwork">
        <p class="card-title">New shared network</p>
        <div class="grid gap-3 sm:grid-cols-[1fr_240px_auto] sm:items-end">
          <Field v-slot="{ id }" label="Name">
            <input :id="id" v-model="create.name" placeholder="e.g. shared-backend" class="input font-mono" spellcheck="false" />
          </Field>
          <Field v-slot="{ id }" label="Subnet" optional>
            <input :id="id" v-model="create.subnet" placeholder="e.g. 172.30.0.0/16" class="input font-mono" spellcheck="false" />
          </Field>
          <div class="flex gap-2">
            <button type="submit" class="btn btn-primary" :disabled="!create.name.trim() || createBusy">{{ createBusy ? 'Creating…' : 'Create' }}</button>
            <button type="button" class="btn btn-ghost" @click="creating = false">Cancel</button>
          </div>
        </div>
        <p class="text-xs leading-relaxed text-slate-500">
          Leave the subnet empty and Docker picks a free range (recommended). Then connect the containers that should reach each
          other; for stack containers homeport also writes it into their compose files, so it lasts.
        </p>
        <p v-if="createErr" class="whitespace-pre-line text-xs text-red-400">{{ createErr }}</p>
      </form>

      <div v-if="error" class="callout callout-warn"><Icon name="alert" /><span>{{ error }}</span></div>
      <div v-else-if="!loaded" class="card h-64" />

      <template v-else>
        <p v-if="removeErr" class="callout callout-danger mb-4 text-xs"><Icon name="alert" />{{ removeErr }}</p>

        <!-- proxy reachability summary -->
        <div v-if="unreachable.length" class="callout callout-warn mb-5">
          <Icon name="alert" />
          <div>
            Your reverse proxy (<span class="font-medium text-slate-100">{{ proxyName }}</span>) can't reach
            <span v-for="(u, i) in unreachable" :key="u.service.id"><NuxtLink :to="`/services/${encodeURIComponent(u.service.id)}`" class="link">{{ u.service.displayName }}</NuxtLink>{{ i < unreachable.length - 1 ? ', ' : '' }}</span>:
            {{ unreachable.length > 1 ? 'they share' : 'it shares' }} no network, so {{ unreachable.length > 1 ? 'their domains' : 'its domain' }} will answer with an error.
            <span v-if="unreachable[0].suggest">Connect {{ unreachable.length > 1 ? 'them' : 'it' }} to <span class="font-mono">{{ unreachable[0].suggest }}</span> below.</span>
          </div>
        </div>

        <!-- SHARED -->
        <section class="mb-8">
          <div class="mb-2.5 flex items-baseline gap-2">
            <h2 class="section-title">Shared networks</h2>
            <span class="text-xs text-slate-500">{{ shared.length }}</span>
          </div>
          <p class="mb-3 max-w-3xl text-xs leading-relaxed text-slate-500">Networks that connect containers across stacks. Everything on the same one can reach the others by container name.</p>

          <div v-if="!shared.length" class="card">
            <EmptyState icon="network" title="No shared networks" text="Each stack only talks to itself right now. Create a shared network to let, say, a reverse proxy reach your apps.">
              <template v-if="caps.control" #actions><button class="btn btn-primary btn-sm" @click="creating = true"><Icon name="plus" /> New network</button></template>
            </EmptyState>
          </div>

          <div class="space-y-3">
            <div v-for="n in shared" :key="n.id" class="card">
              <div class="card-header">
                <Icon name="network" class="h-4 w-4 text-slate-500" />
                <span class="font-mono text-[13.5px] font-medium text-slate-100">{{ n.name }}</span>
                <span v-if="proxyOn(n)" class="badge badge-accent" :title="`${proxyName} (your reverse proxy) is on this network: apps on it can be proxied by container name`"><Icon name="globe" class="h-3 w-3" />reverse proxy</span>
                <NuxtLink v-if="n.project" :to="`/stacks/${encodeURIComponent(n.project)}`" class="badge hover:brightness-125" :title="`Created by the stack ${n.project}`">from stack {{ n.project }}</NuxtLink>
                <span v-if="!n.containers" class="badge badge-warn">unused</span>
                <div class="ml-auto flex items-center gap-2">
                  <button v-if="caps.control && connectFor !== n.name" class="btn btn-sm" @click="openConnect(n.name)"><Icon name="plus" /> Connect a container</button>
                  <button
                    v-if="caps.control && !n.containers"
                    :disabled="busy === n.name"
                    class="btn btn-danger btn-sm"
                    @click="remove(n.name)"
                  >{{ busy === n.name ? 'Removing…' : 'Remove' }}</button>
                </div>
              </div>

              <div class="space-y-2.5 p-4 sm:px-5">
                <!-- who's on it, grouped by stack -->
                <div v-for="g in membersByStack(n)" :key="g.key" class="flex flex-wrap items-center gap-1.5">
                  <NuxtLink v-if="g.stack" :to="`/stacks/${encodeURIComponent(g.stack)}`" class="mr-1 inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-100">
                    <Icon name="stacks" class="h-3.5 w-3.5" />{{ g.stack }}
                  </NuxtLink>
                  <span v-else class="mr-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500"><Icon name="box" class="h-3.5 w-3.5" />no stack</span>
                  <span v-for="c in g.members" :key="c.id" class="chip gap-1 pr-1">
                    <NuxtLink :to="`/services/${encodeURIComponent(c.id)}`" class="hover:text-slate-100">{{ c.label }}</NuxtLink>
                    <button
                      v-if="caps.control"
                      class="grid h-4 w-4 place-items-center rounded text-slate-500 hover:bg-red-500/15 hover:text-red-300"
                      :title="`Disconnect ${c.label} from ${n.name}`"
                      :aria-label="`Disconnect ${c.label}`"
                      @click="detach(n.name, c)"
                    ><Icon name="x" class="h-2.5 w-2.5" /></button>
                  </span>
                </div>
                <p v-if="!n.containers" class="text-xs text-slate-500">Nothing is connected.</p>

                <!-- connect picker -->
                <form v-if="connectFor === n.name" class="flex flex-wrap items-end gap-2 rounded-lg border border-white/[0.08] bg-ink-950/40 p-3" @submit.prevent="doConnect(n.name)">
                  <Field v-slot="{ id }" label="Container" class="min-w-[240px] flex-1">
                    <select :id="id" v-model="pick.id" class="select">
                      <option value="" disabled>Choose a container…</option>
                      <optgroup v-for="g in attachableGroups(n)" :key="g.label" :label="g.label">
                        <option v-for="s in g.items" :key="s.id" :value="s.id">{{ s.displayName }}</option>
                      </optgroup>
                    </select>
                  </Field>
                  <label v-if="pickedService && netOps.canSave(pickedService)" class="check mb-2 text-xs text-slate-400">
                    <input v-model="pick.save" type="checkbox" /> Also save it to the stack's compose file
                  </label>
                  <div class="flex gap-2">
                    <button type="submit" class="btn btn-primary" :disabled="!pick.id || pick.busy">{{ pick.busy ? 'Connecting…' : 'Connect' }}</button>
                    <button type="button" class="btn btn-ghost" @click="connectFor = ''">Cancel</button>
                  </div>
                </form>

                <p class="font-mono text-[11px] text-slate-500">{{ n.subnets.join(' · ') || 'no subnet' }} · {{ n.driver }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- STACK-PRIVATE -->
        <details class="group mb-4" :open="openStackNets">
          <summary class="mb-2.5 flex cursor-pointer list-none items-baseline gap-2" @click.prevent="openStackNets = !openStackNets">
            <Icon name="chevron-down" class="h-3.5 w-3.5 self-center text-slate-500 transition-transform" :class="openStackNets ? '' : '-rotate-90'" />
            <h2 class="section-title">Stack networks</h2>
            <span class="text-xs text-slate-500">{{ stackNets.length }}</span>
            <span v-if="stackNets.some((n) => !n.containers)" class="badge badge-warn">{{ stackNets.filter((n) => !n.containers).length }} unused</span>
            <span class="text-xs text-slate-500">· each stack's private network, created by its compose file</span>
          </summary>
          <div class="card row-list overflow-hidden">
            <div v-for="n in stackNets" :key="n.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5">
              <span class="font-mono text-[13px] text-slate-200">{{ n.name }}</span>
              <NuxtLink v-if="n.project" :to="`/stacks/${encodeURIComponent(n.project)}`" class="text-xs text-slate-400 hover:text-slate-100">stack {{ n.project }}</NuxtLink>
              <span class="text-xs text-slate-500">{{ n.containers ? `${n.containers} container${n.containers > 1 ? 's' : ''}` : '' }}</span>
              <span class="hidden font-mono text-[11px] text-slate-500 sm:inline">{{ n.subnets.join(' · ') }}</span>
              <div class="ml-auto flex items-center gap-2">
                <span v-if="!n.containers" class="badge badge-warn" title="Left behind by a stack that's gone: safe to remove">unused</span>
                <button v-if="caps.control && !n.containers" :disabled="busy === n.name" class="btn btn-danger btn-sm" @click="remove(n.name)">{{ busy === n.name ? 'Removing…' : 'Remove' }}</button>
              </div>
            </div>
            <p v-if="!stackNets.length" class="p-6 text-center text-[13px] text-slate-500">No stack networks.</p>
          </div>
        </details>

        <!-- BUILT-IN -->
        <details class="mb-4" :open="openBuiltin">
          <summary class="mb-2.5 flex cursor-pointer list-none items-baseline gap-2" @click.prevent="openBuiltin = !openBuiltin">
            <Icon name="chevron-down" class="h-3.5 w-3.5 self-center text-slate-500 transition-transform" :class="openBuiltin ? '' : '-rotate-90'" />
            <h2 class="section-title">Docker built-in</h2>
            <span class="text-xs text-slate-500">· always there, can't be removed</span>
          </summary>
          <div class="card row-list overflow-hidden">
            <div v-for="n in builtin" :key="n.id" class="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5">
              <span class="w-16 font-mono text-[13px] text-slate-200">{{ n.name }}</span>
              <span class="min-w-0 flex-1 text-xs leading-relaxed text-slate-500">{{ builtinHint(n.name) }}</span>
              <span v-if="n.containers" class="text-xs text-slate-500">{{ n.containers }} container{{ n.containers > 1 ? 's' : '' }}</span>
            </div>
          </div>
        </details>

        <p class="mt-6 text-xs leading-relaxed text-slate-500">
          Removing refuses built-in networks and anything a container (running or stopped) still uses. A network's address range
          can't be changed in place: change it in the compose file that creates it, or remove an unused network and create it again.
        </p>
      </template>
    </CapabilityGate>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const { caps: gateCaps, loaded: gateLoaded } = useCapabilities() // header actions hide while the feature is off
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

const { confirm, choose } = useConfirm()
const { caps, load: loadCaps } = useCapabilities()
const networks = ref<NetRow[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
const busy = ref('')
const removeErr = ref('')
const openStackNets = ref(false)
const openBuiltin = ref(false)

const { data: svcData, start: svcStart, stop: svcStop } = useServices()
const reachApi = useProxyReach()
const netOps = useNetworkOps()
const stacksStore = useStacks()

const byId = computed(() => new Map((svcData.value?.services ?? []).map((s) => [s.id, s])))
const svcFor = (id: string) => byId.value.get(id)

// shared = connects more than one stack (or isn't any stack's own); stack = one stack's private network
const builtin = computed(() => networks.value.filter((n) => n.builtin))
function projectsOn(n: NetRow): Set<string> {
  return new Set((n.attached ?? []).map((c) => svcFor(c.id)?.project ?? `::${c.id}`))
}
const stackNets = computed(() =>
  networks.value.filter((n) => !n.builtin && n.project && [...projectsOn(n)].every((p) => p === n.project)),
)
const shared = computed(() => {
  const own = new Set(stackNets.value.map((n) => n.id))
  return networks.value
    .filter((n) => !n.builtin && !own.has(n.id))
    .sort((a, b) => Number(proxyOn(b)) - Number(proxyOn(a)) || a.name.localeCompare(b.name))
})

const proxyName = computed(() => reachApi.proxy.value?.displayName ?? '')
const proxyOn = (n: NetRow) => !!reachApi.proxy.value && (n.attached ?? []).some((c) => c.id === reachApi.proxy.value!.id)
const unreachable = computed(() =>
  (svcData.value?.services ?? [])
    .filter((s) => s.kind === 'container' && !s.hidden)
    .map((s) => ({ service: s, ...reachApi.domainReach(s) }))
    .filter((r) => r.ok === false),
)

function membersByStack(n: NetRow) {
  const groups = new Map<string, { key: string; stack: string | null; members: { id: string; label: string }[] }>()
  for (const c of n.attached ?? []) {
    const s = svcFor(c.id)
    const stack = s?.project ?? null
    const key = stack ?? '::none'
    const g = groups.get(key) ?? { key, stack, members: [] }
    g.members.push({ id: c.id, label: s?.displayName ?? c.name })
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => (a.stack ?? '~').localeCompare(b.stack ?? '~'))
}

function builtinHint(name: string) {
  if (name === 'bridge') return 'Where containers land when nothing says otherwise. It has no name resolution, so containers here only reach each other by IP.'
  if (name === 'host') return "Shares the host's own network: no isolation and no port mapping."
  if (name === 'none') return 'No networking at all.'
  return ''
}

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
  if (!(await confirm({ message: `Remove docker network “${name}”? No container uses it.`, confirmLabel: 'Remove', danger: true }))) return
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

// --- connect / disconnect (saved to the compose file for stack containers) ---
const connectFor = ref('')
const pick = reactive({ id: '', save: true, busy: false })
const pickedService = computed(() => (pick.id ? svcFor(pick.id) : undefined))
function openConnect(network: string) {
  connectFor.value = network
  pick.id = ''
  pick.save = true
}
function attachableGroups(n: NetRow) {
  const on = new Set((n.attached ?? []).map((c) => c.id))
  const groups = new Map<string, Service[]>()
  for (const s of svcData.value?.services ?? []) {
    if (s.kind !== 'container' || on.has(s.id)) continue
    const label = s.project ? `Stack ${s.project}` : 'No stack'
    groups.set(label, [...(groups.get(label) ?? []), s])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, items]) => ({ label, items: items.sort((a, b) => a.displayName.localeCompare(b.displayName)) }))
}
async function doConnect(network: string) {
  const s = pickedService.value
  if (!s) return
  pick.busy = true
  const ok = await netOps.connect(network, s, { save: pick.save && netOps.canSave(s) })
  pick.busy = false
  if (ok) {
    connectFor.value = ''
    await load()
  }
}
async function detach(network: string, c: { id: string; label: string }) {
  const s = svcFor(c.id)
  if (!s) return
  let save = false
  if (netOps.canSave(s)) {
    const r = await choose({
      title: `Disconnect ${c.label} from ${network}?`,
      message: `Other containers on ${network} lose access to it by name. It's part of the stack “${s.project}”: save the change to its compose file too, or it reconnects the next time the stack starts.`,
      confirmLabel: 'Disconnect and save',
      altLabel: 'Only until the next start',
      danger: true,
    })
    if (r === 'cancel') return
    save = r === 'confirm'
  } else if (!(await confirm({ message: `Disconnect “${c.label}” from “${network}”? Other containers on it lose access to it by name.`, confirmLabel: 'Disconnect', danger: true }))) {
    return
  }
  if (await netOps.disconnect(network, s, { save })) await load()
}

onMounted(() => {
  load()
  loadCaps().then(() => stacksStore.refresh())
  svcStart()
})
onBeforeUnmount(svcStop)
useHead({ title: 'Networks · homeport' })
</script>
