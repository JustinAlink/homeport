<template>
  <div class="page">
    <PageHeader :title="service?.displayName ?? (loading ? '' : 'Container')" :crumbs="crumbs">
      <template v-if="service" #icon>
        <div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/[0.04] ring-1 ring-inset ring-white/[0.08]">
          <ServiceIcon :name="service.displayName" :icon="service.icon" :size="32" :remote="remoteIcons" />
        </div>
      </template>
      <template v-if="service" #badges>
        <StatusPill :state="service.state" :health="service.health" />
        <button v-if="updateEntry?.status === 'update'" class="badge badge-info h-6 px-2" @click="tab = 'update'">
          <Icon name="arrow-up" class="h-3 w-3" :weight="2.2" /> update available
        </button>
      </template>
      <template v-if="service" #subtitle>
        <span class="font-mono text-xs">{{ service.image }}</span>
      </template>
      <template v-if="service" #actions>
        <NuxtLink
          v-if="composeProject && caps.stacks"
          :to="`/stacks/${encodeURIComponent(composeProject)}`"
          class="btn"
          :title="stackManaged ? 'This container is part of a stack: open its compose file and stack actions' : 'Open the stack this container belongs to'"
        ><Icon name="stacks" /> Stack: {{ composeProject }}</NuxtLink>
        <a
          v-if="service.domains[0]"
          :href="service.domains[0].url"
          target="_blank"
          rel="noopener noreferrer"
          class="btn"
        ><Icon name="external" /> Open</a>
        <template v-if="caps.control && service.kind === 'container'">
          <div v-if="isUp" class="btn-group">
            <button :disabled="!!busy" class="btn" @click="control('restart')">
              <Icon name="refresh" :class="busy === 'restart' ? 'animate-spin' : ''" />
              {{ busy === 'restart' ? 'Restarting…' : 'Restart' }}
            </button>
            <button :disabled="!!busy" class="btn hover:!border-red-500/40 hover:!bg-red-500/10 hover:!text-red-300" @click="control('stop')">
              <Icon name="square" />
              {{ busy === 'stop' ? 'Stopping…' : 'Stop' }}
            </button>
          </div>
          <button v-else :disabled="!!busy" class="btn btn-primary" @click="control('start')">
            <Icon name="play" />
            {{ busy === 'start' ? 'Starting…' : 'Start' }}
          </button>
        </template>
      </template>
    </PageHeader>

    <div v-if="!service && loading" class="space-y-4">
      <div class="skeleton h-10 w-full max-w-md" />
      <div class="grid gap-3 sm:grid-cols-4"><div v-for="i in 4" :key="i" class="card h-20" /></div>
      <div class="card h-64" />
    </div>
    <div v-else-if="!service" class="card">
      <EmptyState icon="box" title="Container not found" text="It may have been removed or recreated under a new id.">
        <template #actions><NuxtLink to="/" class="btn btn-sm">Back to the dashboard</NuxtLink></template>
      </EmptyState>
    </div>

    <template v-else>
      <TabBar v-model="tab" :tabs="tabs" />

      <!-- OVERVIEW -->
      <section v-if="tab === 'overview'" class="grid gap-5 lg:grid-cols-3">
        <div class="min-w-0 space-y-5 lg:col-span-2">
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="f in facts" :key="f.label" class="card px-4 py-3">
              <p class="text-xs text-slate-500">{{ f.label }}</p>
              <p class="mt-1 truncate text-[15px] font-medium tabular-nums text-slate-100" :title="f.value">{{ f.value }}</p>
            </div>
          </div>

          <div v-if="service.state === 'running'" class="card">
            <div class="card-header">
              <span class="card-title">Usage</span>
              <span class="flex items-center gap-3 text-[11.5px] text-slate-400">
                <span v-for="s in series" :key="s.label" class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" :style="{ background: s.color }" />{{ s.label }}</span>
              </span>
              <div class="segmented segmented-sm ml-auto">
                <button v-for="r in (['live', '1h', '6h', '24h'] as const)" :key="r" :aria-pressed="range === r" @click="range = r">{{ r === 'live' ? 'Live' : r }}</button>
              </div>
            </div>
            <div class="px-2 py-3 sm:px-3">
              <LineGraph v-if="series[0].data.length > 1" :series="series" :height="170" :interval-sec="range === 'live' ? 7 : 60" bare />
              <p v-else class="grid h-[170px] place-items-center text-xs text-slate-500">Collecting data, the graph fills in within a few seconds.</p>
            </div>
          </div>

          <div v-if="service.domains.length || service.ports.length || service.networks?.length" class="card">
            <div class="card-header"><span class="card-title">Access</span></div>
            <div v-if="service.domains.length" class="px-4 pt-3 empty:hidden sm:px-5"><ProxyReachWarning :service="service" compact /></div>
            <div class="row-list">
              <div v-for="d in service.domains" :key="d.domain" class="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <Icon :name="d.ssl ? 'lock' : 'globe'" class="h-4 w-4 shrink-0" :class="d.ssl ? 'text-ok' : 'text-slate-500'" />
                <a :href="d.url" target="_blank" rel="noopener noreferrer" class="min-w-0 truncate text-[13.5px] text-slate-100 hover:text-accent-light">{{ d.domain }}</a>
                <span v-if="pings.pings.value[d.url]" class="flex items-center gap-1.5 text-[11.5px] text-slate-500">
                  <span class="dot h-1.5 w-1.5" :class="pingClass(d.url)" />{{ pingTitle(d.url) }}
                </span>
                <CopyButton :text="d.url" label="URL" class="ml-auto" />
                <a :href="d.url" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm btn-icon" :aria-label="`Open ${d.domain}`"><Icon name="external" /></a>
              </div>
              <div v-if="service.ports.length" class="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
                <span class="mr-1 w-16 shrink-0 text-xs text-slate-500">Ports</span>
                <a
                  v-for="p in service.ports"
                  :key="p.hostPort + p.type"
                  :href="`http://${hostName}:${p.hostPort}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="chip font-mono text-[11.5px]"
                  :title="`host ${p.hostPort} → container ${p.containerPort}/${p.type}`"
                >:{{ p.hostPort }}<span class="text-slate-500">→{{ p.containerPort }}</span></a>
              </div>
              <div v-if="service.networks?.length" class="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
                <span class="mr-1 w-16 shrink-0 text-xs text-slate-500">Networks</span>
                <NuxtLink
                  v-for="n in service.networks"
                  :key="n"
                  :to="caps.stacks ? '/networks' : ''"
                  class="chip font-mono text-[11.5px]"
                  :title="`docker network ${n}`"
                >{{ n }}</NuxtLink>
              </div>
            </div>
          </div>
        </div>

        <div class="min-w-0 space-y-5">
          <!-- restart policy: whether this container comes back on reboot -->
          <div v-if="service.kind === 'container' && restart.policy !== null" class="card card-pad">
            <label class="card-title mb-1 block" for="restart-policy">Start on boot</label>
            <p class="mb-3 text-xs text-slate-500">Docker's restart policy for this container.</p>
            <select id="restart-policy" v-model="restart.selected" :disabled="!caps.control" class="select">
              <option v-for="o in restartOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <p class="field-hint">{{ restartOptions.find((o) => o.value === restart.selected)?.hint }}</p>
            <div v-if="restart.selected !== restart.policy || restart.msg" class="mt-3 flex flex-wrap items-center gap-2">
              <button
                v-if="restart.selected !== restart.policy"
                :disabled="restart.saving"
                class="btn btn-primary btn-sm"
                @click="saveRestartPolicy"
              >{{ restart.saving ? 'Applying…' : 'Apply' }}</button>
              <button v-if="restart.selected !== restart.policy" class="btn btn-ghost btn-sm" @click="restart.selected = restart.policy!">Cancel</button>
              <span v-if="restart.msg" class="text-xs" :class="restart.ok ? 'text-ok' : 'text-red-400'">{{ restart.msg }}</span>
            </div>
            <label v-if="caps.control && canWriteCompose && restart.selected !== restart.policy" class="check mt-3 text-xs text-slate-400">
              <input v-model="writeCompose" type="checkbox" />
              <span>Also save it to <span class="font-mono">{{ composeProject }}</span>'s compose file, so it survives the next <code>up</code></span>
            </label>
            <p v-if="!caps.control" class="field-hint">Changing it needs the start/stop capability.</p>
            <p v-else-if="restart.composeManaged && !canWriteCompose" class="mt-3 flex gap-1.5 text-xs leading-relaxed text-slate-500">
              <Icon name="info" class="mt-px h-3.5 w-3.5 shrink-0" />
              <span>Compose-managed: applies now, but the compose file's <code>restart:</code> wins when the stack is recreated. Change it there too to make it stick.</span>
            </p>
          </div>

          <!-- resource limits: live CPU/memory caps via docker update (no recreate) -->
          <div v-if="service.kind === 'container' && resources.loaded" class="card card-pad">
            <p class="card-title mb-1">Resource limits</p>
            <p class="mb-3 text-xs text-slate-500">Applied live, no restart. Leave empty for no limit.</p>
            <div class="space-y-3">
              <div>
                <label class="field-label" for="cpu-limit">CPU limit <span class="font-normal text-slate-500">(cores)</span></label>
                <input
                  id="cpu-limit"
                  v-model.number="resources.cpus"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="No limit"
                  :disabled="!caps.control"
                  class="input"
                />
                <p v-if="facts[2]" class="field-hint">Currently using {{ facts[2].value }}</p>
              </div>
              <div>
                <label class="field-label" for="mem-limit">Memory limit</label>
                <input
                  id="mem-limit"
                  v-model="resources.memory"
                  type="text"
                  placeholder="No limit, e.g. 512m or 2g"
                  :disabled="!caps.control"
                  class="input"
                />
                <p v-if="facts[3]" class="field-hint">Currently using {{ facts[3].value }}</p>
              </div>
            </div>
            <div v-if="resourcesDirty || resources.msg" class="mt-3 flex flex-wrap items-center gap-2">
              <button v-if="resourcesDirty" :disabled="resources.saving" class="btn btn-primary btn-sm" @click="saveResources">
                {{ resources.saving ? 'Applying…' : 'Apply limits' }}
              </button>
              <span v-if="resources.msg" class="text-xs" :class="resources.ok ? 'text-ok' : 'text-red-400'">{{ resources.msg }}</span>
            </div>
            <label v-if="caps.control && canWriteCompose && resourcesDirty" class="check mt-3 text-xs text-slate-400">
              <input v-model="writeCompose" type="checkbox" />
              <span>Also save them to <span class="font-mono">{{ composeProject }}</span>'s compose file, so they survive the next <code>up</code></span>
            </label>
            <p v-if="!caps.control" class="field-hint">Changing them needs the start/stop capability.</p>
            <p v-else-if="resources.composeManaged && !canWriteCompose" class="mt-3 flex gap-1.5 text-xs leading-relaxed text-slate-500">
              <Icon name="info" class="mt-px h-3.5 w-3.5 shrink-0" />
              <span>Compose-managed: the compose file's <code>deploy.resources</code> / <code>mem_limit</code> wins when the stack is recreated.</span>
            </p>
            <p v-if="caps.control && service.state === 'restarting'" class="mt-2 flex gap-1.5 text-xs leading-relaxed text-amber-300/90">
              <Icon name="alert" class="mt-px h-3.5 w-3.5 shrink-0" />
              <span>The container is restarting: Docker may accept a change without applying it. Re-check once it settles.</span>
            </p>
          </div>

          <div class="card">
            <div class="card-header"><span class="card-title">Details</span></div>
            <dl class="row-list text-[13px]">
              <div v-for="d in details" :key="d.label" class="flex items-baseline gap-3 px-4 py-2 sm:px-5">
                <dt class="w-24 shrink-0 text-xs text-slate-500">{{ d.label }}</dt>
                <dd class="flex min-w-0 flex-1 items-start gap-1 break-words" :class="d.mono ? 'font-mono text-xs text-slate-300' : 'text-slate-200'">
                  <NuxtLink v-if="d.to" :to="d.to" class="link">{{ d.value }}</NuxtLink>
                  <span v-else class="min-w-0">{{ d.value }}</span>
                  <CopyButton v-if="d.mono" :text="d.value" :label="d.label.toLowerCase()" class="-my-0.5 ml-auto" />
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <!-- danger zone: recreate + delete -->
        <div v-if="caps.control && service.kind === 'container'" class="card overflow-hidden border-red-500/20 lg:col-span-3">
          <div class="card-header border-red-500/15">
            <span class="card-title text-red-300">Danger zone</span>
            <span v-if="composeProject && stackManaged" class="text-xs text-slate-500">
              This container belongs to the stack “{{ composeProject }}”: what happens to it here lasts until the stack is next
              started or updated, which recreates it from the compose file. For a lasting change, edit the
              <NuxtLink :to="`/stacks/${composeProject}`" class="link">stack</NuxtLink>.
            </span>
          </div>
          <div class="row-list">
            <div class="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
              <div class="min-w-0 flex-1">
                <p class="text-[13px] font-medium text-slate-100">Recreate container</p>
                <p class="mt-0.5 text-xs text-slate-500">Stop and recreate it with the same image and settings. Useful when a container is wedged.</p>
              </div>
              <button :disabled="applying || deleting" class="btn" @click="recreate">
                <Icon name="refresh" :class="applying ? 'animate-spin' : ''" /> {{ applying ? 'Recreating…' : 'Recreate' }}
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
              <div class="min-w-0 flex-1">
                <p class="text-[13px] font-medium text-slate-100">Delete container</p>
                <div class="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
                  <label class="check text-xs text-slate-400"><input v-model="deleteVolumes" type="checkbox" /> Also delete its anonymous volumes</label>
                  <label class="check text-xs text-slate-400"><input v-model="deleteImage" type="checkbox" /> Also delete its image</label>
                  <label v-if="caps.proxyAdmin && matchedRoutes.length && !caps.viewer" class="check text-xs text-slate-400">
                    <input v-model="deleteProxyRoutes" type="checkbox" />
                    Also remove its domain{{ matchedRoutes.length > 1 ? 's' : '' }} from the proxy ({{ matchedRoutes.flatMap((r) => r.domains).join(', ') }})
                  </label>
                </div>
              </div>
              <button :disabled="applying || deleting" class="btn btn-danger" @click="deleteContainer">
                <Icon name="trash" /> {{ deleting ? 'Deleting…' : 'Delete' }}
              </button>
            </div>
          </div>
        </div>
        <OpSteps v-if="dangerSteps.length" class="lg:col-span-3" :steps="dangerSteps" title="Result" :redirecting="redirecting" :new-page="newPage" noun="recreated" />
      </section>

      <!-- LOGS -->
      <section v-else-if="tab === 'logs'" class="card h-[calc(100vh-240px)] min-h-[420px] p-3">
        <LogsView v-if="caps.logs" :id="service.id" class="h-full" />
        <p v-else class="text-sm text-slate-500">Logs are disabled (<code>HOMEPORT_LOGS=false</code>).</p>
      </section>

      <!-- TERMINAL -->
      <section v-else-if="tab === 'terminal'" class="card h-[calc(100vh-240px)] min-h-[420px] p-3">
        <TerminalView v-if="isUp" :id="service.id" :name="service.displayName" class="h-full" />
        <EmptyState v-else icon="terminal" title="The container isn't running" text="Start it to open a shell inside.">
          <template v-if="caps.control" #actions><button class="btn btn-primary btn-sm" @click="control('start')"><Icon name="play" /> Start</button></template>
        </EmptyState>
      </section>

      <!-- ENVIRONMENT -->
      <section v-else-if="tab === 'env'" class="max-w-3xl space-y-4">
        <div v-if="composeProject && stackManaged" class="callout callout-info">
          <Icon name="info" />
          <span>
            This container belongs to the stack “{{ composeProject }}”. Set its environment in the stack's compose file so the
            change survives the next start or update. <NuxtLink :to="`/stacks/${composeProject}`" class="link">Open the stack</NuxtLink>
          </span>
        </div>
        <template v-else>
          <div v-if="composeProject && stackChecked" class="callout callout-warn">
            <Icon name="alert" />
            <span>
              Part of the stack “{{ composeProject }}”, whose compose file homeport can't see. Changes apply now, but the next
              <code>docker compose up</code> from that file recreates the container with the old environment, so mirror the
              change there too.
            </span>
          </div>
          <div v-if="!envLoaded" class="card card-pad space-y-2"><div v-for="i in 4" :key="i" class="skeleton h-9" /></div>
          <div v-else-if="envError" class="callout callout-warn"><Icon name="alert" /><span>{{ envError }}</span></div>
          <div v-else class="card">
            <div class="card-header">
              <span class="card-title">Environment variables</span>
              <span class="text-xs text-slate-500">{{ envRows.length }} set</span>
            </div>
            <div class="space-y-2 p-4 sm:p-5">
              <div v-for="(row, i) in envRows" :key="i" class="flex items-center gap-2">
                <input
                  v-model="row.key"
                  placeholder="NAME"
                  spellcheck="false"
                  aria-label="Variable name"
                  class="input w-2/5 font-mono text-xs"
                />
                <input
                  v-model="row.value"
                  :type="row.secret ? 'password' : 'text'"
                  :placeholder="row.keep ? 'unchanged, type to replace' : 'value'"
                  spellcheck="false"
                  aria-label="Value"
                  class="input flex-1 font-mono text-xs"
                  @input="row.keep = false"
                />
                <button
                  type="button"
                  class="btn btn-ghost btn-icon hover:!text-red-300"
                  :aria-label="`Remove ${row.key || 'variable'}`"
                  title="Remove"
                  @click="envRows.splice(i, 1)"
                ><Icon name="trash" /></button>
              </div>
              <button type="button" class="btn btn-sm" @click="envRows.push({ key: '', value: '', keep: false, secret: false })">
                <Icon name="plus" /> Add variable
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-3 sm:px-5">
              <button :disabled="applying" class="btn btn-primary" @click="applyEnv">{{ applying ? 'Recreating…' : 'Apply & recreate' }}</button>
              <button type="button" :disabled="applying" class="btn btn-ghost" @click="reloadEnv">Discard changes</button>
              <span class="text-xs text-slate-500">Applying stops the container and recreates it with the new environment.</span>
            </div>
          </div>
          <OpSteps :steps="envSteps" title="Recreate steps" :redirecting="redirecting" :new-page="newPage" />
        </template>
      </section>

      <!-- DOMAINS -->
      <section v-else-if="tab === 'domains'" class="max-w-xl space-y-4">
        <p class="text-[13px] text-slate-400">
          {{ matchedRoute ? 'This container already has a reverse-proxy route. Edit it below.' : 'Point a domain at this container through your reverse proxy.' }}
        </p>
        <ProxyReachWarning :service="service" any-route />
        <DomainForm
          :key="domainFormKey"
          :initial="domainInitial"
          :submit-label="matchedRoute ? 'Update domain' : 'Add domain'"
          @saved="onDomainSaved"
        />
        <NuxtLink to="/domains" class="link inline-flex items-center gap-1 text-xs">Manage all domains <Icon name="arrow-right" class="h-3 w-3" /></NuxtLink>
      </section>

      <!-- UPDATE -->
      <section v-else-if="tab === 'update'" class="max-w-2xl space-y-4">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Image</span>
            <span class="badge h-6 px-2" :class="updateBadgeCls">{{ updateLabel }}</span>
          </div>
          <div class="p-4 sm:p-5">
            <p class="break-all font-mono text-[13px] text-slate-200">{{ service.image }}</p>
            <dl v-if="updateEntry" class="mt-3 space-y-1.5 text-xs">
              <div v-if="updateEntry.localDigest" class="flex gap-3"><dt class="w-20 shrink-0 text-slate-500">Running</dt><dd class="min-w-0 truncate font-mono text-slate-400">{{ updateEntry.localDigest }}</dd></div>
              <div v-if="updateEntry.remoteDigest" class="flex gap-3"><dt class="w-20 shrink-0 text-slate-500">Latest</dt><dd class="min-w-0 truncate font-mono text-slate-400">{{ updateEntry.remoteDigest }}</dd></div>
              <div class="flex gap-3"><dt class="w-20 shrink-0 text-slate-500">Checked</dt><dd class="text-slate-400">{{ new Date(updateEntry.checkedAt).toLocaleString() }}</dd></div>
              <div v-if="changelogUrl" class="flex gap-3">
                <dt class="w-20 shrink-0 text-slate-500">Changelog</dt>
                <dd class="min-w-0 truncate"><a :href="changelogUrl" target="_blank" rel="noopener noreferrer" class="link">{{ changelogUrl }}</a></dd>
              </div>
              <div v-if="updateEntry.error" class="text-amber-300/90">{{ updateEntry.error }}</div>
            </dl>
            <p v-else class="mt-2 text-xs text-slate-500">
              {{ updatesEnabled ? 'Not checked yet.' : 'Update checks are off. Turn them on in Settings → Capabilities.' }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-3 sm:px-5">
            <template v-if="updateEntry?.status === 'update'">
              <NuxtLink v-if="stackManaged" :to="`/stacks/${composeProject}`" class="btn btn-primary">
                Update via stack “{{ composeProject }}” <Icon name="arrow-right" />
              </NuxtLink>
              <button
                v-else-if="caps.updates && (!composeProject || stackChecked)"
                :disabled="applying"
                class="btn btn-primary"
                @click="apply"
              ><Icon name="download" /> {{ applying ? 'Updating…' : 'Update now' }}</button>
              <span v-else-if="!caps.updates" class="text-xs text-slate-500">Applying updates is off (Settings → Capabilities).</span>
            </template>
            <button v-if="updatesEnabled" :disabled="checking" class="btn" @click="checkNow">
              <Icon name="refresh" :class="checking ? 'animate-spin' : ''" /> {{ checking ? 'Checking…' : 'Check now' }}
            </button>
          </div>
          <p v-if="updateEntry?.status === 'update' && composeProject && stackChecked && !stackManaged" class="border-t border-white/[0.06] px-4 py-3 text-xs leading-relaxed text-slate-500 sm:px-5">
            Part of the stack “{{ composeProject }}”, whose compose file homeport can't see: updating pulls the image and recreates
            this container in place with its current settings.
            <NuxtLink v-if="projectSiblings > 1" :to="`/stacks/${composeProject}`" class="link">Update the whole stack at once</NuxtLink>
          </p>
        </div>
        <OpSteps :steps="applySteps" title="Update steps" :redirecting="redirecting" :new-page="newPage" />
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

// remount when the id param changes (an applied update navigates to the new container id)
definePageMeta({ key: (route) => route.path })

const route = useRoute()
const id = decodeURIComponent(String(route.params.id))

const { data, loading, refresh, start, stop } = useServices()
const stats = useStats()
const { caps, loaded: capsLoaded, load: loadCaps } = useCapabilities()
const updates = useUpdates()
const { confirm, choose } = useConfirm()
const stackAware = useStackAwareActions()
const toast = useToast()

const applying = ref(false)
const newPage = ref('') // route of the recreated container once an update lands
const redirecting = ref(false)

// While an update recreates the container it briefly vanishes from the live
// list (old renamed away, new not up yet) — keep rendering the last-seen data
// instead of flashing "service not found".
const liveService = computed(() => data.value?.services.find((s) => s.id === id))
const lastSeen = ref<Service>()
watchEffect(() => {
  if (liveService.value) lastSeen.value = liveService.value
})
const service = computed(() => liveService.value ?? (applying.value || newPage.value ? lastSeen.value : undefined))
const remoteIcons = computed(() => data.value?.remoteIcons ?? true)
const hostName = computed(() => (import.meta.client ? window.location.hostname : 'localhost'))
const isUp = computed(() => service.value?.state === 'running' || service.value?.state === 'restarting')

type Tab = 'overview' | 'logs' | 'terminal' | 'env' | 'domains' | 'update'
// the open tab lives in ?tab= so a reload, a shared link or the dashboard's
// "update" badge lands on the right one
const router = useRouter()
const TABS: Tab[] = ['overview', 'logs', 'terminal', 'env', 'domains', 'update']
const tab = ref<Tab>(TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'overview')
watch(tab, (t) => {
  router.replace({ query: { ...route.query, tab: t === 'overview' ? undefined : t } })
})
const tabs = computed(() => [
  { key: 'overview' as Tab, label: 'Overview', icon: 'dashboard' },
  ...(caps.value.logs ? [{ key: 'logs' as Tab, label: 'Logs', icon: 'file-text' }] : []),
  ...(caps.value.terminal ? [{ key: 'terminal' as Tab, label: 'Terminal', icon: 'terminal' }] : []),
  ...(caps.value.updates ? [{ key: 'env' as Tab, label: 'Environment', icon: 'sliders' }] : []),
  ...(caps.value.proxyAdmin && !caps.value.viewer ? [{ key: 'domains' as Tab, label: 'Domains', icon: 'globe' }] : []),
  ...(updates.enabled.value || caps.value.updates
    ? [{ key: 'update' as Tab, label: 'Update', icon: 'arrow-up', dot: updateEntry.value?.status === 'update' }]
    : []),
])

const crumbs = computed(() => {
  const s = service.value
  const c: { label: string; to?: string }[] = [{ label: 'Dashboard', to: '/' }]
  if (s?.project && caps.value.stacks) c.push({ label: s.project, to: `/stacks/${encodeURIComponent(s.project)}` })
  else if (s?.group) c.push({ label: s.group })
  return c
})

const pings = usePings()
function pingClass(url: string) {
  const p = pings.pings.value[url]
  if (!p) return ''
  return p.status === 0 ? 'bg-red-400' : p.status < 400 ? 'bg-ok' : 'bg-amber-400'
}
function pingTitle(url: string) {
  const p = pings.pings.value[url]
  return !p ? '' : p.status === 0 ? 'unreachable' : `HTTP ${p.status} · ${p.ms} ms`
}

const restartOptions = [
  { value: 'unless-stopped', label: 'Unless stopped', hint: 'Starts on boot and after a crash, unless you stopped it yourself.' },
  { value: 'always', label: 'Always', hint: 'Starts on boot and restarts after every crash.' },
  { value: 'on-failure', label: 'On failure', hint: 'Only restarts after a crash.' },
  { value: 'no', label: 'Never', hint: 'Stays down after a reboot or a crash.' },
]

// --- domains tab ---
// Pull the proxy's existing routes so the form can pre-fill and, when a route
// already points at this container, switch from "Add" (POST → would conflict)
// to "Update" (PUT) instead.
interface ProxyRoute { id: string; domains: string[]; upstreamHost: string; upstreamPort: number; ssl: boolean }
const proxyRoutes = ref<ProxyRoute[]>([])
const routesLoaded = ref(false)
async function loadRoutes() {
  try {
    const r = await $fetch<{ routes: ProxyRoute[] }>('/api/proxy/routes')
    proxyRoutes.value = r.routes ?? []
  } catch {
    // proxy admin unreachable — fall back to prefill-only (no route id → plain Add)
  } finally {
    routesLoaded.value = true
  }
}
watch(
  // overview needs them too — the delete cleanup checkbox shows matching routes
  () => (tab.value === 'domains' || tab.value === 'overview') && caps.value.proxyAdmin && !caps.value.viewer,
  (on) => { if (on && !routesLoaded.value) loadRoutes() },
  { immediate: true },
)
const matchedRoutes = computed(() =>
  service.value ? proxyRoutes.value.filter((r) => r.upstreamHost === service.value!.name) : [],
)
const matchedRoute = computed(() => matchedRoutes.value[0])
const domainInitial = computed(() => {
  const s = service.value!
  const m = matchedRoute.value
  if (m) return { id: m.id, domains: m.domains, upstreamHost: m.upstreamHost, upstreamPort: m.upstreamPort, ssl: m.ssl }
  return { domains: s.domains.map((d) => d.domain), upstreamHost: s.name, upstreamPort: s.ports[0]?.containerPort ?? s.internalPorts?.[0] ?? s.ports[0]?.hostPort ?? 80, ssl: s.domains[0]?.ssl ?? true }
})
// remount the form once routes resolve so it re-reads `initial`
const domainFormKey = computed(() => (matchedRoute.value?.id ?? (routesLoaded.value ? 'new' : 'loading')))

function onDomainSaved() {
  refresh()
  loadRoutes()
  tab.value = 'overview'
}

// --- restart policy (start on boot) ---
const restart = reactive({
  policy: null as string | null,
  selected: 'no',
  composeManaged: false,
  saving: false,
  msg: '',
  ok: false,
})

async function loadRestartPolicy() {
  try {
    const r = await $fetch<{ policy: string; composeManaged: boolean }>('/api/restart-policy', { query: { id } })
    restart.policy = r.policy
    restart.selected = r.policy
    restart.composeManaged = r.composeManaged
  } catch {
    restart.policy = null // endpoint unavailable (e.g. host down) — hide the row
  }
}

// A managed stack's next `compose up` recreates the container from its file,
// reverting live `docker update` changes, so offer to write them there too.
const writeCompose = ref(true)
const canWriteCompose = computed(
  () => !!composeProject.value && stackManaged.value && !!service.value?.composeService && caps.value.stacks,
)
/** Returns a note for the result line, or throws with the reason the file wasn't updated. */
async function saveToCompose(patch: Record<string, unknown>): Promise<string> {
  if (!canWriteCompose.value || !writeCompose.value) return ''
  const r = await $fetch<{ changed: boolean; file: string }>(`/api/stacks/${encodeURIComponent(composeProject.value!)}/service-settings`, {
    method: 'POST',
    body: { service: service.value!.composeService, ...patch },
  })
  return r.changed ? ` Saved to ${r.file}.` : ''
}

async function saveRestartPolicy() {
  restart.saving = true
  restart.msg = ''
  try {
    await $fetch('/api/restart-policy', { method: 'POST', body: { id, policy: restart.selected } })
    restart.policy = restart.selected
    restart.ok = true
    restart.msg = restart.selected === 'no' ? 'Applied: this container will stay down after a reboot.' : 'Applied.'
    try {
      restart.msg += await saveToCompose({ restart: restart.selected })
    } catch (e: any) {
      restart.ok = false
      restart.msg += ` Not saved to the compose file: ${errMsg(e, 'write failed')}`
    }
  } catch (e: any) {
    restart.ok = false
    restart.msg = errMsg(e, 'could not change the restart policy')
  } finally {
    restart.saving = false
  }
}

// --- resource limits (CPU cores + memory, live docker update) ---
// CPU is exposed to the user as "cores" (docker update --cpus style); the
// backend stores/returns raw cpuQuota/cpuPeriod so round-tripping stays exact.
// Duplicated from server/utils/resources-core.ts (no shared/ dir in this app —
// server code isn't imported into the client bundle; kept in sync by hand).
function quotaToCores(cpuQuota: number | undefined | null, cpuPeriod: number | undefined | null): number | null {
  if (!cpuQuota || cpuQuota <= 0 || !cpuPeriod || cpuPeriod <= 0) return null
  return Math.round((cpuQuota / cpuPeriod) * 1000) / 1000
}
const SIZE_UNITS: Record<string, number> = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }
function formatByteSize(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes % SIZE_UNITS.g === 0) return `${bytes / SIZE_UNITS.g}g`
  if (bytes % SIZE_UNITS.m === 0) return `${bytes / SIZE_UNITS.m}m`
  if (bytes % SIZE_UNITS.k === 0) return `${bytes / SIZE_UNITS.k}k`
  return String(bytes)
}

