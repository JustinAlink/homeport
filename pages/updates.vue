<template>
  <div class="page">
    <PageHeader title="Updates">
      <template #subtitle>
        {{ updatable.length ? `${updatable.length} container${updatable.length > 1 ? 's have' : ' has'} a newer image available` : 'Image update status across the fleet' }}<template v-if="newerList.length"> · {{ newerList.length }} newer version{{ newerList.length > 1 ? 's' : '' }} out</template><template v-if="lastChecked"> · last checked {{ lastChecked }}</template>
      </template>
      <template #actions>
        <button
          v-if="updates.enabled.value"
          :disabled="checking || !!busyGroup"
          class="btn"
          @click="checkNow"
        ><Icon name="refresh" :class="checking ? 'animate-spin' : ''" /> {{ checking ? 'Checking…' : 'Check now' }}</button>
        <button
          v-if="runnableGroups.length > 1"
          :disabled="!!busyGroup || bulkRunning"
          class="btn btn-primary"
          @click="updateEverything"
        ><Icon name="download" /> {{ bulkRunning ? 'Updating…' : `Update everything (${runnableCount})` }}</button>
      </template>
    </PageHeader>

    <div v-if="!updates.enabled.value && !caps.updates" class="card">
      <EmptyState icon="arrow-up" title="Update checks are off">
        Turn on <em>Check for image updates</em> in Settings and homeport compares every running image with its registry once a day.
        <template #actions><NuxtLink to="/settings?tab=capabilities" class="btn btn-primary btn-sm">Open Settings → Capabilities</NuxtLink></template>
      </EmptyState>
    </div>

    <div v-else-if="!svcData" class="space-y-3"><div v-for="i in 3" :key="i" class="card h-28" /></div>

    <template v-else>
      <!-- all clear -->
      <div v-if="!groups.length" class="card">
        <EmptyState icon="check" title="Every image is up to date">
          Containers are checked against their registries daily. “Check now” forces a sweep.<template v-if="newerList.length"> Newer versions of pinned images are listed below.</template>
        </EmptyState>
      </div>

      <div class="space-y-4">
        <!-- groups with pending updates, plus finished stack operations whose group
             has no updates left (their result stays until dismissed) -->
        <section v-for="g in shownGroups" :key="g.key" class="card overflow-hidden">
          <div class="card-header">
            <component
              :is="g.project ? NuxtLinkC : 'h2'"
              v-bind="g.project ? { to: `/stacks/${encodeURIComponent(g.project)}` } : {}"
              class="text-[14.5px] font-semibold text-slate-100"
              :class="g.project ? 'hover:text-accent-light' : ''"
            >{{ g.label }}</component>
            <span v-if="g.managed" class="badge badge-accent" title="Managed compose stack: updates run through docker compose">stack</span>
            <span v-else-if="g.project" class="badge" title="Compose project homeport can't see the files of: containers are recreated in place">unmanaged</span>
            <span v-if="g.services.length" class="text-xs text-slate-500">{{ g.services.length }} update{{ g.services.length > 1 ? 's' : '' }}</span>

            <div v-if="g.services.length" class="ml-auto flex items-center gap-2">
              <label
                v-if="autoLoaded && caps.updates && g.project"
                class="check items-center rounded-md px-2 py-1 text-xs hover:bg-white/[0.04]"
                :class="isAuto(g.project) ? 'text-ok' : 'text-slate-400'"
                :title="autoEnabled ? 'Include this stack in the daily automatic update' : 'Saved now; takes effect once automatic updates are turned on in Settings → Updates'"
              >
                <input type="checkbox" class="!mt-0" :checked="isAuto(g.project)" @change="toggleAuto(g.project!)" />
                Auto-update
              </label>
              <button
                v-if="g.managed"
                :disabled="!!busyGroup"
                class="btn btn-sm btn-accent"
                @click="pullStack(g)"
              ><Icon name="download" /> {{ busyGroup === g.key ? 'Pulling…' : 'Pull & up' }}</button>
              <button
                v-else-if="caps.updates"
                :disabled="!!busyGroup"
                class="btn btn-sm btn-accent"
                @click="updateGroup(g)"
              ><Icon name="arrow-up" /> {{ busyGroup === g.key ? 'Updating…' : g.services.length > 1 ? `Update all (${g.services.length})` : 'Update' }}</button>
            </div>
          </div>

          <div class="row-list">
            <div v-for="s in g.services" :key="s.id" class="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <ServiceIcon :name="s.displayName" :icon="s.icon" :size="28" :remote="svcData?.remoteIcons ?? true" />
              <NuxtLink :to="`/services/${encodeURIComponent(s.id)}?tab=update`" class="group min-w-0 flex-1">
                <span class="block truncate text-[13.5px] font-medium text-slate-100 group-hover:text-accent-light">{{ s.displayName }}</span>
                <span class="block truncate font-mono text-[11px] text-slate-500">{{ s.image }}</span>
                <span
                  class="mt-0.5 block truncate text-[11.5px]"
                  :class="kindOf(s).tone === 'caution' ? 'text-amber-300' : kindOf(s).tone === 'low' ? 'text-ok' : 'text-slate-400'"
                  :title="kindOf(s).detail"
                >{{ kindOf(s).title }}</span>
              </NuxtLink>
              <span
                v-if="rowNote[s.id]"
                class="shrink-0 text-xs"
                :class="rowNote[s.id].startsWith('failed') ? 'text-red-400' : rowNote[s.id] === 'updated' ? 'text-ok' : 'text-slate-400'"
              >{{ rowNote[s.id] }}</span>
              <a
                v-if="updates.changelogUrlFor(s)"
                :href="updates.changelogUrlFor(s)"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-ghost btn-sm shrink-0"
                @click.stop
              >Changelog <Icon name="external" /></a>
              <label
                v-if="autoLoaded && caps.updates && !g.project"
                class="check shrink-0 items-center rounded-md px-2 py-1 text-xs hover:bg-white/[0.04]"
                :class="isAuto(s.name) ? 'text-ok' : 'text-slate-400'"
                :title="autoEnabled ? 'Include this container in the daily automatic update' : 'Saved now; takes effect once automatic updates are turned on in Settings → Updates'"
              >
                <input type="checkbox" class="!mt-0" :checked="isAuto(s.name)" @change="toggleAuto(s.name)" />
                Auto-update
              </label>
            </div>
          </div>

          <!-- this group's stack operation: live output, then its result until dismissed -->
          <div v-if="results[g.key]" class="border-t border-white/[0.06]">
            <div class="flex items-center gap-2 px-4 py-2 text-[12.5px] font-medium sm:px-5" :class="RESULT_TONE[results[g.key].state]">
              <Icon
                :name="results[g.key].state === 'running' ? 'refresh' : results[g.key].state === 'ok' ? 'check' : 'alert'"
                class="h-3.5 w-3.5 shrink-0"
                :class="results[g.key].state === 'running' ? 'animate-spin' : ''"
              />
              {{ RESULT_TEXT[results[g.key].state] }}
              <button
                v-if="results[g.key].state !== 'running'"
                class="btn btn-ghost btn-icon btn-sm ml-auto"
                aria-label="Dismiss output"
                @click="dismissResult(g.key)"
              ><Icon name="x" /></button>
            </div>
            <pre
              v-if="results[g.key].lines.length"
              class="max-h-48 overflow-y-auto whitespace-pre-wrap bg-ink-950/60 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-slate-300"
            >{{ results[g.key].lines.join('\n') }}</pre>
          </div>
        </section>
      </div>

      <!-- newer versions: tags that don't move on their own (10.9.6 → 10.10.3) -->
      <section v-if="newerList.length" class="mt-6">
        <div class="mb-2 flex items-baseline gap-2">
          <h2 class="text-[14.5px] font-semibold text-slate-100">Newer versions</h2>
          <span class="text-xs text-slate-500">{{ newerList.length }}</span>
        </div>
        <p class="mb-3 max-w-3xl text-xs leading-relaxed text-slate-500">
          These containers are pinned to a version (or a version line like <code>16-alpine</code>), so a newer one never
          arrives by itself: switching is your call. Patch and minor steps are usually safe, a
          <span class="text-amber-300">major</span> one deserves a look at the changelog first. A digest pin also misses
          rebuilds of its own version; those show as <span class="text-ok">rebuilt</span>. Where a stack is managed
          elsewhere, "Copy pin" gives the exact line to paste there.
        </p>
        <div class="card overflow-hidden">
          <div class="row-list">
            <div v-for="s in newerList" :key="s.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:flex-nowrap sm:px-5">
              <ServiceIcon :name="s.displayName" :icon="s.icon" :size="28" :remote="svcData?.remoteIcons ?? true" />
              <div class="min-w-0 flex-1">
                <NuxtLink :to="`/services/${encodeURIComponent(s.id)}?tab=update`" class="group block min-w-0">
                  <span class="block truncate text-[13.5px] font-medium text-slate-100 group-hover:text-accent-light">
                    {{ s.displayName }}<span v-if="s.project" class="font-normal text-slate-500"> · {{ s.project }}</span>
                  </span>
                  <span class="block truncate font-mono text-[11px] text-slate-500">{{ s.image }}</span>
                </NuxtLink>
                <a
                  v-if="updates.changelogUrlFor(s)"
                  :href="updates.changelogUrlFor(s)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="link inline-flex items-center gap-1 text-[11.5px]"
                >Changelog <Icon name="external" class="h-3 w-3" /></a>
              </div>
              <VersionOffer :service="s" :entry="updates.entryFor(s)" compact class="w-full pl-10 sm:w-auto sm:shrink-0 sm:pl-0" />
            </div>
          </div>
        </div>
      </section>

      <!-- check errors -->
      <details v-if="checkErrors.length" class="card mt-6 px-4 py-3 text-xs">
        <summary class="cursor-pointer text-amber-300">{{ checkErrors.length }} image{{ checkErrors.length > 1 ? 's' : '' }} could not be checked</summary>
        <div class="mt-2 space-y-1">
          <p v-for="e in checkErrors" :key="e.image" class="truncate font-mono text-slate-500">
            <span class="text-slate-300">{{ e.image }}</span> · {{ e.error }}
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
const { confirm } = useConfirm()
const toast = useToast()
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

