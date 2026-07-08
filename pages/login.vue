<template>
  <div class="grid min-h-screen place-items-center px-4">
    <div class="w-full max-w-xs space-y-4 rounded-xl border border-white/5 bg-ink-900 p-6">
      <div class="text-center">
        <div class="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-accent/15 text-accent"><Icon name="anchor" class="h-5 w-5" /></div>
        <h1 class="text-lg font-semibold text-slate-100">homeport</h1>
        <p class="text-xs text-slate-500">{{ needsSetup ? 'Welcome — create an admin password' : 'Sign in to view your fleet' }}</p>
      </div>

      <!-- first-run setup -->
      <form v-if="needsSetup" class="space-y-3" @submit.prevent="doSetup">
        <div v-if="!writable" class="rounded-md border border-amber-500/25 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-300">
          The data volume is read-only, so a password can't be saved here. Set
          <code>HOMEPORT_ADMIN_PASSWORD</code> (env) or fix the volume mount — or set
          <code>HOMEPORT_ALLOW_OPEN=true</code> to run without a login.
        </div>
        <input
          v-model="password"
          type="password"
          placeholder="New password"
          autofocus
          class="w-full rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
        />
        <input
          v-model="confirm"
          type="password"
          placeholder="Confirm password"
          class="w-full rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
        />
        <p class="text-[11px] text-slate-500">Use at least {{ minLen }} characters — this login guards your whole fleet.</p>
        <button
          type="submit"
          :disabled="busy"
          class="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-60"
        >{{ busy ? '…' : 'Create password' }}</button>
        <button
          type="button"
          class="w-full text-center text-[11px] text-slate-500 hover:text-slate-300"
          @click="doSkip"
        >Skip — run without a login (not recommended)</button>
      </form>

      <!-- normal sign-in -->
      <form v-else class="space-y-4" @submit.prevent="submit">
        <input
          v-model="password"
          type="password"
          placeholder="Password"
          autofocus
          class="w-full rounded-md border border-white/10 bg-ink-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50"
        />
        <button
          type="submit"
          :disabled="busy"
          class="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-60"
        >{{ busy ? '…' : 'Sign in' }}</button>
      </form>

      <p v-if="err" class="text-center text-xs text-red-400">{{ err }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const password = ref('')
const confirm = ref('')
const err = ref('')
const busy = ref(false)
const needsSetup = ref(false)
const writable = ref(true)
const minLen = ref(10)

onMounted(async () => {
  try {
    const s = await $fetch<{ needsSetup: boolean; open: boolean; writable?: boolean; minPasswordLength?: number }>('/api/setup')
    if (s.open) return navigateTo('/') // no auth → straight in
    needsSetup.value = s.needsSetup
    if (typeof s.writable === 'boolean') writable.value = s.writable
    if (typeof s.minPasswordLength === 'number') minLen.value = s.minPasswordLength
  } catch {
    // fall back to the sign-in form
  }
})

async function submit() {
  busy.value = true
  err.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { password: password.value } })
    await navigateTo('/')
  } catch (e: any) {
    err.value = errMsg(e, 'Login failed')
  } finally {
    busy.value = false
  }
}

async function doSetup() {
  if (password.value.length < minLen.value) {
    err.value = `Password must be at least ${minLen.value} characters`
    return
  }
  if (password.value !== confirm.value) {
    err.value = 'Passwords do not match'
    return
  }
  busy.value = true
  err.value = ''
  try {
    await $fetch('/api/setup', { method: 'POST', body: { password: password.value } })
    await navigateTo('/welcome') // first-run wizard
  } catch (e: any) {
    err.value = errMsg(e, 'Setup failed')
  } finally {
    busy.value = false
  }
}

async function doSkip() {
  busy.value = true
  err.value = ''
  try {
    await $fetch('/api/setup', { method: 'POST', body: { skip: true } })
    await navigateTo('/')
  } catch (e: any) {
    err.value = errMsg(e, 'Failed')
  } finally {
    busy.value = false
  }
}

useHead({ title: 'homeport' })
</script>