const resources = reactive({
  loaded: false,
  cpus: null as number | null, // current-loaded value
  memory: '', // current-loaded value, e.g. "512m"
  composeManaged: false,
  saving: false,
  msg: '',
  ok: false,
})
const resourcesLoadedCpus = ref<number | null>(null)
const resourcesLoadedMemory = ref('')
const resourcesDirty = computed(
  () => resources.cpus !== resourcesLoadedCpus.value || resources.memory !== resourcesLoadedMemory.value,
)

async function loadResources() {
  try {
    const r = await $fetch<{ cpuQuota: number; cpuPeriod: number; memory: number; composeManaged: boolean }>('/api/resources', { query: { id } })
    resources.cpus = quotaToCores(r.cpuQuota, r.cpuPeriod)
    resources.memory = formatByteSize(r.memory)
    resources.composeManaged = r.composeManaged
    resourcesLoadedCpus.value = resources.cpus
    resourcesLoadedMemory.value = resources.memory
    resources.loaded = true
  } catch {
    resources.loaded = false // endpoint unavailable (e.g. host down) — hide the block
  }
}

async function saveResources() {
  resources.saving = true
  resources.msg = ''
  try {
    const body: Record<string, unknown> = { id }
    if (resources.cpus !== resourcesLoadedCpus.value) body.cpus = resources.cpus || 0
    if (resources.memory !== resourcesLoadedMemory.value) body.memory = resources.memory || '0'
    await $fetch('/api/resources', { method: 'POST', body })
    resourcesLoadedCpus.value = resources.cpus
    resourcesLoadedMemory.value = resources.memory
    resources.ok = true
    resources.msg = 'Applied.'
    const patch: Record<string, unknown> = {}
    if ('cpus' in body) patch.cpus = resources.cpus || null
    if ('memory' in body) patch.memory = resources.memory || null
    try {
      resources.msg += await saveToCompose(patch)
    } catch (e: any) {
      resources.ok = false
      resources.msg += ` Not saved to the compose file: ${errMsg(e, 'write failed')}`
    }
  } catch (e: any) {
    resources.ok = false
    resources.msg = errMsg(e, 'could not change resource limits')
  } finally {
    resources.saving = false
  }
}

