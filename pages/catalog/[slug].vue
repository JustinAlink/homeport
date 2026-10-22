<template>
  <div class="page-narrow">
    <PageHeader :title="app?.name ?? 'App'" :crumbs="[{ label: 'App catalog', to: '/catalog' }]">
      <template v-if="app" #icon>
        <div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/[0.04] ring-1 ring-inset ring-white/[0.08]">
          <ServiceIcon :name="app.name" :icon="app.icon" :size="32" />
        </div>
      </template>
      <template v-if="app" #badges>
        <span v-for="c in app.categories" :key="c" class="badge">{{ c }}</span>
      </template>
      <template v-if="app" #subtitle><span class="font-mono text-xs">{{ app.image }}</span></template>
    </PageHeader>

    <div v-if="error" class="callout callout-warn">{{ error }}</div>
    <div v-else-if="!app" class="card h-72" />

    <template v-else>
      <p class="mb-4 text-[14px] leading-relaxed text-slate-300">{{ app.description }}</p>
      <div v-if="app.notes" class="callout callout-info mb-4 text-xs"><Icon name="info" /><span>{{ notesText }}</span></div>
      <div class="mb-6 text-xs text-slate-500">
        From <span class="font-mono text-slate-400">{{ app.source }}</span>. Installs as a
        <NuxtLink to="/stacks" class="link">compose stack</NuxtLink> you can edit afterwards.
      </div>

      <!-- already running here (an installed app is just a stack) -->
      <div v-if="installedServiceId" class="callout mb-4 border-ok/25 bg-ok/[0.06]">
        <Icon name="check" class="text-ok" />
        <div>
          <span class="font-medium text-ok">Already installed.</span> It's running here as a stack.
          <NuxtLink
            :to="installedProject ? `/stacks/${encodeURIComponent(installedProject)}` : `/services/${encodeURIComponent(installedServiceId)}`"
            class="link"
          >Open it</NuxtLink>
          <span class="mt-0.5 block text-xs text-slate-500">Installing again creates a second, separate stack.</span>
        </div>
      </div>

      <!-- install form -->
      <div class="card p-5 sm:p-6">
        <h2 class="mb-5 text-[15px] font-semibold text-slate-100">Install</h2>

        <div class="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <div>
            <label class="field-label" for="install-stack-name">Stack name</label>
            <input
              id="install-stack-name"
              v-model="stackName"
              class="input"
              :class="attempted && !stackNameValid ? '!border-red-400/60' : ''"
            />
            <p class="field-hint" :class="attempted && !stackNameValid ? '!text-red-400' : ''">
              {{ attempted && !stackNameValid ? 'letters, digits, - and _ only (must start with a letter or digit)' : 'Becomes the directory + compose project name.' }}
            </p>
          </div>

          <div v-for="input in visibleInputs" :key="input.name">
            <label class="field-label" :for="`install-${input.name}`">
              {{ input.label }}<span v-if="input.required" class="text-red-400"> *</span>
            </label>
            <select
              v-if="input.select"
              :id="`install-${input.name}`"
              v-model="values[input.name]"
              class="input"
            >
              <option v-for="opt in input.select" :key="opt.value" :value="opt.value">{{ opt.text }}</option>
            </select>
            <input
              v-else
              :id="`install-${input.name}`"
              v-model="values[input.name]"
              :type="/password|secret|token/i.test(input.name) ? 'password' : 'text'"
              :placeholder="input.default"
              class="input"
              :class="attempted && isMissing(input) ? '!border-red-400/60' : ''"
            />
            <p v-if="attempted && isMissing(input)" class="mt-1 text-[11px] text-red-400">required</p>
            <p v-else-if="input.description" class="field-hint">{{ input.description }}</p>
            <p v-if="portClash(input)" class="mt-1 text-[11px] text-amber-300">
              <Icon name="alert" class="mr-1 inline h-3 w-3 align-[-1px]" /> host port {{ effective(input) }} is already published by “{{ portClash(input) }}”
            </p>
          </div>
        </div>

        <details class="mt-5 overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950/50">
          <summary class="cursor-pointer select-none px-3.5 py-2.5 text-xs font-medium text-slate-400 hover:text-slate-200">
            What will run: compose preview
          </summary>
          <pre class="max-h-72 overflow-auto border-t border-white/5 p-3 font-mono text-[11px] leading-relaxed text-slate-400">{{ app.compose }}</pre>
          <p class="border-t border-white/5 px-3 py-1.5 text-[10px] text-slate-600">
            <code v-pre>{{VAR}}</code> placeholders are filled from the form on install.
          </p>
        </details>

        <div class="mt-5 flex items-center gap-3">
          <button
            :disabled="installing || !installEnabled"
            class="btn btn-primary"
            @click="install"
          >{{ installing ? 'Installing…' : 'Install' }}</button>
          <span v-if="!installEnabled" class="text-xs text-slate-500">
            Turn on <b>Compose stack management</b> in Settings → Capabilities to install.
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