const kindOf = (s: Service) => explainUpdate(s.image, updates.entryFor(s)?.tagKind)

// containers with a newer version tag: the safe steps first, majors last
const BUMP_ORDER = { patch: 0, minor: 1, major: 2 } as const
const newerList = computed(() =>
  (svcData.value?.services ?? [])
    .filter((s) => s.kind === 'container' && (updates.entryFor(s)?.newer || updates.entryFor(s)?.rebuilt))
    .sort(
      (a, b) =>
        BUMP_ORDER[updates.entryFor(a)!.newer?.bump ?? 'patch'] - BUMP_ORDER[updates.entryFor(b)!.newer?.bump ?? 'patch'] ||
        a.displayName.localeCompare(b.displayName),
    ),
)

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
const rowNote = ref<Record<string, string>>({})
let es: EventSource | null = null

// A stack's "Pull & up" result is kept per group until dismissed. A success
// removes the group from the update list (nothing left to update), and a
// failure must stay readable after the operation ends, not vanish with it.
// 'unknown': the event stream dropped. The op keeps running server-side; its outcome went unseen.
type OpState = 'running' | 'ok' | 'failed' | 'unknown'
interface GroupResult { label: string; project: string | null; state: OpState; lines: string[] }
const results = ref<Record<string, GroupResult>>({})
const RESULT_TEXT: Record<OpState, string> = {
  running: 'Pulling and redeploying…',
  ok: 'Pulled and redeployed',
  failed: 'Failed',
  unknown: 'Lost the connection to the operation. It may still be running; reload to check.',
}
const RESULT_TONE: Record<OpState, string> = { running: 'text-slate-200', ok: 'text-ok', failed: 'text-red-300', unknown: 'text-amber-300' }
function dismissResult(key: string) {
  delete results.value[key]
}
const shownGroups = computed<Group[]>(() => {
  const live = new Set(groups.value.map((g) => g.key))
  const finished = Object.entries(results.value)
    .filter(([k]) => !live.has(k))
    .map(([key, r]) => ({ key, label: r.label, project: r.project, managed: true, services: [] }))
  return [...groups.value, ...finished]
})

