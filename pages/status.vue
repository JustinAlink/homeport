<template>
  <div class="min-h-screen bg-ink-950 text-slate-200">
    <!-- only an admin's preview gets this bar: the public answer never carries `preview` -->
    <div v-if="previewInfo" class="border-b border-accent/25 bg-accent/[0.08]">
      <div class="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] text-slate-300 sm:px-6">
        <Icon name="eye" class="h-4 w-4 shrink-0 text-accent-light" />
        <span class="min-w-0 flex-1">
          <strong class="font-semibold text-slate-100">Preview.</strong>
          {{ previewInfo.enabled ? 'This page is public: anyone with the link sees what is below.' : 'The public page is off, so only you can see this.' }}
        </span>
        <a href="/settings?tab=monitoring#status-page" class="link">Status page settings</a>
      </div>
    </div>

    <main v-if="data" class="mx-auto w-full max-w-3xl px-4 pb-14 pt-8 sm:px-6 sm:pt-12">
      <h1 class="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-slate-100 sm:text-[28px]">{{ data.title }}</h1>

      <!-- plain text from the admin: interpolated, never v-html; line breaks kept -->
      <div v-if="data.notice" class="callout mt-5" :class="NOTICE[data.noticeKind].cls">
        <Icon :name="NOTICE[data.noticeKind].icon" />
        <p class="min-w-0 whitespace-pre-line break-words"><span class="sr-only">{{ NOTICE[data.noticeKind].label }}: </span>{{ data.notice }}</p>
      </div>

      <section class="card mt-5 flex items-center gap-4 px-4 py-4 sm:px-5" :class="OVERALL[data.overall].card" aria-label="Overall status">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full" :class="OVERALL[data.overall].badge">
          <Icon :name="OVERALL[data.overall].icon" class="h-5 w-5" :weight="2.2" />
        </span>
        <div class="min-w-0">
          <p class="text-[16.5px] font-semibold leading-snug text-slate-100" role="status">{{ OVERALL_TEXT[data.overall] }}</p>
          <p class="mt-0.5 text-xs text-slate-500">
            Updated <span class="tabular-nums">{{ updatedText }}</span> · refreshes every minute
          </p>
        </div>
      </section>

      <p v-if="stale" class="callout callout-warn mt-3" role="status">
        <Icon name="alert" />
        <span>Couldn't refresh just now, so this is the status from {{ updatedText }}. Trying again every minute.</span>
      </p>

      <div v-if="data.groups.length" class="mt-8 space-y-7">
        <section v-for="(g, gi) in data.groups" :key="gi" :aria-labelledby="g.name ? `status-group-${gi}` : undefined">
          <h2 v-if="g.name" :id="`status-group-${gi}`" class="section-title mb-2.5">{{ g.name }}</h2>
          <div class="card row-list">
            <StatusItem v-for="(it, ii) in g.items" :key="`${gi}-${ii}-${it.name}`" :item="it" :tz="tz" />
          </div>
        </section>
      </div>
      <div v-else class="card mt-8">
        <EmptyState icon="pulse" title="Nothing is listed here yet" :text="previewInfo ? 'Pick the apps and domains to show under Settings, Monitoring & alerts.' : 'Check back later.'" />
      </div>

      <footer class="mt-10 flex flex-col gap-2 border-t border-white/[0.06] pt-5 text-xs leading-relaxed text-slate-500 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <p class="max-w-md">Up means the app was running and answering. A day bar turns amber for some downtime and red for more than an hour; grey means no data.</p>
        <p class="shrink-0">Powered by <a class="link" href="https://github.com/JustinAlink/homeport" rel="noopener noreferrer">homeport</a></p>
      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { OVERALL_TEXT, type NoticeKind, type OverallState, type PublicStatus } from '~/shared/utils/status-page'

// The public status page: for family, friends and band members, without a login.
// It renders outside the admin app (app.vue: no shell, no admin requests, no
// login redirect) and only ever reads /api/public/status, or the admin-only
// preview with ?preview. While the page is off, the middleware below answers with
// the very same 404 as a page that never existed.

type Answer = PublicStatus & { preview?: { enabled: boolean; locked: boolean } }
interface Loaded {
  data: Answer
  /** the time zone offset the days were computed for (0 = UTC while server-rendering) */
  tz: number
  preview: boolean
}

