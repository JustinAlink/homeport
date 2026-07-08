<template>
  <div class="space-y-4">
    <p class="text-xs text-slate-500">
      Long-lived tokens for automation (scripts, bots) — call the API with
      <code>Authorization: Bearer &lt;token&gt;</code> instead of the admin password. A
      <b>read-only</b> token can only make GET requests; a <b>full</b> token can do anything you can.
    </p>

    <!-- create -->
    <div class="flex flex-wrap items-end gap-2">
      <div>
        <label class="text-[11px] uppercase tracking-wider text-slate-500">Name</label>
        <input v-model="name" :class="fieldCls" placeholder="e.g. junibot" @keyup.enter="create" />
      </div>
      <div>
        <label class="text-[11px] uppercase tracking-wider text-slate-500">Scope</label>
        <select v-model="scope" :class="[fieldCls, 'max-w-[11rem]']">
          <option value="read">Read-only</option>
          <option value="full">Full access</option>
        </select>
      </div>
      <button
        type="button"
        :disabled="busy"
        class="rounded-md border border-accent/30 px-3 py-2 text-xs text-accent-light hover:bg-accent/10 disabled:opacity-40"
        @click="create"
      >{{ busy ? 'Creating…' : 'Create token' }}</button>
    </div>

    <!-- one-time reveal -->
    <div v-if="fresh" class="space-y-1 rounded-md border border-accent/30 bg-accent/5 p-3">
      <p class="text-[11px] text-accent-light">Copy this now — it won't be shown again.</p>
      <div class="flex items-center gap-2">
        <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-ink-950 px-2 py-1.5 font-mono text-xs text-slate-100">{{ fresh }}</code>
        <button type="button" class="shrink-0 rounded-md border border-white/10 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5" @click="copy(fresh)">
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </div>

    <!-- list -->
    <div v-if="tokens.length" class="space-y-2">
      <div
        v-for="t in tokens"
        :key="t.id"
        class="flex flex-wrap items-center gap-2 rounded-md border border-white/5 bg-ink-900/60 px-3 py-2"
      >
        <span class="text-sm text-slate-200">{{ t.name }}</span>
        <span
          class="rounded-full border px-1.5 py-0.5 text-[10px] uppercase"
          :class="t.scope === 'full' ? 'border-amber-400/30 text-amber-300' : 'border-white/10 text-slate-400'"
        >{{ t.scope === 'full' ? 'full' : 'read-only' }}</span>
        <code class="font-mono text-[11px] text-slate-500">{{ t.prefix }}</code>
        <span class="text-[11px] text-slate-600">· {{ t.lastUsedAt ? `used ${rel(t.lastUsedAt)}` : 'never used' }}</span>
        <button
          type="button"
          class="ml-auto rounded border border-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
          @click="revoke(t)"
        >Revoke</button>
      </div>
    </div>
    <p v-else class="text-xs text-slate-600">No tokens yet.</p>
  </div>
</template>

<script setup lang="ts">
interface TokenMeta { id: string; name: string; scope: 'read' | 'full'; prefix: string; createdAt: number; lastUsedAt?: number }

const fieldCls = 'mt-1 w-full rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50'
const { confirm } = useConfirm()
const toast = useToast()

const tokens = ref<TokenMeta[]>([])
const name = ref('')
const scope = ref<'read' | 'full'>('read')
const busy = ref(false)
const fresh = ref('')
const copied = ref(false)

async function load() {
  try {
    tokens.value = (await $fetch<{ tokens: TokenMeta[] }>('/api/tokens')).tokens
  } catch {
    // unreachable / not admin — leave the list empty
  }
}

async function create() {
  if (busy.value) return
  busy.value = true
  try {
    const r = await $fetch<{ token: string; meta: TokenMeta }>('/api/tokens', {
      method: 'POST',
      body: { name: name.value, scope: scope.value },
    })
    fresh.value = r.token
    copied.value = false
    name.value = ''
    await load()
  } catch (e: any) {
    toast.error(errMsg(e, 'Could not create token'))
  } finally {
    busy.value = false
  }
}

async function revoke(t: TokenMeta) {
  if (!(await confirm({ message: `Revoke the token "${t.name}"? Anything using it will stop working.`, confirmLabel: 'Revoke', danger: true }))) return
  try {
    await $fetch(`/api/tokens?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' })
    await load()
  } catch (e: any) {
    toast.error(errMsg(e, 'Revoke failed'))
  }
}

async function copy(s: string) {
  try {
    await navigator.clipboard.writeText(s)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    toast.error('Copy failed — select the token and copy it manually')
  }
}

function rel(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

onMounted(load)
</script>