async function pullStack(g: Group, ask = true): Promise<OpState | null> {
  if (ask && !(await confirm({ message: `Pull new images and redeploy stack “${g.project}”?`, confirmLabel: 'Pull & up' }))) return null
  busyGroup.value = g.key
  results.value[g.key] = { label: g.label, project: g.project, state: 'running', lines: [] }
  const res = results.value[g.key]
  try {
    const { opId } = await $fetch<{ opId: string }>(`/api/stacks/${encodeURIComponent(g.project!)}/action`, {
      method: 'POST',
      body: { op: 'pull' },
    })
    es?.close()
    res.state = await new Promise<OpState>((resolve) => {
      es = new EventSource(`/api/ops/${opId}`)
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.line !== undefined) res.lines.push(msg.line)
          if (msg.done) {
            es?.close()
            resolve(msg.ok ? 'ok' : 'failed')
          }
        } catch {}
      }
      es.onerror = () => {
        es?.close()
        resolve('unknown')
      }
    })
  } catch (e: any) {
    res.lines.push(errMsg(e, 'could not start the operation'))
    res.state = 'failed'
  } finally {
    busyGroup.value = ''
    svcRefresh()
    updates.refresh()
  }
  return res.state
}

async function updateGroup(g: Group, ask = true): Promise<OpState | null> {
  const n = g.services.length
  if (ask && !(await confirm({ message: `Update ${n} container${n > 1 ? 's' : ''}${g.project ? ` in “${g.project}”` : ''}? Each is pulled and recreated in place.`, confirmLabel: 'Update' }))) return null
  busyGroup.value = g.key
  let failed = false
  for (const s of g.services) {
    rowNote.value[s.id] = 'updating…'
    try {
      await $fetch('/api/updates/apply', { method: 'POST', body: { id: s.id, image: s.image } })
      rowNote.value[s.id] = 'updated'
    } catch (e: any) {
      failed = true
      rowNote.value[s.id] = `failed: ${errMsg(e, 'update failed')}` // stays: the row keeps its update
    }
  }
  busyGroup.value = ''
  await Promise.all([svcRefresh(), updates.refresh()])
  return failed ? 'failed' : 'ok'
}

