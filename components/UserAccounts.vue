<template>
  <div class="space-y-4">
    <p class="text-xs text-slate-500">
      Give someone read-only access to view your fleet without a viewer being able to start, stop, or
      change anything: no control, updates, terminal, or settings. The admin password stays separate.
      Single sign-on adds its people here too, as read-only or admin as their groups say.
    </p>

    <!-- create -->
    <div class="flex flex-wrap items-end gap-2">
      <div>
        <label :for="`${uid}-user`" class="field-label mb-0">Username</label>
        <input :id="`${uid}-user`" v-model="username" :class="fieldCls" placeholder="e.g. teammate" @keyup.enter="create" />
      </div>
      <div>
        <label :for="`${uid}-pass`" class="field-label mb-0">Password</label>
        <input :id="`${uid}-pass`" v-model="password" type="password" :class="fieldCls" placeholder="Password" autocomplete="new-password" @keyup.enter="create" />
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
        <span v-if="u.role === 'admin'" class="rounded-full border border-accent/30 px-1.5 py-0.5 text-[10px] uppercase text-accent-light" title="In an admin group at the identity provider: full control">admin</span>
        <span v-else class="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">read-only</span>
        <span v-if="u.sso" class="rounded-full border border-sky-400/30 px-1.5 py-0.5 text-[10px] uppercase text-sky-300" :title="`Signs in through single sign-on (${u.sso.iss})`">SSO</span>
        <span class="text-[11px] text-slate-600">
          created {{ rel(u.createdAt) }} · {{ u.lastLoginAt ? `last login ${rel(u.lastLoginAt)}` : 'never logged in' }}
        </span>
        <button
          type="button"
          class="ml-auto rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.05]"
          :aria-label="`Sign ${u.username} out on every device`"
          title="Ends this account's sessions on every device. It can sign in again."
          @click="signOut(u)"
        >Sign out</button>
        <button
          type="button"
          class="rounded border border-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
          :aria-label="`Delete the account ${u.username}`"
          @click="remove(u)"
        >Delete</button>
      </div>
    </div>
    <p v-else class="text-xs text-slate-600">No viewer accounts yet.</p>
  </div>
</template>

<script setup lang="ts">
interface UserMeta { id: string; username: string; createdAt: number; lastLoginAt?: number; sso?: { iss: string; sub: string }; role?: 'admin' | 'viewer' }

const fieldCls = 'mt-1 input'
const uid = useId()
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

async function signOut(u: UserMeta) {
  try {
    await $fetch('/api/users/signout', { method: 'POST', body: { id: u.id } })
    toast.success(`${u.username} is signed out on every device`)
  } catch (e: any) {
    toast.error(errMsg(e, 'Sign-out failed'))
  }
}

async function remove(u: UserMeta) {
  const again = u.sso ? ' Through single sign-on it comes back on its next sign-in, as long as its groups allow it.' : ''
  if (!(await confirmDialog({ message: `Delete the account "${u.username}"? It will be signed out immediately.${again}`, confirmLabel: 'Delete', danger: true }))) return
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
