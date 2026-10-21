<template>
  <form class="space-y-3 card p-4 sm:p-5" @submit.prevent="submit">
    <div v-if="showPicker && pickables.length">
      <label class="field-label">Point at a container</label>
      <select v-model="picked" class="select" @change="applyPick">
        <option value="">Choose a running container, or fill in the fields below</option>
        <option v-for="c in pickables" :key="c.name" :value="c.name">
          {{ c.label }} → {{ c.name }}{{ c.port != null ? ':' + c.port : ' (set the port)' }}
        </option>
      </select>
      <p class="field-hint">Fills the upstream host and port for you. You can still edit them.</p>
    </div>
    <div>
      <label class="field-label">Domains</label>
      <input
        v-model="domainsText"
        class="input"
        placeholder="app.example.com, www.app.example.com"
      />
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="field-label">Upstream host</label>
        <input v-model="form.upstreamHost" class="input" placeholder="container-name or IP" />
      </div>
      <div>
        <label class="field-label">Port</label>
        <input v-model.number="form.upstreamPort" type="number" min="1" class="input" />
      </div>
    </div>
    <label class="check">
      <input v-model="form.ssl" type="checkbox" /> SSL / HTTPS
    </label>
    <div class="flex items-center gap-3">
      <button
        type="submit"
        :disabled="busy"
        class="btn btn-primary btn-sm"
      >{{ busy ? 'Saving…' : submitLabel }}</button>
      <button v-if="cancelable" type="button" class="btn btn-ghost btn-sm" @click="$emit('cancel')">Cancel</button>
      <span v-if="msg" class="whitespace-pre-line text-xs" :class="msgOk ? 'text-ok' : 'text-red-400'">{{ msg }}</span>
    </div>
  </form>
</template>

<script setup lang="ts">
interface RouteInput {
  id?: string
  domains: string[]
  upstreamHost: string
  upstreamPort: number
  ssl: boolean
}

const props = withDefaults(
  defineProps<{ initial?: Partial<RouteInput>; submitLabel?: string; cancelable?: boolean }>(),
  { submitLabel: 'Add domain', cancelable: false },
)
const emit = defineEmits<{ saved: [any]; cancel: [] }>()


const form = reactive({
  upstreamHost: props.initial?.upstreamHost ?? '',
  upstreamPort: props.initial?.upstreamPort ?? 80,
  ssl: props.initial?.ssl ?? true,
})
const domainsText = ref((props.initial?.domains ?? []).join(', '))
const busy = ref(false)
const msg = ref('')
const msgOk = ref(false)

// Container picker — only for a fresh "add" with no container context yet (the
// per-service Domains tab already prefills, so it passes an initial upstreamHost).
const showPicker = computed(() => !props.initial?.upstreamHost)
interface Pickable { name: string; port: number | null; label: string }
const pickables = ref<Pickable[]>([])
const picked = ref('')

function applyPick() {
  const c = pickables.value.find((p) => p.name === picked.value)
  if (!c) return
  form.upstreamHost = c.name
  // Only overwrite the port when we actually know one — don't fabricate a value.
  if (c.port != null) form.upstreamPort = c.port
}

onMounted(async () => {
  if (!showPicker.value) return
  try {
    const r = await $fetch<{ services: any[] }>('/api/services')
    pickables.value = (r.services ?? [])
      .filter((s) => s.kind === 'container')
      .map((s) => {
        // Upstream targets the container name on the shared proxy network, so the
        // container's internal port is what the proxy connects to — prefer that over
        // the host-published port (which is often absent for proxied containers).
        const port = s.ports?.[0]?.containerPort ?? s.internalPorts?.[0] ?? null
        return { name: s.name, port, label: s.displayName || s.name }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  } catch {
    // no picker if we can't list services — manual entry still works
  }
})

async function submit() {
  const domains = domainsText.value.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
  busy.value = true
  msg.value = ''
  try {
    const payload = { domains, upstreamHost: form.upstreamHost, upstreamPort: form.upstreamPort, ssl: form.ssl }
    const r = props.initial?.id
      ? await $fetch('/api/proxy/routes', { method: 'PUT', body: { id: props.initial.id, ...payload } })
      : await $fetch('/api/proxy/routes', { method: 'POST', body: payload })
    msgOk.value = true
    msg.value = 'Saved.'
    emit('saved', r)
  } catch (e: any) {
    msgOk.value = false
    msg.value = errMsg(e, 'Save failed')
  } finally {
    busy.value = false
  }
}
</script>
