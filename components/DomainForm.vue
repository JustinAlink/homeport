<template>
  <form class="space-y-3 rounded-lg border border-white/10 bg-ink-900 p-4" @submit.prevent="submit">
    <div>
      <label class="text-[11px] uppercase tracking-wider text-slate-500">Domains</label>
      <input
        v-model="domainsText"
        :class="fieldCls"
        placeholder="app.example.com, www.app.example.com"
      />
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="text-[11px] uppercase tracking-wider text-slate-500">Upstream host</label>
        <input v-model="form.upstreamHost" :class="fieldCls" placeholder="container-name or IP" />
      </div>
      <div>
        <label class="text-[11px] uppercase tracking-wider text-slate-500">Port</label>
        <input v-model.number="form.upstreamPort" type="number" min="1" :class="fieldCls" />
      </div>
    </div>
    <label class="flex items-center gap-2 text-sm text-slate-200">
      <input v-model="form.ssl" type="checkbox" /> SSL / HTTPS
    </label>
    <div class="flex items-center gap-3">
      <button
        type="submit"
        :disabled="busy"
        class="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-50"
      >{{ busy ? 'Saving…' : submitLabel }}</button>
      <button v-if="cancelable" type="button" class="text-xs text-slate-400 hover:text-slate-200" @click="$emit('cancel')">Cancel</button>
      <span v-if="msg" class="whitespace-pre-line text-[11px]" :class="msgOk ? 'text-accent-light' : 'text-red-400'">{{ msg }}</span>
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

const fieldCls = 'mt-1 w-full rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50'

const form = reactive({
  upstreamHost: props.initial?.upstreamHost ?? '',
  upstreamPort: props.initial?.upstreamPort ?? 80,
  ssl: props.initial?.ssl ?? true,
})
const domainsText = ref((props.initial?.domains ?? []).join(', '))
const busy = ref(false)
const msg = ref('')
const msgOk = ref(false)

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
    msg.value = e?.statusMessage || e?.message || 'Save failed'
  } finally {
    busy.value = false
  }
}
</script>
