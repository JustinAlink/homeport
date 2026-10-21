<template>
  <div class="page">
    <PageHeader title="Domains" :subtitle="provider ? `Reverse-proxy routes, managed through ${provider}.` : 'Reverse-proxy routes pointing domains at your containers.'">
      <template #actions>
        <button v-if="caps.create && !hpCaps.viewer" class="btn" :class="adding ? '' : 'btn-primary'" @click="adding = !adding">
          <Icon :name="adding ? 'x' : 'plus'" /> {{ adding ? 'Close' : 'Add domain' }}
        </button>
      </template>
    </PageHeader>

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
          <div v-if="editId !== r.id" class="flex flex-wrap items-center gap-3">
            <Icon :name="r.ssl ? 'lock' : 'globe'" class="h-4 w-4 shrink-0" :class="r.ssl ? 'text-ok' : 'text-slate-500'" />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <a
                  v-for="d in r.domains"
                  :key="d"
                  :href="`${r.ssl ? 'https' : 'http'}://${d}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[13.5px] font-medium text-slate-100 hover:text-accent-light"
                >{{ d }}</a>
              </div>
              <p class="mt-0.5 flex items-center gap-1.5 font-mono text-[11.5px] text-slate-500"><Icon name="arrow-right" class="h-3 w-3" />{{ r.upstreamHost }}:{{ r.upstreamPort }}</p>
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

const { confirm } = useConfirm()
const toast = useToast()
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
})
useHead({ title: 'Domains · homeport' })
</script>
