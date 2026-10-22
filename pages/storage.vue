<template>
  <div class="page">
    <PageHeader title="Storage">
      <template #subtitle>
        Volumes and images on this host. Deleting a stack or container keeps its volumes and images unless you said
        otherwise; leftovers show up here as <span class="text-amber-300">unused</span>.
      </template>
      <template v-if="gateCaps.stacks || !gateLoaded" #actions>
        <button class="btn" :disabled="loading" @click="load"><Icon name="refresh" :class="loading ? 'animate-spin' : ''" /> Refresh</button>
      </template>
    </PageHeader>

    <CapabilityGate need="stacks" feature="Storage management" text="This page lists volumes and images, what still uses them, and how much space unused ones take. It comes with compose stack management." icon="database">

    <div v-if="error" class="callout callout-warn"><Icon name="alert" /><span>{{ error }}</span></div>
    <div v-else-if="!loaded" class="space-y-3"><div class="grid grid-cols-2 gap-3 lg:grid-cols-4"><div v-for="i in 4" :key="i" class="card h-[88px]" /></div><div class="card h-64" /></div>

    <template v-else>
      <!-- summary -->
      <div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="card p-4">
          <p class="text-xs font-medium text-slate-400">Volumes</p>
          <p class="mt-1.5 text-2xl font-semibold tabular-nums text-slate-100">{{ volumes.length }}</p>
          <p class="mt-1 text-[11.5px]" :class="unusedVolumes.length ? 'text-amber-300' : 'text-slate-500'">{{ unusedVolumes.length }} unused</p>
        </div>
        <div class="card p-4">
          <p class="text-xs font-medium text-slate-400">Images</p>
          <p class="mt-1.5 text-2xl font-semibold tabular-nums text-slate-100">{{ images.length }}</p>
          <p class="mt-1 text-[11.5px] text-slate-500">{{ formatBytes(imagesTotal) }} on disk</p>
        </div>
        <div class="card col-span-2 flex flex-wrap items-center gap-4 p-4">
          <div class="min-w-0 flex-1">
            <p class="text-xs font-medium text-slate-400">Reclaimable</p>
            <p class="mt-1.5 text-2xl font-semibold tabular-nums" :class="unusedImages.length ? 'text-amber-300' : 'text-slate-100'">{{ formatBytes(reclaimable) }}</p>
            <p class="mt-1 text-[11.5px] text-slate-500">{{ unusedImages.length }} unused image{{ unusedImages.length === 1 ? '' : 's' }}, re-downloadable any time</p>
          </div>
          <button v-if="unusedImages.length" class="btn" :disabled="pruning" @click="pruneImages">
            <Icon name="trash" /> {{ pruning ? `Removing ${pruneDone}/${unusedImages.length + pruneDone}…` : 'Remove unused images' }}
          </button>
        </div>
      </div>

      <!-- VOLUMES -->
      <section class="mb-8">
        <div class="mb-2.5 flex flex-wrap items-center gap-2">
          <h2 class="section-title">Volumes</h2>
          <span class="text-xs text-slate-500">{{ volumes.length }}</span>
          <div class="ml-auto flex items-center gap-2">
            <div class="segmented segmented-sm">
              <button :aria-pressed="!volUnusedOnly" @click="volUnusedOnly = false">All</button>
              <button :aria-pressed="volUnusedOnly" @click="volUnusedOnly = true">Unused</button>
            </div>
            <button
              class="btn btn-sm"
              :disabled="sizesLoading"
              title="Walks volume contents (docker system df), can take a few seconds"
              @click="loadSizes"
            >{{ sizesLoading ? 'Calculating…' : Object.keys(sizes).length ? 'Recalculate sizes' : 'Calculate sizes' }}</button>
          </div>
        </div>
        <p v-if="volErr" class="callout callout-danger mb-2 text-xs"><Icon name="alert" />{{ volErr }}</p>
        <div class="card row-list overflow-hidden">
          <div v-for="v in shownVolumes" :key="v.name" class="px-4 py-3 sm:px-5">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Icon name="database" class="h-4 w-4 shrink-0 text-slate-500" />
              <span class="min-w-0 truncate font-mono text-[13px] text-slate-100">{{ v.name }}</span>
              <NuxtLink v-if="v.project" :to="`/stacks/${encodeURIComponent(v.project)}`" class="badge badge-info hover:brightness-125" :title="`Created by compose project ${v.project}`">{{ v.project }}</NuxtLink>
              <span class="text-xs text-slate-500">{{ v.driver }}</span>
              <span v-if="sizes[v.name] !== undefined" class="font-mono text-xs text-slate-400">{{ formatBytes(sizes[v.name]) }}</span>
              <span v-if="v.createdAt" class="hidden text-[11.5px] text-slate-500 sm:block">created {{ ago(v.createdAt) }}</span>
              <div class="ml-auto flex items-center gap-2">
                <span v-if="!v.attached.length" class="badge badge-warn">unused</span>
                <template v-if="!v.attached.length">
                  <template v-if="pendingVol === v.name">
                    <span class="text-xs text-red-300">Delete this data forever?</span>
                    <button class="btn btn-danger-solid btn-sm" @click="removeVolume(v.name)">Delete</button>
                    <button class="btn btn-ghost btn-sm" @click="pendingVol = ''">Cancel</button>
                  </template>
                  <button v-else class="btn btn-danger btn-sm" @click="pendingVol = v.name">Remove</button>
                </template>
              </div>
            </div>
            <div v-if="v.attached.length" class="mt-2 flex flex-wrap gap-1.5 pl-7">
              <NuxtLink v-for="c in v.attached" :key="c.id" :to="`/services/${encodeURIComponent(c.id)}`" class="chip">{{ c.name }}</NuxtLink>
            </div>
          </div>
          <p v-if="!shownVolumes.length" class="p-8 text-center text-[13px] text-slate-500">{{ volUnusedOnly ? 'No unused volumes.' : 'No volumes.' }}</p>
        </div>
      </section>

      <!-- IMAGES -->
      <section>
        <div class="mb-2.5 flex flex-wrap items-center gap-2">
          <h2 class="section-title">Images</h2>
          <span class="text-xs text-slate-500">{{ images.length }} · {{ formatBytes(imagesTotal) }}</span>
          <div class="segmented segmented-sm ml-auto">
            <button :aria-pressed="!imgUnusedOnly" @click="imgUnusedOnly = false">All</button>
            <button :aria-pressed="imgUnusedOnly" @click="imgUnusedOnly = true">Unused</button>
          </div>
        </div>
        <p v-if="imgErr" class="callout callout-danger mb-2 text-xs"><Icon name="alert" />{{ imgErr }}</p>
        <div class="card row-list overflow-hidden">
          <div v-for="i in shownImages" :key="i.id" class="px-4 py-3 sm:px-5">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Icon name="box" class="h-4 w-4 shrink-0 text-slate-500" />
              <span class="min-w-0 truncate font-mono text-[13px] text-slate-100">{{ i.ref }}</span>
              <span v-if="i.dangling" class="badge" title="No tag points at this image anymore (an update or build replaced it)">dangling</span>
              <span class="font-mono text-xs text-slate-400">{{ formatBytes(i.size) }}</span>
              <span v-if="i.createdAt" class="hidden text-[11.5px] text-slate-500 sm:block">built {{ ago(i.createdAt) }}</span>
              <div class="ml-auto flex items-center gap-2">
                <span v-if="!i.attached.length" class="badge badge-warn">unused</span>
                <template v-if="!i.attached.length">
                  <template v-if="pendingImg === i.id">
                    <span class="text-xs text-slate-400">Remove? It can be re-pulled.</span>
                    <button class="btn btn-danger-solid btn-sm" @click="removeImage(i.id)">Remove</button>
                    <button class="btn btn-ghost btn-sm" @click="pendingImg = ''">Cancel</button>
                  </template>
                  <button v-else class="btn btn-danger btn-sm" :disabled="pruning" @click="pendingImg = i.id">Remove</button>
                </template>
              </div>
            </div>
            <div v-if="i.attached.length" class="mt-2 flex flex-wrap gap-1.5 pl-7">
              <NuxtLink v-for="c in i.attached" :key="c.id" :to="`/services/${encodeURIComponent(c.id)}`" class="chip">{{ c.name }}</NuxtLink>
            </div>
          </div>
          <p v-if="!shownImages.length" class="p-8 text-center text-[13px] text-slate-500">{{ imgUnusedOnly ? 'No unused images.' : 'No images.' }}</p>
        </div>
      </section>
      <p class="mt-4 text-xs text-slate-500">
        Removal refuses anything still referenced by a container (running or stopped). Volumes hold your data, so deleting one
        is forever. Images are just downloads; removing an unused one costs a re-pull at most.
      </p>
    </template>
    </CapabilityGate>
  </div>
