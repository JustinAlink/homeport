<template>
  <section class="mb-6" aria-labelledby="deploy-on-push-title">
    <div class="card overflow-hidden">
      <div class="card-header">
        <Icon name="git-branch" class="h-4 w-4 text-slate-500" />
        <h2 id="deploy-on-push-title" class="card-title">Deploy on push</h2>
        <span v-if="view?.hook && view.available" class="badge badge-ok">webhook on</span>
        <span v-if="view?.autoSync.enabled" class="badge badge-info">auto-sync every {{ intervalLabel(view.autoSync.intervalMin) }}</span>
      </div>

      <div v-if="loadErr" class="p-4 sm:p-5"><p class="callout callout-warn text-xs"><Icon name="alert" /><span>{{ loadErr }}</span></p></div>
      <div v-else-if="!view" class="skeleton m-4 h-24 sm:m-5" />

      <div v-else class="divide-y divide-white/[0.06]">
        <!-- homeport's own stack: neither half applies -->
        <p v-if="view.self" class="callout callout-warn m-4 text-xs sm:m-5">
          <Icon name="alert" />
          <span>This is homeport's own stack. It never updates itself from git, because the update would stop homeport halfway through. Use <strong>Update homeport</strong> in the sidebar instead.</span>
        </p>

        <!-- webhook -->
        <div v-else class="space-y-3.5 p-4 sm:p-5">
          <div class="flex flex-wrap items-start gap-3">
            <div class="min-w-0 flex-1 basis-64">
              <h3 class="text-[13.5px] font-medium text-slate-100">Webhook</h3>
              <p class="mt-0.5 text-xs leading-relaxed text-slate-500">
                Your git host calls homeport when <code>{{ branch }}</code> changes, and the stack updates within seconds, like
                <strong class="font-medium text-slate-400">Update from git</strong>. Pushes to other branches are ignored.
              </p>
            </div>
            <button v-if="view.hook" type="button" class="btn btn-ghost btn-sm hover:!text-red-300" :disabled="busy" @click="remove">
              <Icon name="trash" /> Remove webhook
            </button>
          </div>

          <!-- off: say what switching it on means, and where -->
          <div v-if="!view.available" class="callout callout-info text-xs">
            <Icon name="info" />
            <div class="min-w-0 flex-1">
              <p>
                Webhooks are turned off. Turning them on opens one public URL for each stack that has a webhook; every call has to carry
                that stack's secret, or homeport refuses it.
                <template v-if="view.hook"> This stack's webhook answers 403 until then.</template>
              </p>
              <p v-if="view.locked" class="mt-1.5">Set by <code>HOMEPORT_ALLOW_GIT_WEBHOOKS</code> on the homeport container.</p>
              <NuxtLink v-else to="/settings?tab=capabilities" class="btn btn-sm mt-2">Turn them on in Settings</NuxtLink>
            </div>
          </div>

          <div v-else-if="!view.hook" class="flex flex-wrap items-center gap-3">
            <button type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="create">
              <Icon name="plus" /> {{ busy ? 'Creating…' : 'Create webhook' }}
            </button>
            <span class="text-xs text-slate-500">You get a URL and a secret to paste into GitHub, Gitea, Forgejo, GitLab or a script.</span>
          </div>

          <!-- with webhooks off, an existing hook shows only its last delivery: no URL to hand out, no secret to regenerate -->
          <template v-if="view.hook && view.available">
            <!-- the URL -->
            <Field label="Payload URL">
              <template #default="{ id }">
                <div class="flex items-center gap-2">
                  <input :id="id" class="input min-w-0 flex-1 font-mono text-xs" readonly :value="hookUrl" @focus="selectAll" />
                  <CopyButton :text="hookUrl" label="the webhook URL" />
                </div>
              </template>
            </Field>
            <p v-if="privateReason" class="callout callout-warn text-xs">
              <Icon name="alert" />
              <span>
                <code>{{ hostName }}</code> {{ privateReason }}, so github.com and gitlab.com cannot reach this URL; a Gitea or Forgejo on the
                same network can. For a hosted forge, open homeport through its public domain and copy the URL from there (the
                <code>/api/hooks/git/</code> path must be reachable through your proxy), or use auto-sync below.
              </span>
            </p>

            <!-- the secret: shown once, right after it is made -->
            <div v-if="secret" class="rounded-lg border border-accent/30 bg-accent/5 p-3" role="status">
              <Field label="Secret">
                <template #default="{ id }">
                  <div class="flex items-center gap-2">
                    <input :id="id" ref="secretInput" class="input min-w-0 flex-1 font-mono text-xs" readonly :value="secret" @focus="selectAll" />
                    <CopyButton :text="secret" label="the secret" />
                  </div>
                </template>
                <template #hint>Copy it now: homeport keeps it, but never shows it again. Lost it? Regenerate, and paste the new one.</template>
              </Field>
              <button type="button" class="btn btn-sm mt-2.5" @click="secret = ''">I have copied it</button>
            </div>
            <div v-else class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              <span class="field-label mb-0">Secret</span>
              <span class="text-slate-500">
                Set {{ when(view.hook.rotatedAt || view.hook.createdAt) }}, shown only when it was made.
              </span>
              <button type="button" class="btn btn-sm" :disabled="busy" @click="regenerate"><Icon name="refresh" /> Regenerate secret</button>
            </div>

            <!-- where it goes, per forge -->
            <div>
              <div class="mb-2.5 flex flex-wrap items-center gap-2">
                <span id="forge-label" class="text-xs text-slate-500">Set it up in</span>
                <div class="segmented segmented-sm" role="group" aria-labelledby="forge-label">
                  <button v-for="f in FORGES" :key="f.key" type="button" :aria-pressed="forge === f.key" @click="forge = f.key">{{ f.label }}</button>
                </div>
                <a v-if="forgeLink" :href="forgeLink" target="_blank" rel="noopener noreferrer" class="link ml-auto inline-flex items-center gap-1 text-xs">
                  Open the repository's webhook settings <Icon name="external" class="h-3 w-3" />
                </a>
              </div>
              <ol class="list-decimal space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-slate-300 marker:text-slate-500">
                <template v-if="forge === 'github'">
                  <li>In the repository, open <b>Settings</b>, <b>Webhooks</b>, <b>Add webhook</b>.</li>
                  <li><b>Payload URL</b>: the URL above. <b>Content type</b>: <code>application/json</code>.</li>
                  <li><b>Secret</b>: the secret. <b>Which events</b>: <i>Just the push event</i>. Keep <b>Active</b> ticked and add it.</li>
                  <li>GitHub sends a ping straight away: it shows up under Last delivery below.</li>
                </template>
                <template v-else-if="forge === 'gitea'">
                  <li>In the repository, open <b>Settings</b>, <b>Webhooks</b>, <b>Add webhook</b>, and pick <b>Gitea</b> (or <b>Forgejo</b>).</li>
                  <li><b>Target URL</b>: the URL above. <b>HTTP method</b>: POST. <b>POST content type</b>: <code>application/json</code>.</li>
                  <li><b>Secret</b>: the secret. <b>Trigger on</b>: <i>Push events</i>. <b>Branch filter</b>: <code>{{ branch }}</code>, or leave <code>*</code>.</li>
                  <li>Add it, then <b>Test delivery</b> sends a push to check the setup.</li>
                </template>
                <template v-else-if="forge === 'gitlab'">
                  <li>In the project, open <b>Settings</b>, <b>Webhooks</b>, <b>Add new webhook</b>.</li>
                  <li><b>URL</b>: the URL above. <b>Secret token</b>: the secret.</li>
                  <li><b>Trigger</b>: <i>Push events</i> (and <i>Tag push events</i> when the stack follows a tag). Add it, then <b>Test</b>, <i>Push events</i>.</li>
                  <li>
                    GitLab 19 and later can sign each delivery instead of sending the secret along: choose <b>Generate signing token</b> and
                    paste it below. Both can be set at once.
                  </li>
                </template>
                <template v-else>
                  <li>
                    POST to the URL with the secret in a header: <code>X-Homeport-Secret: &lt;secret&gt;</code> or
                    <code>Authorization: Bearer &lt;secret&gt;</code>. An empty body always deploys; a JSON body with
                    <code>"ref": "refs/heads/{{ branch }}"</code> deploys only for that ref.
                    <div class="mt-1.5 flex max-w-full items-start gap-2">
                      <pre class="min-w-0 flex-1 overflow-x-auto rounded-md border border-white/[0.06] bg-ink-950/70 px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed text-slate-300">{{ curlExample }}</pre>
                      <CopyButton :text="curlExample" label="the curl command" class="mt-1" />
                    </div>
                  </li>
                  <li>Bitbucket: <b>Repository settings</b>, <b>Webhooks</b>, <b>Add webhook</b>, with the URL, the secret and the <i>Repository push</i> trigger.</li>
                </template>
              </ol>

              <!-- GitLab's own signing token (Standard Webhooks) -->
              <form v-if="forge === 'gitlab'" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="saveSigningKey">
                <Field class="min-w-0 flex-1 basis-64" label="GitLab signing token" optional>
                  <template #default="{ id }">
                    <input
                      :id="id"
                      v-model="signingKey"
                      class="input input-sm font-mono"
                      type="password"
                      autocomplete="off"
                      spellcheck="false"
                      :placeholder="view.hook.signingKeySet ? 'saved (paste a new one to replace it)' : 'whsec_…'"
                    />
                  </template>
                </Field>
                <button type="submit" class="btn btn-sm" :disabled="busy || !signingKey.trim()">Save</button>
                <button v-if="view.hook.signingKeySet" type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="clearSigningKey">Forget it</button>
              </form>
            </div>
          </template>

          <!-- what happened last -->
          <div v-if="view.hook" aria-live="polite">
            <p class="field-label">Last delivery</p>
            <div v-if="view.lastDelivery" class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]">
              <Icon :name="RESULT_ICON[view.lastDelivery.result].icon" class="h-3.5 w-3.5 shrink-0" :class="RESULT_ICON[view.lastDelivery.result].cls" />
              <span class="min-w-0 text-slate-200">{{ deliveryText(view.lastDelivery) }}</span>
              <span class="badge font-mono" :title="`homeport answered HTTP ${view.lastDelivery.status}`">{{ view.lastDelivery.status }}</span>
              <span class="text-slate-500" :title="new Date(view.lastDelivery.at).toLocaleString()">{{ ago(view.lastDelivery.at) }}</span>
              <button v-if="view.lastDelivery.opLive && view.lastDelivery.opId" type="button" class="link text-xs" @click="emit('show-op', view.lastDelivery.opId)">Show output</button>
            </div>
            <p v-else class="text-xs text-slate-500">None yet. A ping or a test delivery from your git host shows up here.</p>
          </div>
        </div>

        <!-- auto-sync -->
        <div v-if="!view.self" class="space-y-3 p-4 sm:p-5">
          <div>
            <h3 class="text-[13.5px] font-medium text-slate-100">Auto-sync</h3>
            <p class="mt-0.5 text-xs leading-relaxed text-slate-500">
              No webhook possible (homeport is not reachable from your git host)? homeport asks the repository for new commits on
              <code>{{ branch }}</code> itself, and updates the stack when there are some. A commit whose update failed is not retried
              on its own.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <label class="check">
              <input type="checkbox" :checked="view.autoSync.enabled" :disabled="syncBusy" @change="saveAutoSync(($event.target as HTMLInputElement).checked, interval)" />
              <span>Update when the repository moves</span>
            </label>
            <div class="flex items-center gap-2">
              <label for="auto-sync-interval" class="text-xs text-slate-400">Check every</label>
              <select
                id="auto-sync-interval"
                v-model.number="interval"
                class="select input-sm w-auto"
                :disabled="syncBusy"
                @change="saveAutoSync(view.autoSync.enabled, interval)"
              >
                <option v-for="m in intervalOptions" :key="m" :value="m">{{ intervalLabel(m) }}</option>
              </select>
            </div>
          </div>
          <p v-if="view.autoSync.enabled || view.lastSync" class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]" aria-live="polite">
            <template v-if="view.lastSync">
              <Icon :name="SYNC_ICON[view.lastSync.result].icon" class="h-3.5 w-3.5 shrink-0" :class="SYNC_ICON[view.lastSync.result].cls" />
              <span class="text-slate-300">Checked {{ ago(view.lastSync.at) }}: {{ syncText(view.lastSync) }}</span>
              <button v-if="view.lastSync.opLive && view.lastSync.opId" type="button" class="link text-xs" @click="emit('show-op', view.lastSync.opId)">Show output</button>
            </template>
            <span v-else-if="view.demo" class="text-xs text-slate-500">Demo mode: nothing is checked.</span>
            <span v-else class="text-xs text-slate-500">First check within a minute.</span>
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// "Deploy on push" for a git-backed stack: its webhook (URL, secret shown once,
// per-forge setup, last delivery) and auto-sync (poll interval, last check).
// Config lives here, on the stack's own page; the capability switch that opens
// the public endpoint lives in Settings. Server side: server/utils/git-webhooks.ts.
import {
  AUTO_SYNC_PRESETS,
  deliveryText,
  forgeHooksUrl,
  guessForge,
  intervalLabel,
  privateHostReason,
  syncText,
  type DeliveryRecord,
  type DeliveryResult,
  type Forge,
  type SyncRecord,
  type SyncResult,
} from '~/shared/utils/git-webhooks'

