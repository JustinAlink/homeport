<template>
  <div class="page">
    <PageHeader title="Domains" :subtitle="provider ? `Reverse-proxy routes, managed through ${provider}.` : 'Reverse-proxy routes pointing domains at your containers.'">
      <template #actions>
        <button v-if="caps.create && !hpCaps.viewer && hpCaps.proxyAdmin" class="btn" :class="adding ? '' : 'btn-primary'" @click="adding = !adding">
          <Icon :name="adding ? 'x' : 'plus'" /> {{ adding ? 'Close' : 'Add domain' }}
        </button>
      </template>
    </PageHeader>

    <CapabilityGate need="proxyAdmin" feature="Domain management" text="homeport can create, edit and delete reverse-proxy routes for you (Nginx Proxy Manager, Caddy or Traefik files). Turn on proxy management and add its credentials." icon="globe">

    <DomainForm v-if="adding" class="mb-5 max-w-2xl" @saved="onSaved" @cancel="adding = false" />

    <div v-if="error" class="callout callout-warn">{{ error }}</div>
    <div v-else-if="!loaded" class="card h-64" />

    <template v-else>
      <div v-if="!routes.length" class="card">
        <EmptyState icon="globe" title="No domains yet" text="Point a domain at a container and homeport creates the proxy route for you.">
          <template v-if="caps.create && !hpCaps.viewer" #actions><button class="btn btn-primary btn-sm" @click="adding = true"><Icon name="plus" /> Add domain</button></template>
        </EmptyState>
      </div>
      <div v-else class="card row-list overflow-hidden">
        <div
          v-for="r in routes"
          :key="r.id"
          class="px-4 py-3 sm:px-5"
        >
          <div v-if="editId !== r.id" class="flex flex-wrap items-start gap-3">
            <Icon :name="r.ssl ? 'lock' : 'globe'" class="mt-0.5 h-4 w-4 shrink-0" :class="r.ssl ? 'text-ok' : 'text-slate-500'" />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span v-for="d in r.domains" :key="d" class="inline-flex min-w-0 items-center gap-2">
                  <a
                    :href="urlOf(r, d)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="truncate text-[13.5px] font-medium text-slate-100 hover:text-accent-light"
                  >{{ d }}</a>
                  <span v-if="pingOf(r, d)" class="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px]" :class="pingBad(pingOf(r, d)!) ? 'text-amber-300' : 'text-slate-500'">
                    <span class="dot h-1.5 w-1.5" :class="pingDot(pingOf(r, d)!)" />{{ pingText(pingOf(r, d)!) }}
                  </span>
                </span>
              </div>
              <p class="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[11.5px] text-slate-500">
                <Icon name="arrow-right" class="h-3 w-3" />{{ r.upstreamHost }}:{{ r.upstreamPort }}
                <template v-if="svcData">
                  <NuxtLink
                    v-if="svcFor(r)"
                    :to="`/services/${encodeURIComponent(svcFor(r)!.id)}?tab=domains`"
                    class="font-sans text-slate-400 hover:text-accent-light"
                  >· {{ svcFor(r)!.displayName }}<span v-if="svcFor(r)!.state !== 'running'" class="text-amber-300"> ({{ svcFor(r)!.state }})</span></NuxtLink>
                  <span v-else class="font-sans text-amber-300" title="No container matches this upstream: a stopped or removed app, or a typo in the route">· no matching container</span>
                </template>
              </p>
              <ProxyReachWarning v-if="svcFor(r)" :service="svcFor(r)" compact class="mt-2" />
            </div>
            <span v-if="!r.managed" class="badge" title="Not created by homeport, so it's shown read-only">read-only</span>
            <div v-else class="flex items-center gap-1.5">
              <button v-if="caps.update && !hpCaps.viewer" class="btn btn-sm" @click="editId = r.id"><Icon name="pencil" /> Edit</button>
              <button v-if="caps.delete && !hpCaps.viewer" class="btn btn-danger btn-sm btn-icon" :aria-label="`Delete ${r.domains[0]}`" title="Delete" @click="remove(r)"><Icon name="trash" /></button>
            </div>
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
    </CapabilityGate>
  </div>
</template>

<script setup lang="ts">
import type { PingResult, Service } from '~/types/service'

interface AdminRoute {
  id: string
  domains: string[]
  upstreamHost: string
  upstreamPort: number
  ssl: boolean
  managed: boolean
}

const { confirm } = useConfirm()
const toast = useToast()
const { data: svcData, start: svcStart, stop: svcStop } = useServices()
const pingsApi = usePings()

// The container a route serves: the one whose domain list (matched by upstream
// on the server) includes this route's domains.
const svcFor = (r: AdminRoute): Service | undefined =>
  svcData.value?.services.find((s) => s.domains.some((d) => r.domains.includes(d.domain)))
const urlOf = (r: AdminRoute, d: string) => `${r.ssl ? 'https' : 'http'}://${d}`
const pingOf = (r: AdminRoute, d: string): PingResult | undefined => pingsApi.pings.value[urlOf(r, d)]
// 4xx is the app answering (a login wall is fine); 5xx or silence means it isn't
const pingBad = (p: PingResult) => p.status === 0 || p.status >= 500
const pingDot = (p: PingResult) => (p.status === 0 ? 'bg-red-400' : p.status >= 500 ? 'bg-amber-400' : 'bg-ok')
const pingText = (p: PingResult) => (p.status === 0 ? 'no answer' : `HTTP ${p.status} · ${p.ms} ms`)
const { caps: hpCaps, load: loadHpCaps } = useCapabilities()
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
    error.value = errMsg(e, 'Could not load domains')
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
  if (!(await confirm({ message: `Delete the route for ${r.domains.join(', ')}?`, confirmLabel: 'Delete', danger: true }))) return
  try {
    await $fetch(`/api/proxy/routes?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' })
    load()
  } catch (e: any) {
    toast.error(errMsg(e, 'Delete failed'))
  }
}

onMounted(() => {
  if (useRoute().query.add) adding.value = true // "Add a domain" from the command palette
  load()
  loadHpCaps()
  svcStart()
  pingsApi.start()
})
onBeforeUnmount(() => {
  svcStop()
  pingsApi.stop()
})
useHead({ title: 'Domains · homeport' })
</script>