interface AppInputRow {
  name: string
  label: string
  description?: string
  default?: string
  required?: boolean
  preset?: boolean
  select?: { text: string; value: string }[]
}
interface CatalogAppFull {
  slug: string
  name: string
  description: string
  categories: string[]
  icon: string
  image: string
  source: string
  notes?: string
  inputs: AppInputRow[]
  compose: string
}
interface CatalogResponse {
  apps: CatalogAppFull[]
  installEnabled: boolean
}

const route = useRoute()
const slug = String(route.params.slug)

const app = ref<CatalogAppFull | null>(null)
const error = ref('')
const installEnabled = ref(false)
const stackName = ref('')
const values = reactive<Record<string, string>>({})
const publishedPorts = ref<Map<number, string>>(new Map())
// set when this app's image is already running here (installed = it's a stack).
// imageRepo (utils/image.ts) normalizes registry/tag/digest for the match.
const installedProject = ref<string | null>(null)
const installedServiceId = ref('')

async function load() {
  try {
    const res = await $fetch<CatalogResponse>('/api/catalog')
    installEnabled.value = res.installEnabled
    const found = res.apps.find((a) => a.slug === slug)
    if (!found) {
      error.value = 'This app is not in the catalog (the source may have changed).'
      return
    }
    app.value = found
    stackName.value = found.slug
    for (const i of found.inputs) values[i.name] = i.default ?? ''
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
    error.value = errMsg(e, 'Could not load the catalog')
  }
  // best-effort: current fleet ports, to warn about clashes before installing
  try {
    const svc = await $fetch<ServicesResponse>('/api/services')
    const map = new Map<number, string>()
    for (const s of svc.services) for (const p of s.ports ?? []) map.set(p.hostPort, s.name)
    publishedPorts.value = map
    // is this app already running here? match on image repo (ignore tag/digest)
    const repo = imageRepo(app.value?.image || '')
    const match = repo ? svc.services.find((s) => imageRepo(s.image) === repo) : undefined
    if (match) {
      installedProject.value = match.project
      installedServiceId.value = match.id
    }
  } catch {
    // warning only — never block the page on it
  }
}

const visibleInputs = computed(() => (app.value?.inputs ?? []).filter((i) => !i.preset))
const notesText = computed(() => (app.value?.notes ?? '').replace(/<[^>]+>/g, ''))

const effective = (input: AppInputRow) => values[input.name] || input.default || ''
function portClash(input: AppInputRow): string {
  if (!/PORT/i.test(input.name)) return ''
  const n = Number(effective(input))
  if (!Number.isInteger(n)) return ''
  return publishedPorts.value.get(n) ?? ''
}

// --- inline validation (mirrors the server's checks, but before the round-trip) ---
const attempted = ref(false)
const stackNameValid = computed(() => /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(stackName.value.trim()))
const isMissing = (input: AppInputRow) =>
  !!input.required && !input.select && !String(values[input.name] ?? '').trim() && !input.default
const formValid = computed(() => stackNameValid.value && !visibleInputs.value.some(isMissing))

// --- install + op streaming ---
const installing = ref(false)
const installError = ref('')
const installedAs = ref('')
const opLines = ref<string[]>([])
const opRunning = ref(false)
const opOk = ref<boolean | null>(null)
const opDropped = ref(false)
const following = ref(false)
let es: EventSource | null = null

// after a successful install, follow the containers to their new home
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
  if (!formValid.value) {
    installError.value = 'Fill the highlighted fields first.'
    return
  }
  installing.value = true
  installError.value = ''
  opLines.value = []
  opOk.value = null
  opDropped.value = false
  try {
    const res = await $fetch<{ stack: string; opId: string }>('/api/catalog/install', {
      method: 'POST',
      body: { slug, name: stackName.value.trim(), inputs: { ...values } },
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
      // A dropped stream isn't a failure — the op keeps running server-side.
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
useHead({ title: `${slug} · Catalog · homeport` })
</script>
