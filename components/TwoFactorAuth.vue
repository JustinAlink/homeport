<template>
  <div class="space-y-4">
    <p class="text-xs text-slate-500">
      Require a 6-digit code from an authenticator app (Google Authenticator, Aegis, 1Password, …)
      in addition to your password when signing in.
    </p>

    <!-- enabled state -->
    <div v-if="enabled && !showDisable" class="space-y-3">
      <div class="flex flex-wrap items-center gap-2 rounded-md border border-white/5 bg-ink-900/60 px-3 py-2">
        <span class="rounded-full border border-accent/30 px-1.5 py-0.5 text-[10px] uppercase text-accent-light">enabled</span>
        <span class="text-xs text-slate-400">{{ recoveryRemaining }} recovery code{{ recoveryRemaining === 1 ? '' : 's' }} left</span>
        <div class="ml-auto flex gap-2">
          <button type="button" class="btn btn-sm" @click="showRegenerate = !showRegenerate">Regenerate codes</button>
          <button type="button" class="rounded border border-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10" @click="showDisable = true">Disable</button>
        </div>
      </div>

      <div v-if="showRegenerate" class="max-w-sm space-y-2 rounded-md border border-white/5 bg-ink-900/60 p-3">
        <p class="text-[11px] text-slate-500">Enter your password to invalidate the old codes and generate a fresh set.</p>
        <input v-model="regenPassword" type="password" :class="fieldCls" placeholder="Current password" autocomplete="current-password" @keyup.enter="regenerate" />
        <div class="flex items-center gap-3">
          <button type="button" :disabled="busy" class="btn btn-sm" @click="regenerate">{{ busy ? 'Working…' : 'Regenerate' }}</button>
          <button type="button" class="text-xs text-slate-500 hover:text-slate-300" @click="showRegenerate = false; regenPassword = ''">Cancel</button>
        </div>
      </div>
    </div>

    <!-- disable confirm -->
    <div v-if="showDisable" class="max-w-sm space-y-2 rounded-md border border-red-500/20 bg-red-500/5 p-3">
      <p class="text-[11px] text-red-300">Disabling 2FA removes the second step from login. Enter your password to confirm.</p>
      <input v-model="disablePassword" type="password" :class="fieldCls" placeholder="Current password" autocomplete="current-password" @keyup.enter="disable" />
      <div class="flex items-center gap-3">
        <button type="button" :disabled="busy" class="rounded-md border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40" @click="disable">{{ busy ? 'Working…' : 'Disable 2FA' }}</button>
        <button type="button" class="text-xs text-slate-500 hover:text-slate-300" @click="showDisable = false; disablePassword = ''">Cancel</button>
      </div>
    </div>

    <!-- recovery codes, one-time reveal (after enroll or regenerate) -->
    <div v-if="freshCodes.length" class="space-y-2 rounded-md border border-accent/30 bg-accent/5 p-3">
      <p class="text-[11px] text-accent-light">Save these recovery codes somewhere safe — each works once, and they won't be shown again.</p>
      <div class="grid grid-cols-2 gap-1 font-mono text-xs text-slate-100 sm:grid-cols-3">
        <code v-for="c in freshCodes" :key="c" class="rounded bg-ink-950 px-2 py-1">{{ c }}</code>
      </div>
      <button type="button" class="btn btn-sm" @click="copyRecovery">{{ copied ? 'Copied' : 'Copy all' }}</button>
    </div>

    <!-- not enabled: start enrollment -->
    <div v-if="!enabled && !enrolling">
      <button type="button" :disabled="busy" class="rounded-md border border-accent/30 px-3 py-2 text-xs text-accent-light hover:bg-accent/10 disabled:opacity-40" @click="startEnroll">{{ busy ? 'Working…' : 'Enable 2FA' }}</button>
    </div>

    <!-- enrollment: QR + manual key + confirm code -->
    <div v-if="enrolling" class="max-w-sm space-y-3 rounded-md border border-white/5 bg-ink-900/60 p-3">
      <p class="text-[11px] text-slate-500">Scan this with your authenticator app, or enter the key manually.</p>
      <div class="w-40 rounded bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" v-html="qrSvg" />
      <div class="flex items-center gap-2">
        <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-ink-950 px-2 py-1.5 font-mono text-xs text-slate-100">{{ secret }}</code>
        <button type="button" class="btn btn-sm shrink-0" @click="copySecret">{{ secretCopied ? 'Copied' : 'Copy' }}</button>
      </div>
      <input v-model="code" inputmode="numeric" maxlength="6" :class="fieldCls" placeholder="6-digit code" @keyup.enter="confirmEnroll" />
      <div class="flex items-center gap-3">
        <button type="button" :disabled="busy" class="btn btn-primary disabled:opacity-60" @click="confirmEnroll">{{ busy ? 'Verifying…' : 'Confirm' }}</button>
        <button type="button" class="text-xs text-slate-500 hover:text-slate-300" @click="cancelEnroll">Cancel</button>
        <span v-if="err" class="text-[11px] text-red-400">{{ err }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const fieldCls = 'mt-1 input'
const toast = useToast()

const enabled = ref(false)
const recoveryRemaining = ref(0)
const busy = ref(false)
const err = ref('')

const enrolling = ref(false)
const secret = ref('')
const qrSvg = ref('')
const code = ref('')
const secretCopied = ref(false)

const freshCodes = ref<string[]>([])
const copied = ref(false)

const showDisable = ref(false)
const disablePassword = ref('')
const showRegenerate = ref(false)
const regenPassword = ref('')

async function load() {
  try {
    const r = await $fetch<{ enabled: boolean; recoveryRemaining?: number }>('/api/totp')
    enabled.value = r.enabled
    recoveryRemaining.value = r.recoveryRemaining || 0
  } catch {
    // unreachable / not admin — leave defaults
  }
}

async function startEnroll() {
  busy.value = true
  err.value = ''
  try {
    const r = await $fetch<{ secret: string; otpauthUri: string; qrSvg: string }>('/api/totp/enroll', { method: 'POST' })
    secret.value = r.secret
    qrSvg.value = r.qrSvg
    code.value = ''
    enrolling.value = true
  } catch (e: any) {
    toast.error(errMsg(e, 'Could not start enrollment'))
  } finally {
    busy.value = false
  }
}

function cancelEnroll() {
  enrolling.value = false
  secret.value = ''
  qrSvg.value = ''
  code.value = ''
  err.value = ''
}

async function confirmEnroll() {
  busy.value = true
  err.value = ''
  try {
    const r = await $fetch<{ ok: true; recoveryCodes: string[] }>('/api/totp/confirm', {
      method: 'POST',
      body: { secret: secret.value, code: code.value },
    })
    freshCodes.value = r.recoveryCodes
    copied.value = false
    cancelEnroll()
    await load()
  } catch (e: any) {
    err.value = errMsg(e, 'Incorrect code')
  } finally {
    busy.value = false
  }
}

async function disable() {
  busy.value = true
  try {
    await $fetch('/api/totp/disable', { method: 'POST', body: { password: disablePassword.value } })
    showDisable.value = false
    disablePassword.value = ''
    freshCodes.value = []
    await load()
  } catch (e: any) {
    toast.error(errMsg(e, 'Could not disable 2FA'))
  } finally {
    busy.value = false
  }
}

async function regenerate() {
  busy.value = true
  try {
    const r = await $fetch<{ recoveryCodes: string[] }>('/api/totp/regenerate', { method: 'POST', body: { password: regenPassword.value } })
    freshCodes.value = r.recoveryCodes
    copied.value = false
    showRegenerate.value = false
    regenPassword.value = ''
    await load()
  } catch (e: any) {
    toast.error(errMsg(e, 'Could not regenerate codes'))
  } finally {
    busy.value = false
  }
}

async function copySecret() {
  try {
    await navigator.clipboard.writeText(secret.value)
    secretCopied.value = true
    setTimeout(() => (secretCopied.value = false), 1500)
  } catch {
    toast.error('Copy failed — select the key and copy it manually')
  }
}

async function copyRecovery() {
  try {
    await navigator.clipboard.writeText(freshCodes.value.join('\n'))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    toast.error('Copy failed — select the codes and copy them manually')
  }
}

onMounted(load)
</script>
