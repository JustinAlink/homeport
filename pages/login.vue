<template>
  <div class="grid min-h-screen place-items-center px-4">
    <form
      class="w-full max-w-xs space-y-4 rounded-xl border border-white/5 bg-ink-900 p-6"
      @submit.prevent="submit"
    >
      <div class="text-center">
        <div class="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-md bg-accent/15 text-lg text-accent">⚓</div>
        <h1 class="text-lg font-semibold text-slate-100">homeport</h1>
        <p class="text-xs text-slate-500">Sign in to view your fleet</p>
      </div>
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
      >
        {{ busy ? '…' : 'Sign in' }}
      </button>
      <p v-if="err" class="text-center text-xs text-red-400">{{ err }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
const password = ref('')
const err = ref('')
const busy = ref(false)

async function submit() {
  busy.value = true
  err.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { password: password.value } })
    await navigateTo('/')
  } catch (e: any) {
    err.value = e?.statusMessage || 'Login failed'
  } finally {
    busy.value = false
  }
}

useHead({ title: 'Sign in — homeport' })
</script>
