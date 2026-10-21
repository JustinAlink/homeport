<template>
  <!-- login renders bare: no chrome before auth -->
  <slot v-if="bare" />

  <div v-else class="flex min-h-screen">
    <!-- mobile top bar -->
    <div class="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-white/[0.08] bg-ink-950/85 px-3 backdrop-blur-md md:hidden">
      <button class="btn btn-ghost btn-icon" aria-label="Open menu" @click="drawer = true">
        <Icon name="menu" class="h-5 w-5" />
      </button>
      <NuxtLink to="/" class="flex items-center gap-2">
        <div class="grid h-7 w-7 place-items-center rounded-lg bg-accent/15 text-accent"><Logo class="h-4 w-4" /></div>
        <span class="text-[15px] font-semibold tracking-tight text-slate-100">homeport</span>
      </NuxtLink>
      <button class="btn btn-ghost btn-icon ml-auto" aria-label="Search" @click="palette.open()">
        <Icon name="search" class="h-[18px] w-[18px]" />
      </button>
    </div>
    <Transition name="fade">
      <div v-if="drawer" class="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] md:hidden" @click="drawer = false" />
    </Transition>

    <!-- sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-white/[0.08] bg-ink-900 transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 md:bg-ink-900/40"
      :class="drawer ? 'translate-x-0 shadow-2xl' : '-translate-x-full'"
    >
      <div class="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <NuxtLink to="/" class="flex min-w-0 items-center gap-2.5" @click="drawer = false">
          <div class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent ring-1 ring-inset ring-accent/20">
            <Logo class="h-[18px] w-[18px]" />
          </div>
          <div class="min-w-0 leading-tight">
            <div class="text-[15px] font-semibold tracking-tight text-slate-100">homeport</div>
            <div class="truncate text-[11px] text-slate-500">
              <template v-if="caps.demo">demo mode</template>
              <template v-else-if="selfUpdate.state.value.version">v{{ selfUpdate.state.value.version }}</template>
            </div>
          </div>
        </NuxtLink>
        <button class="btn btn-ghost btn-icon btn-sm ml-auto md:hidden" aria-label="Close menu" @click="drawer = false">
          <Icon name="x" class="h-4 w-4" />
        </button>
      </div>

      <!-- quick search: opens the command palette -->
      <div class="px-3 pb-2">
        <button
          class="flex h-9 w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-ink-950/50 px-2.5 text-[13px] text-slate-500 transition-colors hover:border-white/15 hover:text-slate-300"
          @click="openPalette"
        >
          <Icon name="search" class="h-4 w-4" />
          <span>Jump to…</span>
          <span class="ml-auto flex gap-0.5"><span class="kbd">{{ modKey }}</span><span class="kbd">K</span></span>
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 pb-3" aria-label="Main">
        <div v-for="section in sections" :key="section.label" class="mt-3 first:mt-1">
          <p v-if="section.label" class="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-600">{{ section.label }}</p>
          <NuxtLink
            v-for="item in section.items"
            :key="item.to"
            :to="item.to"
            class="group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] transition-colors"
            :class="isActive(item.to)
              ? 'bg-white/[0.07] font-medium text-slate-100'
              : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'"
            @click="drawer = false"
          >
            <span v-if="isActive(item.to)" class="absolute -left-3 top-2 h-5 w-[3px] rounded-r-full bg-accent" />
            <Icon :name="item.icon" class="h-[18px] w-[18px] shrink-0" :class="isActive(item.to) ? 'text-accent-light' : 'text-slate-500 group-hover:text-slate-300'" />
            {{ item.label }}
            <span v-if="item.badge" class="ml-auto rounded-full bg-sky-400/15 px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-sky-300">{{ item.badge }}</span>
          </NuxtLink>
        </div>
      </nav>

      <div class="space-y-2 border-t border-white/[0.06] p-3">
        <!-- homeport's own update: the one thing that isn't a normal container recreate -->
        <button
          v-if="caps.updates && selfUpdate.state.value.updateAvailable && !selfUpdate.busy.value"
          class="flex w-full items-center gap-2.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-2 text-left text-[13px] font-medium text-accent-light transition-colors hover:bg-accent/15"
          title="A newer homeport image is available"
          @click="selfUpdate.run()"
        >
          <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent/20"><Icon name="arrow-up" class="h-3.5 w-3.5" /></span>
          <span class="min-w-0 flex-1 leading-tight">Update homeport<span class="block text-[11px] font-normal text-accent-light/70">new version ready</span></span>
          <span class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent-light" />
        </button>
        <div
          v-else-if="selfUpdate.busy.value"
          class="flex items-center gap-2.5 rounded-lg border border-accent/25 bg-accent/5 px-2.5 py-2 text-[12px] text-accent-light/90"
        >
          <Icon name="refresh" class="h-4 w-4 shrink-0 animate-spin" />
          <span class="min-w-0 truncate" :title="selfUpdate.msg.value">{{ selfUpdate.msg.value || 'updating…' }}</span>
        </div>

        <div class="flex items-center gap-2">
          <div class="segmented segmented-sm" role="group" aria-label="Theme">
            <button
              v-for="t in themes"
              :key="t.value"
              :aria-pressed="theme.choice.value === t.value"
              :title="`${t.label} theme`"
              :aria-label="`${t.label} theme`"
              @click="theme.set(t.value)"
            ><Icon :name="t.icon" class="h-3.5 w-3.5" /></button>
          </div>
          <button
            v-if="!caps.forwardAuth"
            class="btn btn-ghost btn-sm ml-auto"
            title="Log out"
            @click="logout"
          ><Icon name="logout" class="h-3.5 w-3.5" /> Log out</button>
          <span v-else class="ml-auto text-[11px] text-slate-500" title="Authenticated by your reverse proxy (forward-auth)">via proxy</span>
        </div>
      </div>
    </aside>

    <!-- content -->
    <main class="min-w-0 flex-1 pt-14 md:pt-0">
      <slot />
    </main>

    <CommandPalette />
  </div>
