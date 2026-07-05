<template>
  <div class="mx-auto max-w-[1100px] px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-6 flex flex-wrap items-center gap-3">
      <div>
        <h1 class="text-xl font-semibold text-slate-100">Updates</h1>
        <p class="mt-1 text-[13px] text-slate-500">
          {{ updatable.length ? `${updatable.length} container${updatable.length > 1 ? 's' : ''} with a newer image` : 'image update status across the fleet' }}
          <template v-if="lastChecked"> · last checked {{ lastChecked }}</template>
        </p>
      </div>
      <button
        v-if="updates.enabled.value"
        :disabled="checking || !!busyGroup"
        class="ml-auto rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
        @click="checkNow"
      >{{ checking ? 'Checking…' : 'Check now' }}</button>
    </header>

    <div v-if="!updates.enabled.value && !caps.updates" class="rounded-lg border border-white/5 bg-ink-900 p-8 text-center text-sm text-slate-500">
      Update checks are disabled — enable them in
      <NuxtLink to="/settings#capabilities" class="text-accent-light hover:underline">Settings → Capabilities</NuxtLink>.
    </div>

    <div v-else-if="!svcData" class="py-20 text-center text-slate-500">Loading…</div>

    <template v-else>
      <!-- all clear -->
      <div v-if="!groups.length" class="rounded-lg border border-white/5 bg-ink-900 p-10 text-center">
        <Icon name="check" class="mx-auto h-8 w-8 text-ok" />
        <p class="mt-3 text-sm text-slate-200">Everything is up to date.</p>
        <p class="mt-1 text-xs text-slate-500">Containers are checked against their registries daily; “Check now” forces a sweep.</p>
      </div>

      <!-- groups with pending updates -->
      <div v-for="g in groups" :key="g.key" class="mb-4 rounded-xl border border-white/10 bg-ink-900 p-4">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <component
            :is="g.project ? NuxtLinkC : 'h2'"
            v-bind="g.project ? { to: `/stacks/${encodeURIComponent(g.project)}` } : {}"
            class="text-sm font-semibold text-slate-100"
            :class="g.project ? 'hover:text-accent-light' : ''"
          >{{ g.label }}</component>
          <span
            v-if="g.managed"
            class="rounded-full border border-accent/30 px-1.5 py-px text-[10px] uppercase tracking-wider text-accent-light"
            title="Managed compose stack — updates run through docker compose"
          >stack</span>
          <span v-else-if="g.project" class="rounded-full border border-white/10 px-1.5 py-px text-[10px] uppercase tracking-wider text-slate-500">unmanaged</span>
          <span class="text-xs text-slate-600">{{ g.services.length }} update{{ g.services.length > 1 ? 's' : '' }}</span>

          <div class="ml-auto">
            <button
              v-if="g.managed"
              :disabled="!!busyGroup"
              class="inline-flex items-center gap-1.5 rounded-md border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-xs text-sky-300 hover:bg-sky-400/20 disabled:opacity-40"
              @click="pullStack(g)"
            ><Icon name="download" class="h-3.5 w-3.5" /> {{ busyGroup === g.key ? 'Pulling…' : 'Pull & up' }}</button>
            <button
              v-else-if="caps.updates"
              :disabled="!!busyGroup"
              class="inline-flex items-center gap-1.5 rounded-md border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-xs text-sky-300 hover:bg-sky-400/20 disabled:opacity-40"
              @click="updateGroup(g)"
            ><Icon name="arrow-up" class="h-3.5 w-3.5" /> {{ busyGroup === g.key ? 'Updating…' : g.services.length > 1 ? `Update all (${g.services.length})` : 'Update' }}</button>
          </div>
        </div>

        <div class="space-y-1.5">
          <div v-for="s in g.services" :key="s.id" class="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-950/50 px-3 py-2">
            <ServiceIcon :name="s.displayName" :icon="s.icon" :size="26" :remote="svcData?.remoteIcons ?? true" />
            <NuxtLink :to="`/services/${encodeURIComponent(s.id)}`" class="min-w-0 flex-1">
              <span class="block truncate text-sm text-slate-200 hover:text-accent-light">{{ s.displayName }}</span>
              <span class="block truncate font-mono text-[11px] text-slate-600">{{ s.image }}</span>
            </NuxtLink>
            <span v-if="rowNote[s.id]" class="shrink-0 text-[11px]" :class="rowNote[s.id].startsWith('failed') ? 'text-red-400' : 'text-slate-500'">{{ rowNote[s.id] }}</span>
          </div>
        </div>

        <!-- live output for this group's operation -->
        <div v-if="busyGroup === g.key && opLines.length" class="mt-3 rounded-lg border border-white/5 bg-ink-950/60 p-3">
          <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">{{ opLines.join('\n') }}</pre>
        </div>
      </div>

      <!-- check errors -->
      <details v-if="checkErrors.length" class="mt-6 rounded-lg border border-amber-500/15 bg-amber-500/5 p-3 text-xs">
        <summary class="cursor-pointer text-amber-300">{{ checkErrors.length }} image{{ checkErrors.length > 1 ? 's' : '' }} could not be checked</summary>
        <div class="mt-2 space-y-1">
          <p v-for="e in checkErrors" :key="e.image" class="truncate font-mono text-slate-500">
            <span class="text-slate-300">{{ e.image }}</span> — {{ e.error }}
          </p>
        </div>
      </details>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'