// --- overview facts ---
const facts = computed(() => {
  const s = service.value!
  const stat = stats.stats.value[s.id]
  return [
    { label: 'Status', value: s.statusText || s.state },
    { label: s.project ? 'Stack' : 'Group', value: (s.host ? `${s.host} · ` : '') + (s.project ?? (s.group === 'Other' ? 'none' : s.group)) },
    { label: 'CPU', value: stat?.cpuPercent != null ? `${stat.cpuPercent}%` : '—' },
    { label: 'Memory', value: stat ? formatBytes(stat.memBytes) : '—' },
  ]
})

const details = computed(() => {
  const s = service.value!
  const d: { label: string; value: string; mono?: boolean; to?: string }[] = [
    { label: 'Container', value: s.name, mono: true },
    { label: 'Image', value: s.image, mono: true },
  ]
  if (s.project) d.push({ label: 'Stack', value: s.project, to: caps.value.stacks ? `/stacks/${encodeURIComponent(s.project)}` : undefined })
  if (s.project && s.composeService) d.push({ label: 'Service', value: s.composeService, mono: true })
  if (s.host) d.push({ label: 'Host', value: s.host })
  if (s.createdAt) d.push({ label: 'Created', value: new Date(s.createdAt).toLocaleString() })
  if (s.health) d.push({ label: 'Health', value: s.health })
  return d
})