</template>

<script setup lang="ts">
import type { ThemeChoice } from '~/composables/useTheme'

const route = useRoute()
const drawer = ref(false)
const { caps } = useCapabilities()
const theme = useTheme()
const updates = useUpdates()
const selfUpdate = useSelfUpdate()
const palette = usePalette()

const bare = computed(() => route.path === '/login')
watch(() => route.fullPath, () => (drawer.value = false))

const updateCount = computed(
  () => Object.values(updates.entries.value).filter((e) => e.status === 'update').length,
)

const themes: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
]

const modKey = ref('Ctrl')
onMounted(() => {
  if (/Mac|iPhone|iPad/.test(navigator.platform)) modKey.value = '⌘'
})

const sections = computed(() => {
  const c = caps.value
  const manage = [
    ...(c.stacks ? [{ to: '/stacks', label: 'Stacks', icon: 'stacks' }] : []),
    ...(c.updateCheck || c.updates
      ? [{ to: '/updates', label: 'Updates', icon: 'arrow-up', badge: updateCount.value || undefined }]
      : []),
    { to: '/catalog', label: 'App catalog', icon: 'catalog' },
  ]
  const infra = [
    ...(c.proxyAdmin ? [{ to: '/domains', label: 'Domains', icon: 'globe' }] : []),
    ...(c.stacks ? [{ to: '/networks', label: 'Networks', icon: 'network' }] : []),
    ...(c.stacks ? [{ to: '/storage', label: 'Storage', icon: 'database' }] : []),
  ]
  return [
    {
      label: '',
      items: [
        { to: '/', label: 'Dashboard', icon: 'dashboard' },
        { to: '/activity', label: 'Activity', icon: 'pulse' },
      ],
    },
    { label: 'Manage', items: manage },
    ...(infra.length ? [{ label: 'Infrastructure', items: infra }] : []),
    ...(c.viewer ? [] : [{ label: 'System', items: [{ to: '/settings', label: 'Settings', icon: 'sliders' }] }]),
  ] as { label: string; items: { to: string; label: string; icon: string; badge?: number }[] }[]
})

onMounted(() => {
  if (!bare.value) {
    updates.refresh()
    selfUpdate.refresh()
  }
})

function isActive(to: string) {
  if (to === '/') return route.path === '/' || route.path.startsWith('/services')
  return route.path.startsWith(to)
}

function openPalette() {
  drawer.value = false
  palette.open()
}

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

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
