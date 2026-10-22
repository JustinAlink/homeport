<template>
  <div class="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
    <div class="pointer-events-none absolute inset-0" style="background: radial-gradient(60% 45% at 50% 0%, rgb(var(--accent) / 0.13), transparent 70%)" />
    <div class="relative w-full max-w-[360px]">
      <div class="mb-6 text-center">
        <div class="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent ring-1 ring-inset ring-accent/25">
          <Logo class="h-6 w-6" />
        </div>
        <h1 class="text-xl font-semibold tracking-tight text-slate-100">
          {{ needsSetup ? 'Welcome to homeport' : awaitingTotp ? 'Two-factor check' : 'Sign in to homeport' }}
        </h1>
        <p class="mt-1 text-[13px] text-slate-500">
          {{ needsSetup ? 'Create the admin password to get started.' : awaitingTotp ? (useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.') : 'Your self-hosted fleet, at a glance.' }}
        </p>
      </div>

      <div class="card p-6" style="box-shadow: var(--shadow-pop)">
        <!-- first-run setup -->
        <form v-if="needsSetup" class="space-y-4" @submit.prevent="doSetup">
          <div v-if="!writable" class="callout callout-warn text-xs">
            <Icon name="alert" />
            <span>The data volume is read-only, so a password can't be saved here. Set <code>HOMEPORT_ADMIN_PASSWORD</code>
              (env) or fix the volume mount, or set <code>HOMEPORT_ALLOW_OPEN=true</code> to run without a login.</span>
          </div>
          <div>
            <label class="field-label" for="new-pw">New password</label>
            <input id="new-pw" v-model="password" type="password" autocomplete="new-password" autofocus class="input h-10" />
          </div>
          <div>
            <label class="field-label" for="confirm-pw">Confirm password</label>
            <input id="confirm-pw" v-model="confirm" type="password" autocomplete="new-password" class="input h-10" />
            <p class="field-hint">At least {{ minLen }} characters. This login guards your whole fleet.</p>
          </div>
          <button type="submit" :disabled="busy" class="btn btn-primary btn-lg w-full">{{ busy ? 'Creating…' : 'Create password' }}</button>
          <button type="button" class="block w-full text-center text-xs text-slate-500 hover:text-slate-300" @click="doSkip">
            Skip and run without a login (not recommended)
          </button>
        </form>

        <!-- normal sign-in -->
        <form v-else-if="!awaitingTotp" class="space-y-4" @submit.prevent="submit">
          <div>
            <label class="field-label flex items-baseline justify-between" for="username">
              Username
            </label>
            <input id="username" v-model="username" type="text" autocomplete="username" spellcheck="false" class="input h-10" />
            <p class="field-hint">“admin” for the main account; viewer accounts use their own name.</p>
          </div>
          <div>
            <label class="field-label" for="password">Password</label>
            <input id="password" v-model="password" type="password" autocomplete="current-password" autofocus class="input h-10" />
          </div>
          <button type="submit" :disabled="busy || !password" class="btn btn-primary btn-lg w-full">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
        </form>

        <!-- 2FA step -->
        <form v-else class="space-y-4" @submit.prevent="submitTotp">
          <input
            v-if="!useRecovery"
            v-model="totpCode"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="000000"
            aria-label="6-digit code"
            autofocus
            class="input h-12 text-center font-mono text-lg tracking-[0.4em]"
          />
          <input
            v-else
            v-model="recoveryCode"
            placeholder="Recovery code"
            aria-label="Recovery code"
            autofocus
            class="input h-10 text-center font-mono"
          />
          <button type="submit" :disabled="busy" class="btn btn-primary btn-lg w-full">{{ busy ? 'Verifying…' : 'Verify' }}</button>
          <button type="button" class="block w-full text-center text-xs text-slate-500 hover:text-slate-300" @click="useRecovery = !useRecovery">
            {{ useRecovery ? 'Use my authenticator app instead' : 'Use a recovery code instead' }}
          </button>
        </form>

        <p v-if="err" class="callout callout-danger mt-4 py-2 text-xs" role="alert"><Icon name="alert" />{{ err }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const username = ref('admin')
const password = ref('')
const confirm = ref('')
const err = ref('')
const busy = ref(false)
const needsSetup = ref(false)
const writable = ref(true)
const minLen = ref(10)

const awaitingTotp = ref(false)
const pendingToken = ref('')
const totpCode = ref('')
const recoveryCode = ref('')
const useRecovery = ref(false)

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
    const r = await $fetch<{ ok: true; needsTotp?: boolean; pending?: string }>('/api/auth/login', {
      method: 'POST',
      body: { username: username.value.trim() || undefined, password: password.value },
    })
    if (r.needsTotp && r.pending) {
      pendingToken.value = r.pending
      awaitingTotp.value = true
      return
    }
    await navigateTo('/')
  } catch (e: any) {
    err.value = errMsg(e, 'Login failed')
  } finally {
    busy.value = false
  }
}

async function submitTotp() {
  busy.value = true
  err.value = ''
  try {
    await $fetch('/api/auth/totp', {
      method: 'POST',
      body: useRecovery.value
        ? { pending: pendingToken.value, recovery: recoveryCode.value }
        : { pending: pendingToken.value, code: totpCode.value },
    })
    await navigateTo('/')
  } catch (e: any) {
    err.value = errMsg(e, useRecovery.value ? 'Incorrect recovery code' : 'Incorrect code')
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