const props = defineProps<{ stack: string; branch: string; repo: string }>()
const emit = defineEmits<{ 'show-op': [opId: string]; deployed: [] }>()

interface View {
  available: boolean
  locked: boolean
  git: boolean
  self: boolean
  demo: boolean
  hook: { path: string; createdAt: number; rotatedAt?: number; signingKeySet: boolean } | null
  autoSync: { enabled: boolean; intervalMin: number }
  lastDelivery: (DeliveryRecord & { opLive: boolean }) | null
  lastSync: (SyncRecord & { opLive: boolean }) | null
}

const FORGES: { key: Forge; label: string }[] = [
  { key: 'github', label: 'GitHub' },
  { key: 'gitea', label: 'Gitea / Forgejo' },
  { key: 'gitlab', label: 'GitLab' },
  { key: 'other', label: 'Other' },
]

const RESULT_ICON: Record<DeliveryResult, { icon: string; cls: string }> = {
  queued: { icon: 'refresh', cls: 'animate-spin text-amber-300' },
  deploying: { icon: 'refresh', cls: 'animate-spin text-amber-300' },
  deployed: { icon: 'check', cls: 'text-ok' },
  failed: { icon: 'x', cls: 'text-red-300' },
  rejected: { icon: 'x', cls: 'text-red-300' },
  ignored: { icon: 'info', cls: 'text-slate-400' },
  refused: { icon: 'info', cls: 'text-slate-400' },
  pong: { icon: 'check', cls: 'text-sky-300' },
  demo: { icon: 'check', cls: 'text-sky-300' },
}
const SYNC_ICON: Record<SyncResult, { icon: string; cls: string }> = {
  'up-to-date': { icon: 'check', cls: 'text-ok' },
  deploying: { icon: 'refresh', cls: 'animate-spin text-amber-300' },
  deployed: { icon: 'check', cls: 'text-ok' },
  failed: { icon: 'x', cls: 'text-red-300' },
  unreachable: { icon: 'alert', cls: 'text-amber-300' },
  held: { icon: 'alert', cls: 'text-amber-300' },
  refused: { icon: 'info', cls: 'text-slate-400' },
}

