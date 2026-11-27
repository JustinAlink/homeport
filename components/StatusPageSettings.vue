<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-[15px] font-semibold text-slate-100">Public status page</h2>
      <span class="badge" :class="enabled ? 'badge-ok' : ''">{{ enabled ? 'On' : 'Off' }}</span>
    </div>
    <p class="text-xs leading-relaxed text-slate-500">
      A read-only page anyone can open without logging in, for the people who use your apps. It shows only what you add below:
      the name you give each one, whether it is up, and its uptime. Never images, hosts, ports, addresses or error messages.
    </p>

    <p v-if="locked" class="text-xs text-slate-500">Set by <code>HOMEPORT_STATUS_PAGE</code>, locked.</p>
    <label class="check" :class="locked ? 'is-locked' : ''">
      <input v-model="enabled" type="checkbox" />
      <span>Publish the status page
        <span class="block text-[11px] text-slate-500">While it is off, <code>/status</code> answers "not found", like a page that doesn't exist.</span>
      </span>
    </label>

    <div class="rounded-lg border border-white/[0.08] bg-ink-950/40 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <Icon name="globe" class="h-4 w-4 shrink-0 text-slate-500" />
        <a :href="url" target="_blank" rel="noopener" class="link min-w-0 truncate font-mono text-[12.5px]">{{ url }}</a>
        <CopyButton :text="url" label="status page link" />
        <a href="/status?preview" target="_blank" rel="noopener" class="btn btn-sm ml-auto" data-testid="status-preview"><Icon name="eye" /> Preview</a>
      </div>
      <p class="field-hint">
        {{ enabled ? 'Share this link. People outside your network can open it only if homeport is reachable from the internet.' : 'The preview works while the page is off, and only for you.' }}
        <template v-if="dirty"> The preview shows saved settings, so save first to see your changes.</template>
      </p>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <Field v-slot="{ id }" label="Title" class="sm:col-span-2">
        <input :id="id" v-model="config.title" class="input" :maxlength="L.title" placeholder="Status" />
      </Field>
      <Field label="Notice" optional class="sm:col-span-2">
        <template #default="{ id }">
          <textarea :id="id" v-model="config.notice" class="textarea" rows="3" :maxlength="L.notice" :aria-describedby="`${id}-count`" placeholder="e.g. Jellyfin gets an update on Sunday at 20:00, so it is away for a few minutes." />
          <div class="mt-1.5 flex flex-wrap items-center gap-2">
            <div class="segmented segmented-sm" role="group" aria-label="Kind of notice">
              <button v-for="k in KINDS" :key="k.value" type="button" :aria-pressed="config.noticeKind === k.value" @click="config.noticeKind = k.value">
                <Icon :name="k.icon" class="h-3 w-3" />{{ k.label }}
              </button>
            </div>
            <span :id="`${id}-count`" class="ml-auto text-[11px] tabular-nums text-slate-500">{{ Array.from(config.notice).length }}/{{ L.notice }}</span>
          </div>
        </template>
        <template #hint>Plain text at the top of the page, for planned maintenance or a known problem. Leave it empty for none.</template>
      </Field>
    </div>

    <div class="space-y-3">
      <div>
        <h3 class="text-[13px] font-semibold text-slate-200">Shown on the page</h3>
        <p class="field-hint !mt-1">
          Nothing appears unless you add it here. The name is what visitors read: apps start with their friendly name, so change it if that
          name is one you'd rather keep to yourself. Domains also show the domain itself.
        </p>
      </div>

      <div v-for="(g, gi) in config.groups" :key="gi" class="rounded-lg border border-white/[0.08] bg-ink-950/40" :data-testid="`status-group-${gi}`">
        <div class="flex items-end gap-2 border-b border-white/[0.06] px-3 py-2.5">
          <Field v-slot="{ id }" :label="`Group ${gi + 1} name`" optional class="min-w-0 flex-1">
            <input :id="id" v-model="g.name" class="input input-sm" :maxlength="L.group" :placeholder="config.groups.length === 1 ? 'No heading' : 'e.g. Media'" />
          </Field>
          <button
            v-if="config.groups.length > 1"
            type="button"
            class="btn btn-ghost btn-icon btn-sm mb-0.5"
            :aria-label="`Remove group ${g.name || gi + 1}`"
            title="Remove group"
            @click="removeGroup(gi)"
          ><Icon name="trash" /></button>
        </div>

        <ul v-if="g.items.length" class="row-list">
          <li v-for="(it, ii) in g.items" :key="`${it.kind}:${it.ref}`" class="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2">
            <Icon :name="it.kind === 'domain' ? 'globe' : 'box'" class="h-4 w-4 shrink-0 text-slate-500" />
            <div class="min-w-0 flex-1 basis-48">
              <label :for="`sp-${gi}-${ii}`" class="sr-only">Name shown for {{ refLabel(it) }}</label>
              <input :id="`sp-${gi}-${ii}`" v-model="it.name" class="input input-sm" :maxlength="L.name" :placeholder="defaultItemName(it.kind, it.ref)" @blur="fillName(it)" />
              <p class="mt-0.5 truncate text-[11px] text-slate-500">
                {{ it.kind === 'domain' ? 'domain' : 'app' }} {{ refLabel(it) }}
                <span v-if="servicesLoaded && missing(it)" class="text-amber-300"> · not found right now, so it shows as unknown</span>
              </p>
            </div>
            <div class="flex items-center gap-1">
              <select
                v-if="config.groups.length > 1"
                class="select input-sm h-7 w-36 text-xs"
                :aria-label="`Group of ${it.name || refLabel(it)}`"
                :value="gi"
                @change="moveTo(gi, ii, Number(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="(og, ogi) in config.groups" :key="ogi" :value="ogi">{{ og.name || `Group ${ogi + 1}` }}</option>
              </select>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" :disabled="ii === 0" :aria-label="`Move ${it.name} up`" title="Move up" @click="swap(g.items, ii, ii - 1)"><Icon name="chevron-up" /></button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm" :disabled="ii === g.items.length - 1" :aria-label="`Move ${it.name} down`" title="Move down" @click="swap(g.items, ii, ii + 1)"><Icon name="chevron-down" /></button>
              <button type="button" class="btn btn-ghost btn-icon btn-sm hover:!text-red-300" :aria-label="`Remove ${it.name} from the page`" title="Remove" @click="g.items.splice(ii, 1)"><Icon name="x" /></button>
            </div>
          </li>
        </ul>
        <p v-else class="px-3 py-3 text-xs text-slate-500">Nothing in this group yet.</p>

        <div class="border-t border-white/[0.06] px-3 py-2.5">
          <button
            type="button"
            class="btn btn-sm"
            :aria-expanded="pickerFor === gi"
            :disabled="total >= L.items && pickerFor !== gi"
            @click="togglePicker(gi)"
          ><Icon :name="pickerFor === gi ? 'chevron-up' : 'plus'" /> {{ pickerFor === gi ? 'Done adding' : 'Add apps and domains' }}</button>
        </div>

        <div v-if="pickerFor === gi" class="space-y-2 border-t border-white/[0.06] px-3 py-3">
          <label :for="`sp-search-${gi}`" class="sr-only">Search apps and domains</label>
          <input :id="`sp-search-${gi}`" v-model="query" class="input input-sm" placeholder="Search apps and domains" spellcheck="false" />
          <ul v-if="candidates.length" class="max-h-72 overflow-y-auto rounded-md border border-white/[0.08] row-list" :aria-label="`Apps and domains to add to ${g.name || `group ${gi + 1}`}`">
            <li v-for="c in candidates" :key="`${c.kind}:${c.ref}`" class="flex items-center gap-2 px-2.5 py-1.5">
              <Icon :name="c.kind === 'domain' ? 'globe' : 'box'" class="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-[13px] text-slate-200">{{ c.label }}</p>
                <p class="truncate text-[11px] text-slate-500">{{ c.detail }}</p>
              </div>
              <button type="button" class="btn btn-sm" :disabled="total >= L.items" :aria-label="`Add ${c.label}`" @click="add(gi, c)">Add</button>
            </li>
          </ul>
          <p v-else class="text-xs text-slate-500">{{ query ? 'Nothing matches.' : servicesLoaded ? 'Everything is on the page already.' : 'Loading apps…' }}</p>
          <p v-if="total >= L.items" class="text-xs text-amber-300">A page holds at most {{ L.items }} items.</p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="btn btn-sm" :disabled="config.groups.length >= L.groups" @click="addGroup"><Icon name="plus" /> Add group</button>
        <span class="text-[11px] tabular-nums text-slate-500">{{ total }} of {{ L.items }} items</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'