</template>

<script setup lang="ts">
const { caps: gateCaps, loaded: gateLoaded } = useCapabilities() // header actions hide while the feature is off
interface VolRow {
  name: string
  driver: string
  createdAt: number
  project: string | null
  attached: { id: string; name: string }[]
}
interface ImgRow {
  id: string
  ref: string
  dangling: boolean
  size: number
  createdAt: number
  attached: { id: string; name: string }[]
}

const volumes = ref<VolRow[]>([])
const images = ref<ImgRow[]>([])
const sizes = ref<Record<string, number>>({})
const loaded = ref(false)
const loading = ref(false)
const sizesLoading = ref(false)
const error = ref('')
const volErr = ref('')
const imgErr = ref('')
const pendingVol = ref('')
const pendingImg = ref('')

const imagesTotal = computed(() => images.value.reduce((a, i) => a + i.size, 0))
const unusedVolumes = computed(() => volumes.value.filter((v) => !v.attached.length))
const unusedImages = computed(() => images.value.filter((i) => !i.attached.length))
const reclaimable = computed(() => unusedImages.value.reduce((a, i) => a + i.size, 0))
const volUnusedOnly = ref(false)
const imgUnusedOnly = ref(false)
const shownVolumes = computed(() => (volUnusedOnly.value ? unusedVolumes.value : volumes.value))
const shownImages = computed(() => (imgUnusedOnly.value ? unusedImages.value : images.value))