// --- overview graph (live buffer or persisted history) ---
// Opens on the last hour of persisted history (instant), like the dashboard;
// 'live' only fills after a minute of polling. History was never loaded on
// mount before (only on a range change), so the graph always opened empty.
const { range, past, realPoints, load: loadHistory } = useHistoryRange(id, '1h')
async function initHistory() {
  await loadHistory()
  // no persisted history (feature off, or a brand-new container): show live instead
  if (range.value !== 'live' && realPoints.value < 2) range.value = 'live'
}
const series = computed(() => {
  const live = stats.history.value[id] ?? { cpu: [], mem: [] }
  const src = range.value === 'live' ? live : past.value ?? { cpu: [], mem: [] }
  return [
    { label: 'CPU', color: '#10b981', data: src.cpu, unit: '%' },
    { label: 'MEM', color: '#38bdf8', data: src.mem, unit: 'MiB' },
  ]
})

// --- danger zone: recreate + delete ---
const deleting = ref(false)
const deleteVolumes = ref(false)
const deleteImage = ref(false)
const deleteProxyRoutes = ref(false)
const dangerSteps = ref<{ step: string; ok: boolean; detail?: string }[]>([])

async function recreate() {
  if (!(await confirm({ message: `Recreate “${service.value?.displayName}” in place? It restarts with the same image and settings.`, confirmLabel: 'Recreate' }))) return
  applying.value = true
  dangerSteps.value = []
  try {
    const r = await $fetch<{ steps: typeof dangerSteps.value; newId?: string }>('/api/recreate', { method: 'POST', body: { id } })
    dangerSteps.value = r.steps
    await refresh()
    if (r.newId) {
      const sep = id.indexOf('::')
      const hostPrefix = sep >= 0 ? id.slice(0, sep) : 'default'
      newPage.value = `/services/${encodeURIComponent(`${hostPrefix}::${r.newId}`)}`
      if (r.steps.every((s) => s.ok)) {
        redirecting.value = true
        setTimeout(() => navigateTo(newPage.value, { replace: true }), 1500)
      }
    }
  } catch (e: any) {
    dangerSteps.value = e?.data?.data?.steps || []
    toast.error(errMsg(e, 'Recreate failed'))
  } finally {
    applying.value = false
  }
}