const { confirm } = useConfirm()
const toast = useToast()
const timers = usePageTimers()

const view = ref<View | null>(null)
const loadErr = ref('')
const busy = ref(false)
const syncBusy = ref(false)
const secret = ref('')
const secretInput = ref<HTMLInputElement | null>(null)
const signingKey = ref('')
const forge = ref<Forge>(guessForge(props.repo))
const interval = ref(5)
const origin = ref('')

const api = computed(() => `/api/stacks/${encodeURIComponent(props.stack)}/webhook`)
const hookUrl = computed(() => (view.value?.hook ? `${origin.value}${view.value.hook.path}` : ''))
const hostName = computed(() => {
  try {
    return new URL(origin.value).hostname
  } catch {
    return ''
  }
})
const privateReason = computed(() => (hostName.value ? privateHostReason(hostName.value) : null))
const forgeLink = computed(() => forgeHooksUrl(props.repo, forge.value))
const curlExample = computed(() => `curl -X POST -H "X-Homeport-Secret: $SECRET" \\\n  ${hookUrl.value}`)
// a stored interval that is not a preset (set through the API) still shows
const intervalOptions = computed(() => [...new Set([...AUTO_SYNC_PRESETS, view.value?.autoSync.intervalMin ?? 5])].sort((a, b) => a - b))