// --- update everything: every group in turn, one confirmation up front ---
const runnableGroups = computed(() => groups.value.filter((g) => g.managed || caps.value.updates))
const runnableCount = computed(() => runnableGroups.value.reduce((n, g) => n + g.services.length, 0))
const bulkRunning = ref(false)
async function updateEverything() {
  const gs = [...runnableGroups.value]
  if (!gs.length) return
  const stacks = gs.filter((g) => g.managed).length
  if (
    !(await confirm({
      title: `Update ${runnableCount.value} containers?`,
      message: `Managed stacks are pulled and redeployed with compose${stacks ? ` (${stacks})` : ''}; other containers are pulled and recreated in place, one group at a time.`,
      confirmLabel: 'Update everything',
    }))
  )
    return
  bulkRunning.value = true
  try {
    const states: (OpState | null)[] = []
    for (const g of gs) states.push(g.managed ? await pullStack(g, false) : await updateGroup(g, false))
    // "applied" only when every group says so; otherwise say how many did not
    const failed = states.filter((s) => s === 'failed').length
    const unknown = states.filter((s) => s === 'unknown').length
    if (!failed && !unknown) toast.success('Updates applied')
    else {
      const parts = [failed ? `${failed} failed` : '', unknown ? `${unknown} lost the connection (may still be running)` : ''].filter(Boolean)
      toast.error(`Updates finished with problems: ${parts.join(', ')}, out of ${gs.length}. Details are on this page.`)
    }
  } finally {
    bulkRunning.value = false
  }
}

// --- auto-update opt-in toggles (persisted in settings.autoUpdateTargets) ---
const autoTargets = ref<string[]>([])
const autoEnabled = ref(false)
const autoLoaded = ref(false)
async function loadAuto() {
  try {
    const r = await $fetch<{ settings: { autoUpdateTargets?: string[]; autoUpdateEnabled?: boolean } }>('/api/settings')
    autoTargets.value = r.settings.autoUpdateTargets ?? []
    autoEnabled.value = !!r.settings.autoUpdateEnabled
    autoLoaded.value = true
  } catch {
    // settings unreadable — just hide the toggles
  }
}
const isAuto = (name: string) => autoTargets.value.includes(name)
async function toggleAuto(name: string) {
  const prev = autoTargets.value
  autoTargets.value = isAuto(name) ? prev.filter((t) => t !== name) : [...prev, name]
  try {
    await $fetch('/api/settings', { method: 'POST', body: { autoUpdateTargets: autoTargets.value } })
  } catch (e: any) {
    autoTargets.value = prev
    toast.error(errMsg(e, 'could not save the auto-update setting'))
  }
}

// --- check now ---
const checking = ref(false)
async function checkNow() {
  checking.value = true
  try {
    await $fetch('/api/updates/check', { method: 'POST' })
    await updates.refresh()
  } catch (e: any) {
    toast.error(errMsg(e, 'Check failed'))
  } finally {
    checking.value = false
  }
}

onMounted(async () => {
  svcStart()
  await loadCaps()
  loadStacks()
  loadAuto()
  updates.refresh()
})
onBeforeUnmount(() => {
  svcStop()
  es?.close()
})

useHead({ title: 'Updates · homeport' })
</script>
