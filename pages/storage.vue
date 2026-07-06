<template>
  <div class="mx-auto max-w-[1300px] px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-6 flex items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back"><Icon name="arrow-left" class="h-[18px] w-[18px]" /></NuxtLink>
      <div>
        <h1 class="text-xl font-semibold text-slate-100">Storage</h1>
        <p class="mt-1 text-[13px] text-slate-500">
          Volumes and images on this host. Deleting a stack or container keeps its volumes (and images) unless you
          said otherwise — leftovers show up here as <span class="text-amber-300/80">unused</span> and can be removed.
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
      <!-- VOLUMES -->
      <div class="mb-2 flex items-center gap-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Volumes <span class="ml-1 font-normal normal-case text-slate-600">{{ volumes.length }}</span>
        </h2>
        <button
          class="ml-auto rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-slate-400 hover:bg-white/5 disabled:opacity-40"
          :disabled="sizesLoading"
          title="Walks volume contents (docker system df) — can take a few seconds"
          @click="loadSizes"
        >{{ sizesLoading ? 'Calculating…' : Object.keys(sizes).length ? 'Recalculate sizes' : 'Calculate sizes' }}</button>
      </div>
      <p v-if="volErr" class="mb-2 text-xs text-red-400">{{ volErr }}</p>
      <div class="mb-8 space-y-2">
        <div v-for="v in volumes" :key="v.name" class="rounded-xl border border-white/5 bg-ink-900 px-5 py-3.5">
          <div class="flex flex-wrap items-center gap-3">
            <span class="font-mono text-[15px] text-slate-100">{{ v.name }}</span>
            <span v-if="v.project" class="rounded-full border border-sky-400/25 px-1.5 py-px text-[9px] uppercase tracking-wider text-sky-300" :title="`Created by compose project ${v.project}`">{{ v.project }}</span>
            <span class="text-xs text-slate-600">{{ v.driver }}</span>
            <span v-if="sizes[v.name] !== undefined" class="font-mono text-xs text-slate-500">{{ formatBytes(sizes[v.name]) }}</span>
            <span v-if="v.createdAt" class="hidden text-[11px] text-slate-600 sm:block">created {{ ago(v.createdAt) }}</span>
            <span class="ml-auto text-xs" :class="v.attached.length ? 'text-slate-500' : 'text-amber-300/70'">
              {{ v.attached.length ? `${v.attached.length} container${v.attached.length > 1 ? 's' : ''}` : 'unused' }}
            </span>
            <template v-if="!v.attached.length">
              <template v-if="pendingVol === v.name">
                <span class="text-[11px] text-red-300">delete this volume's data forever?</span>
                <button class="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/20" @click="removeVolume(v.name)">yes, delete</button>
                <button class="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5" @click="pendingVol = ''">no</button>
              </template>
              <button
                v-else
                class="rounded-md border border-red-500/25 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                @click="pendingVol = v.name"
              >Remove</button>
            </template>
          </div>
          <div v-if="v.attached.length" class="mt-2 flex flex-wrap gap-1.5">
            <NuxtLink
              v-for="c in v.attached"
              :key="c.id"
              :to="`/services/${encodeURIComponent(c.id)}`"
              class="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400 hover:border-accent/40 hover:text-slate-200"
            >{{ c.name }}</NuxtLink>
          </div>
        </div>
        <p v-if="!volumes.length" class="rounded-lg border border-white/5 bg-ink-900 p-6 text-center text-xs text-slate-600">no volumes</p>
      </div>

      <!-- IMAGES -->
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
        Images <span class="ml-1 font-normal normal-case text-slate-600">{{ images.length }} · {{ formatBytes(imagesTotal) }}</span>
      </h2>
      <p v-if="imgErr" class="mb-2 text-xs text-red-400">{{ imgErr }}</p>
      <div class="space-y-2">
        <div v-for="i in images" :key="i.id" class="rounded-xl border border-white/5 bg-ink-900 px-5 py-3.5">
          <div class="flex flex-wrap items-center gap-3">
            <span class="min-w-0 truncate font-mono text-[15px] text-slate-100">{{ i.ref }}</span>
            <span v-if="i.dangling" class="rounded-full border border-white/10 px-1.5 py-px text-[9px] uppercase tracking-wider text-slate-500" title="No tag points at this image anymore (an update or build replaced it)">dangling</span>
            <span class="font-mono text-xs text-slate-500">{{ formatBytes(i.size) }}</span>
            <span v-if="i.createdAt" class="hidden text-[11px] text-slate-600 sm:block">built {{ ago(i.createdAt) }}</span>
            <span class="ml-auto text-xs" :class="i.attached.length ? 'text-slate-500' : 'text-amber-300/70'">
              {{ i.attached.length ? `${i.attached.length} container${i.attached.length > 1 ? 's' : ''}` : 'unused' }}
            </span>
            <template v-if="!i.attached.length">
              <template v-if="pendingImg === i.id">
                <span class="text-[11px] text-red-300">delete? (re-downloadable)</span>
                <button class="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/20" @click="removeImage(i.id)">yes</button>
                <button class="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5" @click="pendingImg = ''">no</button>
              </template>
              <button
                v-else
                class="rounded-md border border-red-500/25 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                @click="pendingImg = i.id"
              >Remove</button>
            </template>
          </div>
          <div v-if="i.attached.length" class="mt-2 flex flex-wrap gap-1.5">
            <NuxtLink
              v-for="c in i.attached"
              :key="c.id"
              :to="`/services/${encodeURIComponent(c.id)}`"
              class="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400 hover:border-accent/40 hover:text-slate-200"
            >{{ c.name }}</NuxtLink>
          </div>
        </div>
      </div>
      <p class="mt-4 text-[11px] text-slate-600">
        Removal refuses anything still referenced by a container (running or stopped). Volumes hold your data —
        deleting one is forever. Images are just downloads; removing an unused one costs a re-pull at most.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
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

onMounted(load)
useHead({ title: 'Storage — homeport' })
</script>
