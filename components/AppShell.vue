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
        <Icon name="menu" class="h-5 w-5" />
      </button>
      <div class="grid h-7 w-7 place-items-center rounded-lg bg-accent/15 text-accent"><Icon name="anchor" class="h-4 w-4" /></div>
      <span class="text-[15px] font-semibold text-slate-100">homeport</span>
    </div>
    <div v-if="drawer" class="fixed inset-0 z-40 bg-black/60 md:hidden" @click="drawer = false" />

    <!-- sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-white/10 bg-ink-900 px-3 py-5 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 md:bg-transparent"
      :class="drawer ? 'translate-x-0' : '-translate-x-full'"
    >
      <NuxtLink to="/" class="mb-6 flex items-center gap-2.5 px-2.5" @click="drawer = false">
        <div class="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent"><Icon name="anchor" class="h-[18px] w-[18px]" /></div>
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
          <Icon :name="item.icon" class="h-[18px] w-[18px] shrink-0" />
          {{ item.label }}
          <span
            v-if="item.badge"
            class="ml-auto rounded-full border border-sky-400/30 bg-sky-400/10 px-1.5 py-px text-[10px] text-sky-300"
          >{{ item.badge }}</span>
        </NuxtLink>
      </nav>

      <div class="mt-auto flex flex-col gap-1 border-t border-white/5 pt-3">
        <button
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-slate-400 hover:bg-white/5 hover:text-slate-200"
          :title="`Theme: ${theme.choice.value}`"
          @click="theme.cycle()"
        >
          <Icon :name="themeIcon" class="h-[18px] w-[18px] shrink-0" />
          <span class="capitalize">{{ theme.choice.value }} theme</span>
        </button>
        <button
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-slate-400 hover:bg-white/5 hover:text-slate-200"
          @click="logout"
        >
          <Icon name="logout" class="h-[18px] w-[18px] shrink-0" />
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
const updates = useUpdates()

const bare = computed(() => route.path === '/login')

const updateCount = computed(
  () => Object.values(updates.entries.value).filter((e) => e.status === 'update').length,
)

const items = computed(() => [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  ...(caps.value.stacks ? [{ to: '/stacks', label: 'Stacks', icon: 'stacks' }] : []),
  ...(caps.value.updateCheck || caps.value.updates
    ? [{ to: '/updates', label: 'Updates', icon: 'arrow-up', badge: updateCount.value || undefined }]
    : []),
  { to: '/catalog', label: 'Catalog', icon: 'catalog' },
  ...(caps.value.proxyAdmin ? [{ to: '/domains', label: 'Domains', icon: 'globe' }] : []),
  { to: '/settings', label: 'Settings', icon: 'sliders' },
])

onMounted(() => {
  if (!bare.value) updates.refresh()
})

function isActive(to: string) {
  if (to === '/') return route.path === '/' || route.path.startsWith('/services')
  return route.path.startsWith(to)
}

const themeIcon = computed(() =>
  theme.choice.value === 'dark' ? 'moon' : theme.choice.value === 'light' ? 'sun' : 'monitor',
)

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
