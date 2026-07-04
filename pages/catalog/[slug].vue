<template>
  <div class="mx-auto max-w-3xl px-5 py-8 sm:px-8 lg:px-10">
    <header class="mb-6 flex items-center gap-3">
      <NuxtLink to="/catalog" class="text-slate-400 hover:text-slate-200" aria-label="Back"><Icon name="arrow-left" class="h-[18px] w-[18px]" /></NuxtLink>
      <template v-if="app">
        <ServiceIcon :name="app.name" :icon="app.icon" :size="34" />
        <div>
          <h1 class="text-xl font-semibold text-slate-100">{{ app.name }}</h1>
          <div class="font-mono text-[11px] text-slate-600">{{ app.image }}</div>
        </div>
        <span
          v-for="c in app.categories"
          :key="c"
          class="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-500"
        >{{ c }}</span>
      </template>
    </header>

    <div v-if="error" class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">{{ error }}</div>
    <div v-else-if="!app" class="py-20 text-center text-slate-500">Loading…</div>

    <template v-else>
      <p class="mb-4 text-sm leading-relaxed text-slate-400">{{ app.description }}</p>
      <p v-if="app.notes" class="mb-4 rounded-lg border border-sky-400/15 bg-sky-400/5 px-4 py-3 text-xs leading-relaxed text-sky-200/80">
        {{ notesText }}
      </p>
      <div class="mb-6 text-xs text-slate-600">
        From <span class="font-mono text-slate-500">{{ app.source }}</span> — installs as a
        <NuxtLink to="/stacks" class="text-accent-light hover:underline">compose stack</NuxtLink> you can edit afterwards.
      </div>

      <!-- install form -->
      <div class="rounded-lg border border-white/10 bg-ink-900 p-5">
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Install</h2>

        <div class="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs text-slate-400">Stack name</label>
            <input
              v-model="stackName"
              class="w-full rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
            />
            <p class="mt-1 text-[11px] text-slate-600">Becomes the directory + compose project name.</p>
          </div>

          <div v-for="input in visibleInputs" :key="input.name">
            <label class="mb-1 block text-xs text-slate-400">
              {{ input.label }}<span v-if="input.required" class="text-red-400"> *</span>
            </label>
            <select
              v-if="input.select"
              v-model="values[input.name]"
              class="w-full rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
            >
              <option v-for="opt in input.select" :key="opt.value" :value="opt.value">{{ opt.text }}</option>
            </select>
            <input
              v-else
              v-model="values[input.name]"
              :type="/password|secret|token/i.test(input.name) ? 'password' : 'text'"
              :placeholder="input.default"
              class="w-full rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
            />
            <p v-if="input.description" class="mt-1 text-[11px] text-slate-600">{{ input.description }}</p>
            <p v-if="portClash(input)" class="mt-1 text-[11px] text-amber-300">
              <Icon name="alert" class="mr-1 inline h-3 w-3 align-[-1px]" /> host port {{ effective(input) }} is already published by “{{ portClash(input) }}”
            </p>
          </div>
        </div>

        <details class="mt-5 rounded-md border border-white/5 bg-ink-950/60">
          <summary class="cursor-pointer select-none px-3 py-2 text-xs text-slate-400 hover:text-slate-200">
            What will run — compose preview
          </summary>
          <pre class="max-h-72 overflow-auto border-t border-white/5 p-3 font-mono text-[11px] leading-relaxed text-slate-400">{{ app.compose }}</pre>
          <p class="border-t border-white/5 px-3 py-1.5 text-[10px] text-slate-600">
            <code v-pre>{{VAR}}</code> placeholders are filled from the form on install.
          </p>
        </details>

        <div class="mt-5 flex items-center gap-3">
          <button
            :disabled="installing || !installEnabled"
            class="rounded-md bg-accent px-4 py-2 text-xs font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-40"
            @click="install"
          >{{ installing ? 'Installing…' : 'Install' }}</button>
          <span v-if="!installEnabled" class="text-[11px] text-slate-500">
            enable <b>Compose stacks</b> in Settings → Capabilities to install
          </span>
          <span v-if="installError" class="whitespace-pre-line text-[11px] text-red-400">{{ installError }}</span>
        </div>
      </div>

      <!-- op output -->
      <div v-if="opLines.length || opRunning" class="mt-4 rounded-lg border border-white/5 bg-ink-950/60 p-3">
        <div class="mb-1 flex items-center gap-2 text-xs text-slate-500">
          <span class="h-1.5 w-1.5 rounded-full" :class="opRunning ? 'animate-pulse bg-amber-400' : opOk ? 'bg-ok' : 'bg-red-400'" />
          {{ opRunning ? 'installing…' : opOk ? 'installed' : 'failed' }}
        </div>
        <pre class="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">{{ opLines.join('\n') }}</pre>
        <div v-if="opOk" class="mt-3 flex gap-2 text-xs">
          <NuxtLink to="/" class="rounded-md border border-accent/30 px-3 py-1.5 text-accent-light hover:bg-accent/10">View on dashboard</NuxtLink>
          <NuxtLink :to="`/stacks/${installedAs}`" class="rounded-md border border-white/10 px-3 py-1.5 text-slate-300 hover:bg-white/5">Edit stack</NuxtLink>
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

// --- install + op streaming ---
const installing = ref(false)
const installError = ref('')
const installedAs = ref('')
const opLines = ref<string[]>([])
const opRunning = ref(false)
const opOk = ref<boolean | null>(null)
let es: EventSource | null = null

async function install() {
  installing.value = true
  installError.value = ''
  opLines.value = []
  opOk.value = null
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
        }
      } catch {}
    }
    es.onerror = () => {
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
useHead({ title: `${slug} — catalog — homeport` })
</script>
