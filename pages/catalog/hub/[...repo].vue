<template>
  <div class="page-narrow">
    <PageHeader :title="repo" :crumbs="[{ label: 'App catalog', to: '/catalog?tab=hub' }, { label: 'Docker Hub' }]">
      <template #icon>
        <div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/[0.04] ring-1 ring-inset ring-white/[0.08]">
          <ServiceIcon :name="serviceName" :size="32" />
        </div>
      </template>
      <template #subtitle><span class="font-mono text-xs">{{ imageRef }}</span></template>
      <template #actions>
        <a :href="hubUrl" target="_blank" rel="noopener noreferrer" class="btn">Docker Hub <Icon name="external" /></a>
      </template>
    </PageHeader>

    <div v-if="error" class="callout callout-warn">
      {{ error }}
      <NuxtLink :to="editorLink" class="mt-2 block link">Open a blank stack editor instead →</NuxtLink>
    </div>
    <div v-else-if="!inspected" class="card flex items-center justify-center gap-2 p-16 text-[13px] text-slate-500"><Icon name="refresh" class="h-4 w-4 animate-spin" /> Reading the image's configuration…</div>

    <template v-else>
      <p class="mb-6 text-[14px] leading-relaxed text-slate-400">
        homeport read what this image declares and prepared a compose stack: the ports it listens on and the paths it
        stores data in (kept as named volumes, so recreates don't lose anything). Adjust below, then install. The result is
        a normal stack you can edit any time.
      </p>

      <div class="card p-5 sm:p-6">
        <h2 class="mb-5 text-[15px] font-semibold text-slate-100">Install</h2>

        <div class="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <div>
            <label class="field-label">Stack name</label>
            <input
              v-model="stackName"
              class="input"
              :class="attempted && !stackNameValid ? '!border-red-400/60' : ''"
            />
            <p class="field-hint" :class="attempted && !stackNameValid ? '!text-red-400' : ''">
              {{ attempted && !stackNameValid ? 'letters, digits, - and _ only (must start with a letter or digit)' : 'Becomes the directory + compose project name.' }}
            </p>
          </div>

          <div>
            <label class="field-label">Image tag</label>
            <input
              v-model="tag"
              placeholder="latest"
              class="input font-mono"
            />
            <p class="mt-1 text-[11px] text-slate-600">Ports/volumes were read from “latest” — other tags may differ.</p>
          </div>
        </div>

        <!-- ports -->
        <div class="mt-5">
          <div class="mb-2 flex items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-slate-500">Ports</span>
            <button
              class="btn btn-sm h-6 px-2 text-[11px]"
              @click="portRows.push({ container: null, host: null, on: true })"
            >+ add</button>
          </div>
          <p v-if="!portRows.length" class="text-xs text-slate-600">
            The image declares no ports. If the app serves anything, add a mapping.
          </p>
          <div v-for="(p, i) in portRows" :key="i" class="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <label class="inline-flex cursor-pointer items-center gap-2">
              <input v-model="p.on" type="checkbox" class="accent-accent" />
              <span class="text-xs text-slate-400">publish</span>
            </label>
            <input
              v-model.number="p.host"
              type="number"
              min="1"
              max="65535"
              placeholder="host"
              class="w-24 input disabled:opacity-40"
              :disabled="!p.on"
            />
            <span class="text-slate-600">→</span>
            <input
              v-model.number="p.container"
              type="number"
              min="1"
              max="65535"
              placeholder="container"
              class="w-24 input disabled:opacity-40"
              :disabled="!p.on || p.detected"
            />
            <span v-if="p.detected" class="text-[10px] uppercase tracking-wider text-slate-600">declared by the image</span>
            <span v-if="p.on && clashName(p.host)" class="text-[11px] text-amber-300">
              <Icon name="alert" class="mr-1 inline h-3 w-3 align-[-1px]" /> host port {{ p.host }} is already published by “{{ clashName(p.host) }}”
            </span>
          </div>
        </div>

        <!-- volumes -->
        <div class="mt-5">
          <span class="text-xs font-semibold uppercase tracking-wider text-slate-500">Data volumes</span>
          <p v-if="!volRows.length" class="mt-2 text-xs text-slate-600">The image declares no data paths.</p>
          <div v-for="v in volRows" :key="v.path" class="mt-2 flex items-center gap-2 text-sm">
            <label class="inline-flex cursor-pointer items-center gap-2">
              <input v-model="v.on" type="checkbox" class="accent-accent" />
              <span class="font-mono text-xs text-slate-300">{{ v.path }}</span>
            </label>
            <span class="text-[11px] text-slate-600">→ named volume (survives updates & recreates)</span>
          </div>
        </div>

        <div class="mt-6 flex flex-wrap items-center gap-3">
          <button
            :disabled="installing || !caps.stacks || caps.viewer"
            class="btn btn-primary"
            @click="install"
          >{{ installing ? 'Installing…' : 'Install' }}</button>
          <NuxtLink :to="editorLink" class="text-[11px] text-slate-500 hover:text-slate-300 hover:underline">
            open in the stack editor instead →
          </NuxtLink>
          <span v-if="caps.viewer && capsLoaded" class="text-[11px] text-slate-500">
            read-only accounts can't install
          </span>
          <span v-else-if="!caps.stacks && capsLoaded" class="text-[11px] text-slate-500">
            enable <b>Compose stacks</b> in Settings → Capabilities to install
          </span>
          <span v-if="installError" class="whitespace-pre-line text-[11px] text-red-400">{{ installError }}</span>
        </div>
      </div>

      <!-- op output -->
      <div v-if="opLines.length || opRunning" class="card mt-4 p-4">
        <div class="mb-1 flex items-center gap-2 text-xs text-slate-500">
          <span class="h-1.5 w-1.5 rounded-full" :class="opRunning ? 'animate-pulse bg-amber-400' : opDropped ? 'bg-amber-400' : opOk ? 'bg-ok' : 'bg-red-400'" />
          {{ opRunning ? 'installing…' : opDropped ? 'connection to the installer dropped — it may still be running' : opOk ? 'installed' : 'failed' }}
        </div>
        <pre class="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">{{ opLines.join('\n') }}</pre>
        <div v-if="opDropped" class="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <NuxtLink :to="`/stacks/${installedAs}`" class="btn btn-sm">Check the stack</NuxtLink>
          <NuxtLink to="/" class="btn btn-sm">View on dashboard</NuxtLink>
        </div>
        <div v-else-if="opOk" class="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span v-if="following" class="animate-pulse text-slate-400">waiting for the app to come up — opening its page…</span>
          <template v-else>
            <NuxtLink to="/" class="btn btn-primary btn-sm">View on dashboard</NuxtLink>
            <NuxtLink :to="`/stacks/${installedAs}`" class="btn btn-sm">Edit stack</NuxtLink>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ServicesResponse } from '~/types/service'