async function deleteContainer() {
  const name = service.value?.displayName
  const extras = [
    deleteVolumes.value ? 'its anonymous volumes' : '',
    deleteImage.value ? 'its image' : '',
    deleteProxyRoutes.value ? 'its proxy domains' : '',
  ].filter(Boolean)
  const stack = stackAware.stackOf(service.value)
  if (stack) {
    // deleting one container doesn't take it out of the compose file
    const c = await choose({
      title: `Delete “${name}”?`,
      message: `It belongs to the stack “${stack}”, and its compose file still lists it, so the next time the stack is started or updated it is created again.${extras.length ? ` Also removed now: ${extras.join(', ')}.` : ''}`,
      detail: 'To remove it for good, delete its service from the compose file.',
      confirmLabel: 'Delete container',
      altLabel: 'Open the compose file',
      danger: true,
    })
    if (c === 'alt') return navigateTo(`/stacks/${encodeURIComponent(stack)}`)
    if (c !== 'confirm') return
  } else if (!(await confirm({
    title: `Delete “${name}”?`,
    message: `Delete “${name}” permanently?${extras.length ? ` Also removed: ${extras.join(', ')}.` : ''}`,
    detail: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  }))) return
  deleting.value = true
  try {
    const r = await $fetch<{ ok: boolean; notes?: string[] }>('/api/control', {
      method: 'POST',
      body: {
        id,
        action: 'remove',
        volumes: deleteVolumes.value,
        image: deleteImage.value,
        proxyRoutes: deleteProxyRoutes.value,
      },
    })
    if (r.notes?.length) {
      dangerSteps.value = r.notes.map((n) => ({ step: n, ok: !/kept:|failed|could not/i.test(n) }))
      // let the cleanup results be read before leaving the page
      setTimeout(() => navigateTo('/', { replace: true }), 2500)
    } else {
      await navigateTo('/', { replace: true })
    }
  } catch (e: any) {
    toast.error(errMsg(e, 'Delete failed'))
  } finally {
    deleting.value = false
  }
}