function apply(v: View) {
  const wasPending = isPending(view.value)
  view.value = v
  interval.value = v.autoSync.intervalMin
  loadErr.value = ''
  // a deploy this card was waiting on has finished: the page's git bar and editor are stale now
  if (wasPending && !isPending(v)) emit('deployed')
}

function isPending(v: View | null): boolean {
  const d = v?.lastDelivery?.result
  return d === 'queued' || d === 'deploying' || v?.lastSync?.result === 'deploying'
}

async function load() {
  try {
    apply(await $fetch<View>(api.value))
  } catch (e: any) {
    loadErr.value = errMsg(e, 'Could not load the deploy-on-push settings')
  }
}

async function post(body: Record<string, unknown>): Promise<(View & { secret?: string }) | null> {
  try {
    const r = await $fetch<View & { secret?: string }>(api.value, { method: 'POST', body })
    apply(r)
    return r
  } catch (e: any) {
    toast.error(errMsg(e, 'Could not save'))
    return null
  }
}

async function showSecret(s?: string) {
  if (!s) return
  secret.value = s
  await nextTick()
  secretInput.value?.focus()
}

async function create() {
  busy.value = true
  const r = await post({ op: 'create' })
  busy.value = false
  await showSecret(r?.secret)
}

async function regenerate() {
  const ok = await confirm({
    title: 'Regenerate the secret?',
    message: `The current secret stops working right away: deliveries for ${props.stack} fail with 401 until you paste the new one into your git host.`,
    confirmLabel: 'Regenerate',
  })
  if (!ok) return
  busy.value = true
  const r = await post({ op: 'regenerate' })
  busy.value = false
  await showSecret(r?.secret)
}