import {
  STATUS_PAGE_LIMITS as L,
  defaultItemName,
  statusContainerKey,
  type NoticeKind,
  type StatusPageConfig,
  type StatusPageItem,
} from '~/shared/utils/status-page'

// The status page section of Settings (Monitoring & alerts). It edits the main
// settings form (saved with the save bar like everything else), so the preview
// and the public page always show what was last saved.
const enabled = defineModel<boolean>('enabled', { required: true })
const config = defineModel<StatusPageConfig>('config', { required: true })
const props = defineProps<{ locked: boolean; services: Service[] | null; dirty: boolean }>()
const { confirm } = useConfirm()

const KINDS: { value: NoticeKind; label: string; icon: string }[] = [
  { value: 'info', label: 'Info', icon: 'info' },
  { value: 'maintenance', label: 'Maintenance', icon: 'wrench' },
  { value: 'incident', label: 'Problem', icon: 'alert' },
]

const url = computed(() => `${useRequestURL().origin}/status`)
const servicesLoaded = computed(() => !!props.services)
const total = computed(() => config.value.groups.reduce((n, g) => n + g.items.length, 0))

interface Candidate {
  kind: StatusPageItem['kind']
  ref: string
  label: string
  detail: string
  name: string
}

// Everything that could go on the page: containers by their history key (which
// survives updates and recreates) and every mapped domain. Wildcards can't be checked.
const allCandidates = computed<Candidate[]>(() => {
  const list = (props.services ?? []).filter((s) => s.kind === 'container')
  const out: Candidate[] = []
  for (const s of [...list].sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    out.push({ kind: 'container', ref: statusContainerKey(s.id, s.name), label: s.displayName, detail: `app · container ${s.name}${s.host ? ` on ${s.host}` : ''}`, name: s.displayName })
  }
  const domains = new Map<string, string>()
  for (const s of list) for (const d of s.domains) if (!d.domain.includes('*') && !domains.has(d.domain)) domains.set(d.domain, s.displayName)
  for (const [domain, app] of [...domains].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push({ kind: 'domain', ref: domain.toLowerCase(), label: domain, detail: `domain · answered by ${app}`, name: domain })
  }
  return out
})
const picked = computed(() => new Set(config.value.groups.flatMap((g) => g.items.map((i) => `${i.kind}:${i.ref}`))))
const query = ref('')
const candidates = computed(() => {
  const q = query.value.trim().toLowerCase()
  return allCandidates.value.filter((c) => !picked.value.has(`${c.kind}:${c.ref}`) && (!q || `${c.label} ${c.detail}`.toLowerCase().includes(q)))
})

