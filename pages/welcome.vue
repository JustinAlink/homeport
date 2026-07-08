<template>
  <div class="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
    <div class="rounded-2xl border border-white/5 bg-ink-900 p-6 sm:p-8">
      <div class="mb-6 flex items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent"><Logo class="h-5 w-5" /></div>
        <div>
          <h1 class="text-lg font-semibold text-slate-100">Welcome to homeport</h1>
          <p class="text-xs text-slate-500">Step {{ step }} of 3</p>
        </div>
        <div class="ml-auto flex gap-1.5">
          <span v-for="n in 3" :key="n" class="h-1.5 w-6 rounded-full transition-colors" :class="n <= step ? 'bg-accent' : 'bg-white/10'" />
        </div>
      </div>

      <!-- 1 · orientation -->
      <div v-if="step === 1" class="space-y-4">
        <p class="text-sm leading-relaxed text-slate-300">
          homeport reads your Docker fleet live and builds the dashboard for you — every container, its
          status, and the domain that points to it. <strong class="text-slate-100">It's read-only by
          default</strong>: nothing changes until you turn a capability on.
        </p>
        <p class="text-sm leading-relaxed text-slate-400">Two quick steps and you're set.</p>
        <div class="flex gap-2 pt-2">
          <button :class="btnPrimary" @click="step = 2">Get started</button>
          <NuxtLink to="/" :class="btnGhost">Skip</NuxtLink>
        </div>
      </div>

      <!-- 2 · reverse proxy -->
      <div v-else-if="step === 2" class="space-y-4">
        <div>
          <h2 class="text-sm font-semibold text-slate-100">Put your services on real domains</h2>
          <p class="mt-1 text-[13px] leading-relaxed text-slate-400">
            A reverse proxy gives each service a domain with HTTPS. homeport can install
            <strong class="text-slate-300">Nginx Proxy Manager</strong> and wire it up for you.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <NuxtLink to="/catalog/nginx-proxy-manager" :class="btnPrimary">Install Nginx Proxy Manager</NuxtLink>
          <button :disabled="connecting" :class="btnGhost" @click="connectProxy">{{ connecting ? 'Connecting…' : 'Connect it' }}</button>
        </div>
        <div v-if="connectMsg" class="rounded-md border p-2.5 text-[12px] leading-relaxed" :class="connectOk ? okCls : warnCls">
          {{ connectMsg }}
          <div v-if="connectSecret" class="mt-1.5 select-all rounded bg-black/30 px-2 py-1 font-mono text-slate-100">admin@example.com&nbsp;·&nbsp;{{ connectSecret }}</div>
        </div>
        <p class="text-[11px] text-slate-500">Already using Caddy, Traefik or your own proxy? homeport auto-detects it — just skip ahead.</p>
        <div class="flex gap-2 pt-1">
          <button :class="btnPrimary" @click="step = 3">Next</button>
          <button :class="btnGhost" @click="step = 3">Skip</button>
        </div>
      </div>

      <!-- 3 · capabilities -->
      <div v-else class="space-y-4">
        <div>
          <h2 class="text-sm font-semibold text-slate-100">Turn on management — only what you want</h2>
          <p class="mt-1 text-[13px] leading-relaxed text-slate-400">Each is off by default and independent. Change these anytime in Settings.</p>
        </div>
        <label v-for="c in capChoices" :key="c.key" class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/5 p-2.5 transition-colors hover:bg-white/[0.03]">
          <input v-model="caps[c.key]" type="checkbox" class="mt-0.5 accent-accent" />
          <span>
            <span class="text-[13px] text-slate-200">{{ c.label }}</span>
            <span class="block text-[11px] text-slate-500">{{ c.hint }}</span>
          </span>
        </label>
        <p class="text-[11px] leading-relaxed text-amber-300/80">
          Some capabilities also need matching permissions on the docker-socket-proxy (listed in Settings →
          Capabilities). If a button is refused later, that's why.
        </p>
        <p v-if="saveErr" class="text-[11px] text-red-400">{{ saveErr }}</p>
        <div class="flex gap-2 pt-1">
          <button :disabled="saving" :class="btnPrimary" @click="finish">{{ saving ? 'Saving…' : 'Finish' }}</button>
          <NuxtLink to="/" :class="btnGhost">Skip to dashboard</NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const btnPrimary = 'rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-ink-950 transition-colors hover:bg-accent-light disabled:opacity-60'
const btnGhost = 'rounded-lg border border-white/10 px-3.5 py-2 text-[13px] text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-60'
const okCls = 'border-ok/25 bg-ok/5 text-emerald-300'
const warnCls = 'border-amber-500/25 bg-amber-500/5 text-amber-300'

const step = ref(1)

// Step 2 — reuse the one-click NPM connect (same endpoint as the dashboard card).
const connecting = ref(false)
const connectMsg = ref('')
const connectSecret = ref('')
const connectOk = ref(false)
async function connectProxy() {
  connecting.value = true
  connectMsg.value = ''
  connectSecret.value = ''
  try {
    const r = await $fetch<{ ok: boolean; secret?: string; notReady?: boolean; alreadyConfigured?: boolean; error?: string }>(
      '/api/proxy/bootstrap',
      { method: 'POST', body: {} },
    )
    if (r.ok) {
      connectOk.value = true
      connectSecret.value = r.secret || ''
      connectMsg.value = r.secret
        ? 'Connected — proxy management is on. Save this NPM login (you can sign into NPM directly with it):'
        : 'Connected — proxy management is on.'
    } else if (r.notReady) {
      connectMsg.value = "Nginx Proxy Manager isn't reachable yet — give it a few seconds after installing, then try again."
    } else if (r.alreadyConfigured) {
      connectMsg.value = 'NPM is already set up. Add its email + password in Settings → Proxy management to connect.'
    } else {
      connectMsg.value = r.error || 'Could not connect to Nginx Proxy Manager.'
    }
  } catch (e: any) {
    connectMsg.value = errMsg(e, 'Could not connect to Nginx Proxy Manager')
  } finally {
    connecting.value = false
  }
}

// Step 3 — opt into capabilities.
const caps = reactive({ allowControl: false, allowUpdates: false, allowStacks: false })
const capChoices: { key: keyof typeof caps; label: string; hint: string }[] = [
  { key: 'allowControl', label: 'Start / stop / restart containers', hint: 'lifecycle controls — needs POST on the socket proxy' },
  { key: 'allowUpdates', label: 'Check for and apply image updates', hint: 'registry digest checks + pull/recreate — needs DISTRIBUTION, IMAGES, POST' },
  { key: 'allowStacks', label: 'Manage compose stacks + the app catalog', hint: 'edit/deploy stacks and install apps — needs a stacks dir + broader proxy perms' },
]
const saving = ref(false)
const saveErr = ref('')
async function finish() {
  saving.value = true
  saveErr.value = ''
  try {
    await $fetch('/api/settings', { method: 'POST', body: { ...caps } })
    await navigateTo('/')
  } catch (e: any) {
    saveErr.value = errMsg(e, 'Could not save — you can still enable these in Settings.')
  } finally {
    saving.value = false
  }
}

useHead({ title: 'Welcome — homeport' })
</script>
