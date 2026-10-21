<template>
  <div class="space-y-4">
    <p class="text-xs text-slate-500">
      Give someone read-only access to view your fleet without a viewer being able to start, stop, or
      change anything — no control, updates, terminal, or settings. The admin password stays separate.
    </p>

    <!-- create -->
    <div class="flex flex-wrap items-end gap-2">
      <div>
        <label class="field-label mb-0">Username</label>
        <input v-model="username" :class="fieldCls" placeholder="e.g. teammate" @keyup.enter="create" />
      </div>
      <div>
        <label class="field-label mb-0">Password</label>
        <input v-model="password" type="password" :class="fieldCls" placeholder="Password" autocomplete="new-password" @keyup.enter="create" />
      </div>
      <button
        type="button"
        :disabled="busy"
        class="rounded-md border border-accent/30 px-3 py-2 text-xs text-accent-light hover:bg-accent/10 disabled:opacity-40"
        @click="create"
      >{{ busy ? 'Creating…' : 'Create account' }}</button>
    </div>

    <!-- list -->
    <div v-if="users.length" class="space-y-2">
      <div
        v-for="u in users"
        :key="u.id"
        class="flex flex-wrap items-center gap-2 rounded-md border border-white/5 bg-ink-900/60 px-3 py-2"
      >
        <span class="text-sm text-slate-200">{{ u.username }}</span>
        <span class="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">read-only</span>
        <span class="text-[11px] text-slate-600">
          created {{ rel(u.createdAt) }} · {{ u.lastLoginAt ? `last login ${rel(u.lastLoginAt)}` : 'never logged in' }}
        </span>
        <button
          type="button"
          class="ml-auto rounded border border-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
          @click="remove(u)"
        >Delete</button>
      </div>
    </div>
    <p v-else class="text-xs text-slate-600">No viewer accounts yet.</p>
  </div>
</template>

<script setup lang="ts">
interface UserMeta { id: string; username: string; createdAt: number; lastLoginAt?: number }

const fieldCls = 'mt-1 input'
const { confirm: confirmDialog } = useConfirm()
const toast = useToast()

const users = ref<UserMeta[]>([])
const username = ref('')
const password = ref('')
const busy = ref(false)

async function load() {
  try {
    users.value = (await $fetch<{ users: UserMeta[] }>('/api/users')).users
  } catch {
    // unreachable / not admin — leave the list empty
  }
}

async function create() {
  if (busy.value) return
  busy.value = true
  try {
    await $fetch('/api/users', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    username.value = ''
    password.value = ''
    await load()
  } catch (e: any) {
    toast.error(errMsg(e, 'Could not create account'))
  } finally {
    busy.value = false
  }
}

async function remove(u: UserMeta) {
  if (!(await confirmDialog({ message: `Delete the account "${u.username}"? It will be signed out immediately.`, confirmLabel: 'Delete', danger: true }))) return
  try {
    await $fetch(`/api/users?id=${encodeURIComponent(u.id)}`, { method: 'DELETE' })
    await load()
  } catch (e: any) {
    toast.error(errMsg(e, 'Delete failed'))
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