// --- controls ---
const busy = ref<'' | 'start' | 'stop' | 'restart'>('')
async function control(action: 'start' | 'stop' | 'restart') {
  if (action === 'stop' && !(await stackAware.confirmStop(service.value!))) return
  busy.value = action
  try {
    await $fetch('/api/control', { method: 'POST', body: { id, action } })
    await refresh()
  } catch (e: any) {
    toast.error(errMsg(e, 'Action failed'))
  } finally {
    busy.value = ''
  }
}

// --- update tab ---
const updatesEnabled = computed(() => updates.enabled.value)
// compose-managed containers update through their stack — but only when homeport
// actually manages that stack; foreign projects fall back to a direct recreate
const composeProject = computed(() => (service.value?.kind === 'container' ? service.value?.project : null))
const projectSiblings = computed(
  () => (data.value?.services ?? []).filter((s) => s.project && s.project === composeProject.value).length,
)
const stackChecked = ref(false)
const stackManaged = ref(false)
async function checkStackManaged() {
  if (!composeProject.value || !caps.value.stacks) {
    stackChecked.value = true
    return
  }
  // shared stacks store: the stack-aware stop/delete dialogs read it too
  const store = useStacks()
  await store.refresh()
  stackManaged.value = !!stackAware.stackOf(service.value) // false if stacks unavailable: direct update is the only path
  stackChecked.value = true
}
// resolved on load — the Overview danger zone, Update and Environment tabs all use it
watch(
  () => !!service.value && capsLoaded.value,
  (on) => { if (on && !stackChecked.value) checkStackManaged() },
  { immediate: true },
)
const updateEntry = computed(() => (service.value ? updates.entryFor(service.value) : undefined))
const changelogUrl = computed(() => (service.value ? updates.changelogUrlFor(service.value) : undefined))
const updateLabel = computed(() => {
  switch (updateEntry.value?.status) {
    case 'update': return 'update available'
    case 'current': return 'up to date'
    case 'local': return 'locally built'
    case 'pinned': return 'digest-pinned'
    case 'error': return 'check failed'
    default: return 'unknown'
  }
})
const updateBadgeCls = computed(() =>
  updateEntry.value?.status === 'update'
    ? 'badge-info'
    : updateEntry.value?.status === 'error'
      ? 'badge-warn'
      : updateEntry.value?.status === 'current'
        ? 'badge-ok'
        : '',
)

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

