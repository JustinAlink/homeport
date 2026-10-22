<template>
  <div v-if="r.ok === false && service" class="callout callout-warn" :class="compact ? 'py-2 text-xs' : ''">
    <Icon name="alert" />
    <div class="min-w-0 flex-1">
      <p>
        Your reverse proxy (<span class="font-medium text-slate-100">{{ r.proxy?.displayName }}</span>) can't reach
        <span class="font-medium text-slate-100">{{ service.displayName }}</span>: they share no network, so the domain
        answers with an error (usually 502).
        <template v-if="r.suggest">Connect it to <span class="font-mono">{{ r.suggest }}</span>, the proxy's network.</template>
      </p>
      <div v-if="r.suggest && caps.control && caps.stacks" class="mt-2 flex flex-wrap items-center gap-3">
        <button class="btn btn-sm btn-accent" :disabled="busy" @click="fix">
          <Icon name="network" /> {{ busy ? 'Connecting…' : `Connect to ${r.suggest}` }}
        </button>
        <label v-if="netOps.canSave(service)" class="check text-xs text-slate-400">
          <input v-model="save" type="checkbox" /> Also save it to the stack's compose file
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Service } from '~/types/service'

// "The proxy can't reach this container" with a one-click fix. Renders nothing
// when the proxy can reach it, or when homeport can't tell (no proxy container
// found, host networking).
const props = withDefaults(defineProps<{ service: Service | null | undefined; compact?: boolean; anyRoute?: boolean }>(), { compact: false, anyRoute: false })
const { caps } = useCapabilities()
const reachApi = useProxyReach()
const netOps = useNetworkOps()
// `anyRoute`: judge reachability even before a route exists (the domain form)
const r = computed(() => (props.service ? (props.anyRoute ? reachApi.reach(props.service) : reachApi.domainReach(props.service)) : { ok: null, proxy: null, shared: [], suggest: null }))
const busy = ref(false)
const save = ref(true)
async function fix() {
  if (!props.service || !r.value.suggest) return
  busy.value = true
  await netOps.connect(r.value.suggest, props.service, { save: save.value && netOps.canSave(props.service) })
  busy.value = false
}
</script>