async function remove() {
  const ok = await confirm({
    title: 'Remove the webhook?',
    message: `Deliveries to this URL get 404 from now on. Remove the webhook from your git host as well, or it keeps reporting failures.`,
    confirmLabel: 'Remove webhook',
    danger: true,
  })
  if (!ok) return
  busy.value = true
  secret.value = ''
  await post({ op: 'remove' })
  busy.value = false
}

async function saveSigningKey() {
  busy.value = true
  const r = await post({ op: 'signing-key', signingKey: signingKey.value.trim() })
  busy.value = false
  if (r) {
    signingKey.value = ''
    toast.success('GitLab signing token saved')
  }
}

async function clearSigningKey() {
  busy.value = true
  await post({ op: 'signing-key', signingKey: '' })
  busy.value = false
}

async function saveAutoSync(enabled: boolean, intervalMin: number) {
  syncBusy.value = true
  await post({ op: 'auto-sync', enabled, intervalMin })
  syncBusy.value = false
}

function selectAll(e: FocusEvent) {
  ;(e.target as HTMLInputElement).select()
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

function when(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Poll while something is on its way (a queued push, a running deploy) and
// slowly otherwise, so a ping sent from the forge shows up without a reload.
async function poll() {
  while (timers.alive()) {
    await timers.wait(isPending(view.value) ? 4000 : 20000)
    if (!timers.alive()) return
    if (document.visibilityState === 'visible') await load()
  }
}

onMounted(() => {
  origin.value = window.location.origin
  load()
  poll()
})
</script>