interface InspectResponse {
  image: string
  service: string
  ports: number[]
  volumes: string[]
}

const route = useRoute()
const repoParam = route.params.repo
const repo = (Array.isArray(repoParam) ? repoParam : [repoParam]).map(String).join('/')

const { caps, loaded: capsLoaded, load: loadCaps } = useCapabilities()

const inspected = ref<InspectResponse | null>(null)
const error = ref('')
const tag = ref('latest')
const stackName = ref('')
const portRows = ref<{ container: number | null; host: number | null; on: boolean; detected?: boolean }[]>([])
const volRows = ref<{ path: string; on: boolean }[]>([])
const publishedPorts = ref<Map<number, string>>(new Map())

const serviceName = computed(() => inspected.value?.service || repo.split('/').pop() || 'app')
const imageRef = computed(() => `${repo}:${tag.value.trim() || 'latest'}`)
const hubUrl = computed(() => `https://hub.docker.com/r/${repo.includes('/') ? repo : '_/' + repo}`)
const editorLink = computed(
  () => `/stacks/${stackName.value || serviceName.value}?new=1&image=${encodeURIComponent(repo)}`,
)

async function load() {
  loadCaps()
  try {
    const r = await $fetch<InspectResponse>('/api/hub/inspect', { query: { image: repo } })
    inspected.value = r
    stackName.value = r.service
    portRows.value = r.ports.map((p) => ({ container: p, host: p, on: true, detected: true }))
    volRows.value = r.volumes.map((path) => ({ path, on: true }))
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
    error.value = errMsg(e, 'Could not read the image configuration')
  }
  // best-effort: current fleet ports, to warn about clashes before installing
  try {
    const svc = await $fetch<ServicesResponse>('/api/services')
    const map = new Map<number, string>()
    for (const s of svc.services) for (const p of s.ports ?? []) map.set(p.hostPort, s.name)
    publishedPorts.value = map
  } catch {
    // warning only — never block the page on it
  }
}

const clashName = (host: number | null) => (host ? publishedPorts.value.get(host) ?? '' : '')

const attempted = ref(false)
const stackNameValid = computed(() => /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(stackName.value.trim()))

// --- install + op streaming (same flow as the template catalog) ---
const installing = ref(false)
const installError = ref('')
const installedAs = ref('')
const opLines = ref<string[]>([])
const opRunning = ref(false)
const opOk = ref<boolean | null>(null)
const opDropped = ref(false)
const following = ref(false)
let es: EventSource | null = null

async function followInstall() {
  following.value = true
  for (let i = 0; i < 10; i++) {
    try {
      const svc = await $fetch<ServicesResponse>('/api/services')
      const mine = svc.services.filter((s) => s.project === installedAs.value)
      if (mine.length) {
        return navigateTo(mine.length === 1 ? `/services/${encodeURIComponent(mine[0].id)}` : `/stacks/${installedAs.value}`)
      }
    } catch {
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  following.value = false // never showed up — leave the manual links
}

async function install() {
  attempted.value = true
  if (!stackNameValid.value) {
    installError.value = 'Fix the stack name first.'
    return
  }
  installing.value = true
  installError.value = ''
  opLines.value = []
  opOk.value = null
  opDropped.value = false
  try {
    const res = await $fetch<{ stack: string; opId: string }>('/api/hub/install', {
      method: 'POST',
      body: {
        image: imageRef.value,
        name: stackName.value.trim(),
        ports: portRows.value.filter((p) => p.on && p.container && p.host).map((p) => ({ container: p.container, host: p.host })),
        volumes: volRows.value.filter((v) => v.on).map((v) => v.path),
      },
    })
    installedAs.value = res.stack
    opRunning.value = true
    es?.close()
    es = new EventSource(`/api/ops/${res.opId}`)
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.line !== undefined) opLines.value.push(msg.line)
        if (msg.done) {
          opOk.value = msg.ok
          opRunning.value = false
          es?.close()
          if (msg.ok) followInstall()
        }
      } catch {}
    }
    es.onerror = () => {
      // A dropped stream is NOT a failure — the op runs server-side. Only mark
      // "dropped" if we never got a done event, so success/fail isn't overwritten.
      if (opOk.value === null) opDropped.value = true
      opRunning.value = false
      es?.close()
    }
  } catch (e: any) {
    installError.value = errMsg(e, 'Install failed')
  } finally {
    installing.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => es?.close())
useHead({ title: `${repo} · Install · homeport` })
</script>