definePageMeta({
  public: true,
  layout: 'public',
  middleware: [
    async (to) => {
      const nuxtApp = useNuxtApp()
      // the server already decided (and rendered the 404 when off): no second request while hydrating
      if (import.meta.client && nuxtApp.isHydrating && nuxtApp.payload.serverRendered) return
      const preview = 'preview' in to.query
      // composables before the first await: after it the Nuxt context is gone
      const loaded = useState<Loaded | null>('hp:status-page')
      // on the server, pass the visitor's cookies on: a preview needs the admin's session
      const fetcher = import.meta.server ? useRequestFetch() : $fetch
      try {
        loaded.value = { data: await fetcher<Answer>(preview ? '/api/status-page/preview' : '/api/public/status'), tz: 0, preview }
      } catch {
        // off, or a preview without an admin session: exactly what the router says for an unknown path
        return createError({ status: 404, fatal: false, statusText: `Page not found: ${to.fullPath}`, data: { path: to.fullPath } })
      }
    },
  ],
})

const loaded = useState<Loaded | null>('hp:status-page')
const data = computed(() => loaded.value?.data ?? null)
const tz = computed(() => loaded.value?.tz ?? 0)
const previewInfo = computed(() => (loaded.value?.preview ? data.value?.preview ?? null : null))

const NOTICE: Record<NoticeKind, { cls: string; icon: string; label: string }> = {
  info: { cls: 'callout-info', icon: 'info', label: 'Note' },
  maintenance: { cls: 'callout-info', icon: 'wrench', label: 'Planned maintenance' },
  incident: { cls: 'callout-warn', icon: 'alert', label: 'Known problem' },
}
const OVERALL: Record<OverallState, { card: string; badge: string; icon: string }> = {
  operational: { card: '!border-ok/30 bg-ok/[0.05]', badge: 'bg-ok/15 text-ok', icon: 'check' },
  issues: { card: '!border-amber-500/35 bg-amber-500/[0.06]', badge: 'bg-amber-500/15 text-amber-300', icon: 'alert' },
  outage: { card: '!border-red-500/35 bg-red-500/[0.06]', badge: 'bg-red-500/15 text-red-300', icon: 'x' },
  'not-reporting': { card: '', badge: 'bg-white/[0.07] text-slate-400', icon: 'clock' },
  unknown: { card: '', badge: 'bg-white/[0.07] text-slate-400', icon: 'clock' },
}

// times in the visitor's clock only once hydrated: the server can't know it, and a
// differing first render would be a hydration mismatch
const hydrated = ref(false)
const updatedText = computed(() =>
  hydrated.value && data.value ? new Date(data.value.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '…',
)

const stale = ref(false)
const REFRESH_MS = 60_000
let timer: ReturnType<typeof setInterval> | null = null
let lastFetch = 0

async function refresh() {
  if (!loaded.value) return
  const zone = new Date().getTimezoneOffset()
  lastFetch = Date.now()
  try {
    const next = await $fetch<Answer>(loaded.value.preview ? '/api/status-page/preview' : '/api/public/status', { query: { tz: zone } })
    loaded.value = { data: next, tz: zone, preview: loaded.value.preview }
    stale.value = false
  } catch {
    // keep what is on screen (the layout must not jump) and say how old it is
    stale.value = true
  }
}

function onVisible() {
  if (document.visibilityState === 'visible' && Date.now() - lastFetch >= REFRESH_MS) refresh()
}

onMounted(() => {
  hydrated.value = true
  useTheme().init() // follow the OS theme live: visitors have no stored choice
  // server-rendered with UTC days: fetch the visitor's own days straight away
  if (new Date().getTimezoneOffset() !== tz.value) refresh()
  else lastFetch = Date.now()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh()
  }, REFRESH_MS)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisible)
})

const pageTitle = computed(() => (previewInfo.value ? `Preview: ${data.value?.title}` : data.value?.title ?? ''))
useHead({
  title: pageTitle,
  meta: [
    { name: 'apple-mobile-web-app-title', content: computed(() => data.value?.title ?? '') },
    { name: 'description', content: computed(() => (data.value ? `${data.value.title}: ${OVERALL_TEXT[data.value.overall]}` : '')) },
  ],
})
</script>
