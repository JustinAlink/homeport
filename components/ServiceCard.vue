<template>
  <!-- ROW (list view) -->
  <div
    v-if="layout === 'row'"
    class="group relative flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.025] sm:px-4"
    :class="dim ? 'text-slate-400' : ''"
    @click="openPage"
  >
    <div class="relative shrink-0" :class="dim ? 'opacity-60' : ''">
      <ServiceIcon :name="service.displayName" :icon="service.icon" :size="30" :remote="remoteIcons" />
    </div>
    <div class="min-w-0 flex-1 sm:w-0 sm:flex-[1.4]">
      <div class="flex items-center gap-2">
        <component :is="nameTag" v-bind="nameAttrs" class="truncate text-[13.5px] font-medium" :class="dim ? 'text-slate-300' : 'text-slate-100'">{{ service.displayName }}</component>
        <NuxtLink v-if="updateAvailable" :to="updateLink" class="badge badge-info h-[18px] px-1 text-[10px]" title="Update available"><Icon name="arrow-up" class="h-2.5 w-2.5" :weight="2.4" />update</NuxtLink>
      </div>
      <div class="truncate font-mono text-[11px] text-slate-500" :title="service.image">{{ service.image }}</div>
    </div>
    <div class="hidden w-36 shrink-0 md:block">
      <StatusPill :state="service.state" :health="service.health" :text="statusShort" compact />
    </div>
    <div class="hidden min-w-0 flex-1 items-center gap-1.5 lg:flex">
      <a
        v-if="service.domains[0]"
        :href="service.domains[0].url"
        target="_blank"
        rel="noopener noreferrer"
        class="chip chip-accent min-w-0 max-w-full"
        @click.stop
      >
        <span v-if="pings[service.domains[0].url]" class="dot h-1.5 w-1.5" :class="pingClass(service.domains[0].url)" :title="pingTitle(service.domains[0].url)" />
        <span class="truncate">{{ service.domains[0].domain }}</span>
      </a>
      <span v-else-if="service.ports[0]" class="chip font-mono">:{{ service.ports[0].hostPort }}</span>
      <span v-if="service.domains.length > 1" class="text-[11px] text-slate-500">+{{ service.domains.length - 1 }}</span>
    </div>
    <div class="hidden w-[150px] shrink-0 items-center justify-end gap-3 font-mono text-[11.5px] tabular-nums text-slate-400 sm:flex">
      <template v-if="stat && service.state === 'running'">
        <span class="w-14 text-right" title="CPU">{{ stat.cpuPercent != null ? stat.cpuPercent + '%' : '·' }}</span>
        <span class="w-[70px] text-right" title="Memory">{{ formatBytes(stat.memBytes) }}</span>
      </template>
      <span v-else class="text-slate-600">·</span>
    </div>
    <div class="hidden h-7 w-24 shrink-0 xl:block">
      <Sparkline v-if="cpuHistory.length > 1 && service.state === 'running'" :data="cpuHistory" color="#10b981" />
    </div>
    <span class="md:hidden"><StatusPill :state="service.state" :health="service.health" compact dot-only /></span>
    <div class="flex w-[104px] shrink-0 justify-end opacity-100 transition-opacity pointer-fine:opacity-60 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
      <ServiceActions
        :service="service"
        :busy="busy"
        :control-enabled="controlEnabled"
        @logs="showLogs = true"
        @control="control"
      />
    </div>
    <LogsPanel v-if="showLogs" :id="service.id" :name="service.displayName" @close="showLogs = false" />
  </div>

  <!-- CARD (grid view) -->
  <div
    v-else
    class="card group relative flex cursor-pointer flex-col px-4 py-3.5 transition-[border-color,background-color] duration-150 hover:border-white/[0.16]"
    :class="dim ? 'bg-ink-900/60' : ''"
    @click="openPage"
  >
    <div class="flex items-start gap-3">
      <div class="relative shrink-0" :class="dim ? 'opacity-55 grayscale' : ''">
        <div class="grid h-10 w-10 place-items-center rounded-[10px] bg-white/[0.04] ring-1 ring-inset ring-white/[0.06]">
          <ServiceIcon :name="service.displayName" :icon="service.icon" :size="26" :remote="remoteIcons" />
        </div>
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <component :is="nameTag" v-bind="nameAttrs" class="truncate text-[14.5px] font-semibold tracking-[-0.005em]" :class="dim ? 'text-slate-300' : 'text-slate-100'">{{ service.displayName }}</component>
          <NuxtLink
            v-if="updateAvailable"
            :to="updateLink"
            class="badge badge-info h-[18px] px-1 text-[10px]"
            title="A newer image is available"
            @click.stop
          ><Icon name="arrow-up" class="h-2.5 w-2.5" :weight="2.4" />update</NuxtLink>
        </div>
        <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500" :title="service.image">{{ service.image }}</div>
      </div>

      <div class="relative flex h-7 shrink-0 items-center">
        <span class="transition-opacity" :class="hasActions ? 'pointer-fine:group-hover:opacity-0 pointer-fine:group-focus-within:opacity-0' : ''">
          <StatusPill :state="service.state" :health="service.health" :text="statusShort" compact />
        </span>
        <!-- mouse: actions replace the status on hover; keyboard: on focus -->
        <div
          v-if="hasActions"
          class="pointer-events-none absolute right-0 top-0 flex rounded-lg bg-ink-900 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 pointer-coarse:hidden pointer-fine:group-hover:pointer-events-auto pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:pointer-events-auto pointer-fine:group-focus-within:opacity-100"
        >
          <ServiceActions
            :service="service"
            :busy="busy"
            :control-enabled="controlEnabled"
            @logs="showLogs = true"
            @control="control"
          />
        </div>
      </div>
    </div>

    <!-- domains + ports -->
    <div v-if="service.domains.length || service.ports.length" class="mt-3 flex flex-wrap items-center gap-1.5">
      <a
        v-for="d in service.domains"
        :key="d.domain"
        :href="d.url"
        target="_blank"
        rel="noopener noreferrer"
        class="chip chip-accent max-w-full"
        :title="unreachable && d.via === 'name' ? `${reachApi.proxy.value?.displayName} can't reach this container (no shared network)` : pingTitle(d.url) || d.url"
        @click.stop
      >
        <Icon v-if="unreachable && d.via === 'name'" name="alert" class="h-3 w-3 text-amber-400" />
        <span v-else-if="pings[d.url]" class="dot h-1.5 w-1.5" :class="pingClass(d.url)" />
        <Icon v-else-if="d.ssl" name="lock" class="h-3 w-3 opacity-70" />
        <span class="truncate">{{ d.domain }}</span>
      </a>
      <a
        v-for="pt in service.ports"
        :key="pt.hostPort + pt.type"
        :href="`http://${host}:${pt.hostPort}`"
        target="_blank"
        rel="noopener noreferrer"
        class="chip font-mono text-[11px] text-slate-400"
        :title="`host port ${pt.hostPort} → container ${pt.containerPort}/${pt.type}`"
        @click.stop
      >:{{ pt.hostPort }}</a>
    </div>

    <!-- metrics: compact bars + a CPU trend -->
    <div v-if="stat && service.state === 'running'" class="mt-auto flex items-end gap-4 pt-3.5">
      <div class="grid min-w-0 flex-1 grid-cols-2 gap-4">
        <div class="min-w-0">
          <div class="flex items-baseline justify-between text-[11px]">
            <span class="text-slate-500">CPU</span>
            <span class="font-mono tabular-nums text-slate-300">{{ stat.cpuPercent != null ? stat.cpuPercent + '%' : '·' }}</span>
          </div>
          <div class="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div class="h-full rounded-full bg-ok transition-all duration-500" :style="{ width: barW(stat.cpuPercent) }" />
          </div>
        </div>
        <div class="min-w-0">
          <div class="flex items-baseline justify-between text-[11px]">
            <span class="text-slate-500">RAM</span>
            <span class="font-mono tabular-nums text-slate-300">{{ formatBytes(stat.memBytes) }}</span>
          </div>
          <div class="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div class="h-full rounded-full bg-sky-400 transition-all duration-500" :style="{ width: barW(stat.memPercent) }" />
          </div>
        </div>
      </div>
      <div v-if="cpuHistory.length > 1" class="h-7 w-20 shrink-0" title="CPU trend">
        <Sparkline :data="cpuHistory" color="#10b981" fill />
      </div>
    </div>
    <!-- non-running: the status text carries the info -->
    <p v-else-if="service.state !== 'running'" class="mt-3 truncate text-xs text-slate-500">{{ service.statusText }}</p>

    <!-- touch screens have no hover: the same actions as a visible row -->
    <div v-if="hasActions" class="-mb-1 mt-2.5 hidden justify-end border-t border-white/[0.06] pt-1.5 pointer-coarse:flex">
      <ServiceActions
        :service="service"
        :busy="busy"
        :control-enabled="controlEnabled"
        @logs="showLogs = true"
        @control="control"
      />
    </div>

    <LogsPanel v-if="showLogs" :id="service.id" :name="service.displayName" @close="showLogs = false" />
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

