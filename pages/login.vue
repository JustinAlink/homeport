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
          {{ needsSetup ? 'Prove you run this server, then create the admin password.' : awaitingTotp ? (useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.') : 'Your self-hosted fleet, at a glance.' }}
        </p>
      </div>

      <div class="card p-6" style="box-shadow: var(--shadow-pop)">
        <!-- first-run setup: the code from the log keeps a fresh install from
             belonging to whoever reaches it first -->
        <form v-if="needsSetup" class="space-y-4" @submit.prevent="doSetup">
          <div v-if="!writable" class="callout callout-warn text-xs">
            <Icon name="alert" />
            <span>The data volume is read-only, so a password can't be saved here. Set <code>HOMEPORT_ADMIN_PASSWORD</code>
              (env) or fix the volume mount.</span>
          </div>
          <div>
            <label class="field-label" for="setup-code">Setup code</label>
            <input
              id="setup-code"
              ref="codeEl"
              v-model="setupCode"
              type="text"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              maxlength="24"
              placeholder="XXXX-XXXX-XXXX"
              aria-describedby="setup-code-hint"
              :aria-invalid="codeInvalid || undefined"
              class="input h-10 font-mono uppercase tracking-[0.12em]"
              @input="codeInvalid = false"
            />
            <p id="setup-code-hint" class="field-hint">homeport printed it to its log when it started. On the server, run:</p>
            <div class="mt-1.5 flex items-start gap-1 rounded-md border border-white/[0.08] bg-ink-950/70 py-1 pl-2.5 pr-1">
              <code class="min-w-0 flex-1 break-words bg-transparent p-0 py-0.5 text-[12px] leading-5">{{ logCommand }}</code>
              <CopyButton :text="logCommand" label="command" />
            </div>
            <details class="mt-2 text-xs">
              <summary class="cursor-pointer text-slate-500 hover:text-slate-300">Can't find it?</summary>
              <ul class="mt-2 list-disc space-y-1 pl-4 text-slate-400">
                <li>Installed with compose? Run <code>docker compose logs homeport</code> in the install folder.</li>
                <li>Using Portainer, Unraid or a NAS? Open the homeport container's log and look for "setup code".</li>
                <li>A restart makes a new code, so use the newest one.</li>
                <li>Only on a trusted private network: <code>HOMEPORT_ALLOW_OPEN=true</code> runs homeport with no login at all. Not recommended.</li>
              </ul>
            </details>
          </div>
          <div>
            <label class="field-label" for="new-pw">New password</label>
            <input id="new-pw" ref="pwEl" v-model="password" type="password" autocomplete="new-password" class="input h-10" />
          </div>
          <div>
            <label class="field-label" for="confirm-pw">Confirm password</label>
            <input id="confirm-pw" v-model="confirm" type="password" autocomplete="new-password" class="input h-10" />
            <p class="field-hint">At least {{ minLen }} characters. This login guards your whole fleet.</p>
          </div>
          <button type="submit" :disabled="busy" class="btn btn-primary btn-lg w-full">{{ busy ? 'Creating…' : 'Create password' }}</button>
        </form>

        <!-- single sign-on first when it is set up; the password form stays below
             unless the admin hid it (/login?local=1 always brings it back) -->
        <div v-if="sso && !needsSetup && !awaitingTotp" class="space-y-4" :class="showPassword ? 'mb-5' : ''">
          <a :href="ssoHref" class="btn btn-primary btn-lg w-full"><Icon name="shield" /> {{ sso.label }}</a>
          <div v-if="showPassword" class="flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-500" aria-hidden="true">
            <span class="h-px flex-1 bg-white/[0.08]" />or with a password<span class="h-px flex-1 bg-white/[0.08]" />
          </div>
          <p v-else class="text-center text-xs text-slate-500"><a href="/login?local=1" class="link">Use a password instead</a></p>
        </div>

        <!-- normal sign-in -->
        <form v-if="!needsSetup && !awaitingTotp && showPassword" class="space-y-4" @submit.prevent="submit">
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
        <form v-if="awaitingTotp" class="space-y-4" @submit.prevent="submitTotp">
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
const setupCode = ref('')
const codeInvalid = ref(false)
const codeEl = ref<HTMLInputElement | null>(null)
const pwEl = ref<HTMLInputElement | null>(null)
const logCommand = 'docker logs homeport 2>&1 | grep "setup code"'

const awaitingTotp = ref(false)

// single sign-on (only what the public setup status offers: whether, and how)
const route = useRoute()
const sso = ref<{ label: string; autoRedirect: boolean; hidePassword: boolean } | null>(null)
const forceLocal = computed(() => String(route.query.local || '') === '1')
const showPassword = computed(() => !sso.value || !sso.value.hidePassword || forceLocal.value)
const ssoHref = computed(() => `/api/auth/oidc/start${route.query.returnTo ? `?returnTo=${encodeURIComponent(String(route.query.returnTo))}` : ''}`)
const SSO_ERRORS: Record<string, string> = {
  state: 'The sign-in took too long or was started in another browser. Please try again.',
  denied: 'Your account signed in, but it is not in a group allowed into homeport. Ask the admin to add you to one.',
  provider: 'The identity provider refused or cancelled the sign-in.',
  exchange: 'homeport could not complete the sign-in with the identity provider. The admin can check the client secret and redirect URI.',
  config: 'Single sign-on is not set up completely. Use a password, or ask the admin.',
}
const pendingToken = ref('')
const totpCode = ref('')
const recoveryCode = ref('')
const useRecovery = ref(false)

onMounted(async () => {
  try {
    const s = await $fetch<{ needsSetup: boolean; open: boolean; writable?: boolean; minPasswordLength?: number; sso?: { label: string; autoRedirect: boolean; hidePassword: boolean } | null }>('/api/setup')
    if (s.open) return navigateTo('/') // no auth → straight in
    sso.value = s.sso ?? null
    const ssoErr = String(route.query.sso_error || '')
    if (ssoErr) err.value = SSO_ERRORS[ssoErr] ?? 'Single sign-on failed.'
    // Auto-redirect only on a plain visit: never after a failed attempt, a logout or
    // an explicit ?local=1, or a broken provider would loop the browser forever.
    if (sso.value?.autoRedirect && !ssoErr && !forceLocal.value && !route.query.loggedout) {
      window.location.href = ssoHref.value
      return
    }
    needsSetup.value = s.needsSetup
    if (typeof s.writable === 'boolean') writable.value = s.writable
    if (typeof s.minPasswordLength === 'number') minLen.value = s.minPasswordLength
    if (s.needsSetup) {
      // install.sh links to /login#code=…: a fragment never reaches the server
      // or a proxy's access log. Take it, then drop it from the address bar.
      const fromLink = new URLSearchParams(location.hash.slice(1)).get('code')
      if (fromLink) {
        setupCode.value = fromLink
        history.replaceState(history.state, '', location.pathname + location.search)
      }
      await nextTick()
      const first = fromLink ? pwEl.value : codeEl.value
      first?.focus()
    }
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
    await navigateTo(safeReturnTo(route.query.returnTo))
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
    await navigateTo(safeReturnTo(route.query.returnTo))
  } catch (e: any) {
    err.value = errMsg(e, useRecovery.value ? 'Incorrect recovery code' : 'Incorrect code')
  } finally {
    busy.value = false
  }
}

async function doSetup() {
  codeInvalid.value = false
  if (!setupCode.value.trim()) {
    codeInvalid.value = true
    err.value = "Enter the setup code from homeport's log."
    codeEl.value?.focus()
    return
  }
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
    await $fetch('/api/setup', { method: 'POST', body: { code: setupCode.value, password: password.value } })
    await navigateTo('/welcome') // first-run wizard
  } catch (e: any) {
    err.value = errMsg(e, 'Setup failed')
    if (e?.data?.data?.field === 'code') {
      codeInvalid.value = true
      codeEl.value?.select()
    }
  } finally {
    busy.value = false
  }
}

useHead({ title: 'homeport' })
</script>