const known = computed(() => new Set(allCandidates.value.map((c) => `${c.kind}:${c.ref}`)))
const missing = (it: StatusPageItem) => !known.value.has(`${it.kind}:${it.ref}`)
const refLabel = (it: StatusPageItem) => (it.kind === 'container' ? it.ref.slice(it.ref.indexOf('|') + 1) : it.ref)
// an emptied name falls back to what the server would publish anyway: show it
const fillName = (it: StatusPageItem) => {
  if (!it.name.trim()) it.name = defaultItemName(it.kind, it.ref)
}

const pickerFor = ref<number | null>(null)
function togglePicker(gi: number) {
  pickerFor.value = pickerFor.value === gi ? null : gi
  query.value = ''
}
function add(gi: number, c: Candidate) {
  if (total.value >= L.items) return
  config.value.groups[gi].items.push({ kind: c.kind, ref: c.ref, name: c.name.slice(0, L.name) })
}
function swap<T>(arr: T[], a: number, b: number) {
  ;[arr[a], arr[b]] = [arr[b], arr[a]]
}
function moveTo(from: number, index: number, to: number) {
  if (from === to) return
  const [it] = config.value.groups[from].items.splice(index, 1)
  config.value.groups[to].items.push(it)
}
function addGroup() {
  config.value.groups.push({ name: '', items: [] })
}
async function removeGroup(gi: number) {
  const g = config.value.groups[gi]
  if (g.items.length && !(await confirm({
    title: 'Remove this group?',
    message: `${g.name || `Group ${gi + 1}`} and its ${g.items.length} item${g.items.length === 1 ? '' : 's'} come off the status page.`,
    confirmLabel: 'Remove group',
    danger: true,
  }))) return
  config.value.groups.splice(gi, 1)
  if (pickerFor.value != null && pickerFor.value >= config.value.groups.length) pickerFor.value = null
}
</script>