const props = withDefaults(defineProps<{ service: Service; layout?: 'card' | 'row' }>(), { layout: 'card' })
const host = computed(() => (import.meta.client ? window.location.hostname : 'localhost'))
const showLogs = ref(false)
// "Up 5 days (healthy)" → "Up 5 days": the dot already says healthy
const statusShort = computed(() => props.service.statusText.replace(/\s*\(healthy\)/, '').replace(/\s*\(\d+\)\s.*$/, ''))
const barW = (v: number | null | undefined) => `${Math.min(100, Math.max(2, v ?? 0))}%`
const dim = computed(() => props.service.state !== 'running' && props.service.state !== 'restarting' && props.service.kind === 'container')

const pageLink = computed(() => `/services/${encodeURIComponent(props.service.id)}`)
const updateLink = computed(() => `${pageLink.value}?tab=update`)
const isContainer = computed(() => props.service.kind === 'container')
const nameTag = computed(() => (isContainer.value ? resolveComponent('NuxtLink') : 'span'))
const nameAttrs = computed(() => (isContainer.value ? { to: pageLink.value, onClick: (e: Event) => e.stopPropagation() } : {}))

// The whole card opens the service page; links and buttons inside keep their own behaviour.
function openPage(e: MouseEvent) {
  if (!isContainer.value) return
  if ((e.target as HTMLElement).closest('a, button, input, select, [role="dialog"]')) return
  if (window.getSelection()?.toString()) return // let people select text without navigating
  if (e.metaKey || e.ctrlKey) window.open(pageLink.value, '_blank')
  else navigateTo(pageLink.value)
}

