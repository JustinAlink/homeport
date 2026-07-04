<template>
  <!-- login renders bare — no chrome before auth -->
  <slot v-if="bare" />

  <div v-else class="flex min-h-screen">
    <!-- mobile top bar -->
    <div class="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-white/10 bg-ink-950/90 px-4 backdrop-blur md:hidden">
      <button
        class="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/5"
        aria-label="Menu"
        @click="drawer = !drawer"
      >
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
      </button>
      <div class="grid h-7 w-7 place-items-center rounded-lg bg-accent/15 text-accent">⚓</div>
      <span class="text-[15px] font-semibold text-slate-100">homeport</span>
    </div>
    <div v-if="drawer" class="fixed inset-0 z-40 bg-black/60 md:hidden" @click="drawer = false" />

    <!-- sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-white/10 bg-ink-900 px-3 py-5 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 md:bg-transparent"
      :class="drawer ? 'translate-x-0' : '-translate-x-full'"
    >
      <NuxtLink to="/" class="mb-6 flex items-center gap-2.5 px-2.5" @click="drawer = false">
        <div class="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">⚓</div>
        <span class="text-[15px] font-semibold tracking-tight text-slate-100">homeport</span>
      </NuxtLink>

      <nav class="flex flex-col gap-1">
        <NuxtLink
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] transition-colors"
          :class="isActive(item.to)
            ? 'bg-accent/10 font-medium text-accent-light'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'"
          @click="drawer = false"
        >
          <svg viewBox="0 0 24 24" class="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" v-html="item.icon" />
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="mt-auto flex flex-col gap-1 border-t border-white/5 pt-3">
        <button
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-slate-400 hover:bg-white/5 hover:text-slate-200"
          :title="`Theme: ${theme.choice.value}`"
          @click="theme.cycle()"
        >
          <svg viewBox="0 0 24 24" class="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" v-html="themeIcon" />
          <span class="capitalize">{{ theme.choice.value }} theme</span>
        </button>
        <button
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-slate-400 hover:bg-white/5 hover:text-slate-200"
          @click="logout"
        >
          <svg viewBox="0 0 24 24" class="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Log out
        </button>
      </div>
    </aside>

    <!-- content -->
    <main class="min-w-0 flex-1 pt-14 md:pt-0">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const drawer = ref(false)
const { caps } = useCapabilities()
const theme = useTheme()

const bare = computed(() => route.path === '/login')

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  stacks: '<polygon points="12 2 22 8 12 14 2 8"/><polyline points="2 12.5 12 18.5 22 12.5"/><polyline points="2 17 12 23 22 17"/>',
  catalog: '<rect x="3" y="3" width="18" height="5" rx="1.5"/><rect x="3" y="11" width="8" height="10" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/>',
  domains: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c-3 3.6-3 14.4 0 18"/><path d="M12 3c3 3.6 3 14.4 0 18"/>',
  settings: '<line x1="6" y1="4" x2="6" y2="20"/><circle cx="6" cy="9" r="2"/><line x1="12" y1="4" x2="12" y2="20"/><circle cx="12" cy="15" r="2"/><line x1="18" y1="4" x2="18" y2="20"/><circle cx="18" cy="7" r="2"/>',
}

const items = computed(() => [
  { to: '/', label: 'Dashboard', icon: ICONS.dashboard },
  ...(caps.value.stacks ? [{ to: '/stacks', label: 'Stacks', icon: ICONS.stacks }] : []),
  { to: '/catalog', label: 'Catalog', icon: ICONS.catalog },
  ...(caps.value.proxyAdmin ? [{ to: '/domains', label: 'Domains', icon: ICONS.domains }] : []),
  { to: '/settings', label: 'Settings', icon: ICONS.settings },
])

function isActive(to: string) {
  if (to === '/') return route.path === '/' || route.path.startsWith('/services')
  return route.path.startsWith(to)
}

const themeIcon = computed(() => {
  if (theme.choice.value === 'dark')
    return '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>'
  if (theme.choice.value === 'light')
    return '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7" y2="7"/><line x1="17" y1="17" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7" y2="17"/><line x1="17" y1="7" x2="19.1" y2="4.9"/>'
  return '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'
})

async function logout() {
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } catch {}
  await navigateTo('/login')
}

onMounted(() => {
  theme.init()
  useCapabilities().load()
})
</script>