const applySteps = ref<{ step: string; ok: boolean; detail?: string }[]>([])
async function apply() {
  if (!(await confirm({ message: `Update “${service.value?.displayName}” to the latest image? The container will be recreated.`, confirmLabel: 'Update' }))) return
  applying.value = true
  applySteps.value = []
  try {
    const r = await $fetch<{ steps: typeof applySteps.value; newId?: string }>('/api/updates/apply', {
      method: 'POST',
      body: { id, image: service.value?.image },
    })
    applySteps.value = r.steps
    await Promise.all([refresh(), updates.refresh()])
    if (r.newId) {
      const sep = id.indexOf('::')
      const hostPrefix = sep >= 0 ? id.slice(0, sep) : 'default'
      newPage.value = `/services/${encodeURIComponent(`${hostPrefix}::${r.newId}`)}`
      if (r.steps.every((s) => s.ok)) {
        // clean update — follow the container to its new id
        redirecting.value = true
        setTimeout(() => navigateTo(newPage.value, { replace: true }), 1500)
      }
    }
  } catch (e: any) {
    applySteps.value = e?.data?.data?.steps || []
    toast.error(errMsg(e, 'Update failed'))
  } finally {
    applying.value = false
  }
}

// --- environment tab ---
interface EnvRow { key: string; value: string; keep: boolean; secret: boolean }
const envRows = ref<EnvRow[]>([])
const envLoaded = ref(false)
const envError = ref('')
const envSteps = ref<{ step: string; ok: boolean; detail?: string }[]>([])