import { NuxtLink as NuxtLinkC } from '#components'

const { data: svcData, refresh: svcRefresh, start: svcStart, stop: svcStop } = useServices()
const updates = useUpdates()
const { caps, load: loadCaps } = useCapabilities()

// managed stack names (homeport has a compose file for these)
const managedStacks = ref<Set<string>>(new Set())
async function loadStacks() {
  if (!caps.value.stacks) return
  try {
    const r = await $fetch<{ stacks: { name: string }[] }>('/api/stacks')
    managedStacks.value = new Set((r.stacks ?? []).map((s) => s.name))
  } catch {
    managedStacks.value = new Set()
  }
}

const updatable = computed(() =>
  (svcData.value?.services ?? []).filter((s) => updates.entryFor(s)?.status === 'update'),
)

interface Group { key: string; label: string; project: string | null; managed: boolean; services: Service[] }
const groups = computed<Group[]>(() => {
  const by = new Map<string, Service[]>()
  for (const s of updatable.value) {
    const k = s.project ?? '::standalone'
    by.set(k, [...(by.get(k) ?? []), s])
  }
  return [...by.entries()]
    .map(([k, services]) => {
      const project = k === '::standalone' ? null : k
      return {
        key: k,
        label: project ?? 'Standalone containers',
        project,
        managed: !!project && managedStacks.value.has(project),
        services,
      }
    })
    .sort((a, b) => Number(b.managed) - Number(a.managed) || a.label.localeCompare(b.label))
})

const checkErrors = computed(() =>
  Object.entries(updates.entries.value)
    .filter(([, e]) => e.status === 'error')
    .map(([k, e]) => ({ image: k.slice(k.indexOf('|') + 1), error: e.error || 'check failed' })),
)

const lastChecked = computed(() => {
  const times = Object.values(updates.entries.value).map((e) => e.checkedAt).filter(Boolean)
  if (!times.length) return ''
  const d = new Date(Math.max(...times))
  return d.toLocaleString()
})

// --- actions (one group at a time) ---
const busyGroup = ref('')
const opLines = ref<string[]>([])
const rowNote = ref<Record<string, string>>({})
let es: EventSource | null = null

async function pullStack(g: Group) {
  if (!window.confirm(`Pull new images and redeploy stack “${g.project}”?`)) return
  busyGroup.value = g.key
  opLines.value = []
  try {
    const { opId } = await $fetch<{ opId: string }>(`/api/stacks/${encodeURIComponent(g.project!)}/action`, {
      method: 'POST',
      body: { op: 'pull' },
    })
    es?.close()
    es = new EventSource(`/api/ops/${opId}`)
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.line !== undefined) opLines.value.push(msg.line)
        if (msg.done) finishOp()
      } catch {}
    }
    es.onerror = () => finishOp()
  } catch (e: any) {
    opLines.value.push(errMsg(e, 'could not start the operation'))
    busyGroup.value = ''
  }
}

function finishOp() {
  es?.close()
  busyGroup.value = ''
  svcRefresh()
  updates.refresh()
}

async function updateGroup(g: Group) {
  const n = g.services.length
  if (!window.confirm(`Update ${n} container${n > 1 ? 's' : ''}${g.project ? ` in “${g.project}”` : ''}? Each is pulled and recreated in place.`)) return
  busyGroup.value = g.key
  opLines.value = []
  for (const s of g.services) {
    rowNote.value[s.id] = 'updating…'
    try {
      await $fetch('/api/updates/apply', { method: 'POST', body: { id: s.id, image: s.image } })
      rowNote.value[s.id] = 'updated'
    } catch (e: any) {
      rowNote.value[s.id] = `failed — ${errMsg(e, 'update failed')}`
    }
  }
  busyGroup.value = ''
  await Promise.all([svcRefresh(), updates.refresh()])
}

// --- check now ---
const checking = ref(false)
async function checkNow() {
  checking.value = true
  try {
    await $fetch('/api/updates/check', { method: 'POST' })
    await updates.refresh()
  } catch (e: any) {
    window.alert(errMsg(e, 'Check failed'))
  } finally {
    checking.value = false
  }
}

onMounted(async () => {
  svcStart()
  await loadCaps()
  loadStacks()
  updates.refresh()
})
onBeforeUnmount(() => {
  svcStop()
  es?.close()
})

useHead({ title: 'Updates — homeport' })
</script>