function ago(ms: number): string {
  const d = Math.max(0, (Date.now() - ms) / 86400_000)
  if (d < 1) return 'today'
  if (d < 60) return `${Math.round(d)}d ago`
  return `${Math.round(d / 30)}mo ago`
}

async function load() {
  loading.value = true
  try {
    const r = await $fetch<{ volumes: VolRow[]; images: ImgRow[] }>('/api/storage')
    volumes.value = r.volumes
    images.value = r.images
    error.value = ''
    loaded.value = true
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
    error.value = errMsg(e, 'Could not list storage')
  } finally {
    loading.value = false
  }
}

async function loadSizes() {
  sizesLoading.value = true
  volErr.value = ''
  try {
    sizes.value = (await $fetch<{ sizes: Record<string, number> }>('/api/storage/sizes')).sizes
  } catch (e: any) {
    volErr.value = errMsg(e, 'Could not compute sizes')
  } finally {
    sizesLoading.value = false
  }
}

async function removeVolume(name: string) {
  pendingVol.value = ''
  volErr.value = ''
  try {
    await $fetch('/api/storage/volumes/remove', { method: 'POST', body: { name } })
    await load()
  } catch (e: any) {
    volErr.value = errMsg(e, 'Could not remove the volume')
  }
}

async function removeImage(id: string) {
  pendingImg.value = ''
  imgErr.value = ''
  try {
    await $fetch('/api/storage/images/remove', { method: 'POST', body: { id } })
    await load()
  } catch (e: any) {
    imgErr.value = errMsg(e, 'Could not remove the image')
  }
}

// Bulk-remove every unused image through the same per-image endpoint (which
// re-checks references server-side). Volumes are deliberately left to one-by-one
// removal: they hold data, images are only downloads.
const pruning = ref(false)
const pruneDone = ref(0)
const { confirm } = useConfirm()
const toast = useToast()
async function pruneImages() {
  const targets = [...unusedImages.value]
  if (!targets.length) return
  if (
    !(await confirm({
      title: `Remove ${targets.length} unused image${targets.length > 1 ? 's' : ''}?`,
      message: `Frees about ${formatBytes(reclaimable.value)}. Images still used by a container are never touched, and anything removed can be pulled again.`,
      confirmLabel: 'Remove images',
      danger: true,
    }))
  )
    return
  pruning.value = true
  pruneDone.value = 0
  imgErr.value = ''
  const failed: string[] = []
  for (const img of targets) {
    try {
      await $fetch('/api/storage/images/remove', { method: 'POST', body: { id: img.id } })
    } catch (e: any) {
      failed.push(`${img.ref}: ${errMsg(e, 'failed')}`)
    }
    pruneDone.value++
  }
  pruning.value = false
  await load()
  if (failed.length) imgErr.value = failed.join('\n')
  else toast.success(`Removed ${targets.length} image${targets.length > 1 ? 's' : ''}`)
}

onMounted(load)
useHead({ title: 'Storage · homeport' })
</script>