async function loadEnv() {
  envError.value = ''
  try {
    const r = await $fetch<{ env: { key: string; value: string | null; secret: boolean }[] }>('/api/env', { query: { id } })
    envRows.value = r.env.map((e) => ({ key: e.key, value: e.value ?? '', keep: e.value === null, secret: e.secret }))
  } catch (e: any) {
    envError.value = errMsg(e, 'could not read the environment')
  }
  envLoaded.value = true
}
function reloadEnv() {
  envLoaded.value = false
  envSteps.value = []
  loadEnv()
}
watch(
  () => tab.value === 'env' && !!service.value && !stackManaged.value,
  (on) => { if (on && !envLoaded.value) loadEnv() },
  { immediate: true },
)

async function applyEnv() {
  if (!(await confirm({ message: `Recreate “${service.value?.displayName}” with the edited environment?`, confirmLabel: 'Recreate' }))) return
  applying.value = true
  envSteps.value = []
  try {
    const r = await $fetch<{ steps: typeof envSteps.value; newId?: string }>('/api/env', {
      method: 'POST',
      body: { id, env: envRows.value.map((row) => ({ key: row.key.trim(), value: row.keep ? null : row.value })) },
    })
    envSteps.value = r.steps
    envSnapshot.value = JSON.stringify(envRows.value) // applied: no longer an unsaved edit
    await refresh()
    if (r.newId) {
      const sep = id.indexOf('::')
      const hostPrefix = sep >= 0 ? id.slice(0, sep) : 'default'
      newPage.value = `/services/${encodeURIComponent(`${hostPrefix}::${r.newId}`)}`
      if (r.steps.every((s) => s.ok)) {
        redirecting.value = true
        setTimeout(() => navigateTo(newPage.value, { replace: true }), 1500)
      }
    } else {
      reloadEnv() // demo / same id — re-read what's now in place
      envSteps.value = r.steps
    }
  } catch (e: any) {
    envSteps.value = e?.data?.data?.steps || []
    toast.error(errMsg(e, 'Environment change failed'))
  } finally {
    applying.value = false
  }
}

// a ?tab= this setup doesn't offer (capability off) falls back to the overview
// Unsaved edits on this page: the environment table, the restart policy and the limits.
const envSnapshot = ref('')
watch(envLoaded, (l) => {
  if (l) envSnapshot.value = JSON.stringify(envRows.value)
})
const envDirty = computed(() => envLoaded.value && !!envSnapshot.value && JSON.stringify(envRows.value) !== envSnapshot.value && !applying.value)
useUnsavedGuard(
  () => envDirty.value || (restart.policy !== null && restart.selected !== restart.policy) || (resources.loaded && resourcesDirty.value && !resources.saving),
  'Changes on this container page have not been applied.',
)

// (declared down here: `tabs` reads updateEntry, which is defined above this line)
watch(
  () => capsLoaded.value && tabs.value.length,
  (ready) => {
    if (ready && !tabs.value.some((t) => t.key === tab.value)) tab.value = 'overview'
  },
  { immediate: true },
)

onMounted(() => {
  initHistory()
  loadRestartPolicy()
  loadResources()
  start()
  stats.start()
  pings.start()
  loadCaps()
  updates.refresh()
})
onBeforeUnmount(() => {
  stop()
  stats.stop()
  pings.stop()
})

useHead({ title: computed(() => `${service.value?.displayName ?? 'Container'} · homeport`) })
</script>
