<template>
  <div v-if="show" class="callout callout-info mb-6">
    <Icon name="shield" />
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
      <p class="min-w-0 flex-1">
        <span class="font-medium text-slate-100">Two-factor sign-in is off.</span>
        Anyone who learns your password can manage your containers. A code from an authenticator app closes that.
      </p>
      <div class="flex items-center gap-2">
        <NuxtLink to="/settings?tab=security" class="btn btn-sm btn-accent">Turn it on</NuxtLink>
        <button type="button" class="btn btn-sm btn-ghost" @click="later">Not now</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// A nudge for the one account that can change everything: shown to the admin who
// signs in with a password (not open mode, not a proxy's forward auth, not the
// demo) while two-factor is off. "Not now" hides it on this browser for 30 days;
// it's a reminder, so browser storage is enough (and it fails open: shown again).
const KEY = 'hp:2fa-nudge-later'
const LATER_MS = 30 * 24 * 3600_000

const { caps, loaded, load } = useCapabilities()
const off = ref(false)
const snoozed = ref(true)

const show = computed(
  () => loaded.value && off.value && !snoozed.value && !caps.value.viewer && !caps.value.loginDisabled && !caps.value.forwardAuth && !caps.value.demo,
)

function later() {
  snoozed.value = true
  try {
    localStorage.setItem(KEY, String(Date.now() + LATER_MS))
  } catch {}
}

onMounted(async () => {
  try {
    snoozed.value = Number(localStorage.getItem(KEY) || 0) > Date.now()
  } catch {
    snoozed.value = false
  }
  await load()
  if (caps.value.viewer || caps.value.loginDisabled || caps.value.forwardAuth || caps.value.demo) return
  try {
    off.value = !(await $fetch<{ enabled: boolean }>('/api/totp')).enabled
  } catch {
    off.value = false // can't tell: stay quiet
  }
})
</script>