const { caps } = useCapabilities()
const updates = useUpdates()
const updateAvailable = computed(() => updates.entryFor(props.service)?.status === 'update')

const { stats, history, refresh: refreshStats } = useStats()
const stat = computed(() => stats.value[props.service.id])
const cpuHistory = computed(() => history.value[props.service.id]?.cpu ?? [])

const { pings } = usePings()
// the reverse proxy shares no network with this container: its domains can't work
const reachApi = useProxyReach()
const unreachable = computed(() => reachApi.domainReach(props.service).ok === false)
function pingClass(url: string) {
  const p = pings.value[url]
  if (!p) return ''
  if (p.status === 0) return 'bg-red-400'
  if (p.status < 400) return 'bg-ok'
  return 'bg-amber-400'
}
function pingTitle(url: string) {
  const p = pings.value[url]
  return !p ? '' : p.status === 0 ? 'unreachable' : `HTTP ${p.status} · ${p.ms}ms`
}

const { data, refresh: refreshServices } = useServices()
// server flag AND this user's role (viewers get caps.control = false)
const controlEnabled = computed(() => (data.value?.controlEnabled ?? false) && caps.value.control)
const remoteIcons = computed(() => data.value?.remoteIcons ?? true)
const hasActions = computed(() => isContainer.value)
const busy = ref(false)
const stackAware = useStackAwareActions()
const toast = useToast()
async function control(action: 'start' | 'stop' | 'restart') {
  if (action === 'stop' && !(await stackAware.confirmStop(props.service))) return
  busy.value = true
  try {
    await $fetch('/api/control', { method: 'POST', body: { id: props.service.id, action } })
    await refreshServices()
    refreshStats()
    toast.success(`${props.service.displayName}: ${action === 'stop' ? 'stopped' : action === 'start' ? 'started' : 'restarted'}`)
  } catch (e: any) {
    toast.error(errMsg(e, 'Action failed'))
  } finally {
    busy.value = false
  }
}
</script>
