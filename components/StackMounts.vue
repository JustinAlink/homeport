<template>
  <section v-if="mounts.length">
    <div class="mb-2 flex items-center gap-2">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500">Data &amp; mounts</h2>
      <button
        class="ml-auto rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5"
        :disabled="loading"
        @click="load"
      >{{ loading ? '…' : 'Refresh' }}</button>
    </div>
    <p class="mb-2 text-xs text-slate-600">
      Where this stack's containers keep their files. Config inside the stack folder is editable in Files above;
      named volumes and host paths live outside it — their data survives a recreate, but it isn't edited from here.
    </p>

    <div class="overflow-hidden rounded-lg border border-white/5 bg-ink-900">
      <div
        v-for="m in mounts"
        :key="key(m)"
        class="flex items-center gap-3 border-b border-white/5 px-4 py-2 last:border-b-0"
      >
        <Icon
          :name="m.kind === 'bind-external' ? 'file' : 'stacks'"
          class="h-4 w-4 shrink-0"
          :class="m.kind === 'bind-internal' ? 'text-accent-light' : m.kind === 'volume' ? 'text-sky-300/80' : 'text-slate-500'"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate font-mono text-[13px] text-slate-200" :title="m.dest">{{ m.dest }}</div>
          <div class="truncate text-[11px] text-slate-500">
            <template v-if="m.kind === 'volume'">
              {{ m.anonymous ? 'anonymous volume' : 'named volume' }}
              <span class="font-mono text-slate-400">{{ m.anonymous ? m.name.slice(0, 12) + '…' : m.name }}</span>
            </template>
            <template v-else-if="m.kind === 'bind-internal'">
              <template v-if="m.hostVisible !== false">
                in this stack's files · <span class="font-mono text-slate-400">{{ m.rel || '(stack root)' }}</span>
              </template>
              <template v-else>
                in the container · <span class="font-mono text-slate-400">{{ m.dest }}</span>
                <span class="text-amber-300/70">· host path not visible to homeport</span>
              </template>
            </template>
            <template v-else>
              host path <span class="font-mono text-slate-400">{{ m.source }}</span>
            </template>
          </div>
        </div>
        <span
          class="shrink-0 rounded-full border px-1.5 py-px text-[9px] uppercase tracking-wider"
          :class="m.rw ? 'border-white/10 text-slate-500' : 'border-amber-400/30 text-amber-300'"
        >{{ m.rw ? 'rw' : 'ro' }}</span>
        <span
          v-if="m.services.length"
          class="hidden shrink-0 truncate font-mono text-[10px] text-slate-600 sm:block"
          :title="m.services.join(', ')"
        >{{ m.services.join(', ') }}</span>
        <template v-if="m.kind === 'bind-internal'">
          <!-- homeport can read the bind → edit it directly in the file browser -->
          <button
            v-if="m.hostVisible !== false"
            class="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/5"
            @click="$emit('browse', m.rel)"
          >open</button>
          <!-- host path invisible to homeport (named-volume stacks dir) → go through the container -->
          <button
            v-else-if="canBrowse(m)"
            class="shrink-0 rounded-md border border-accent/30 px-1.5 py-0.5 text-[10px] text-accent-light hover:bg-accent/10"
            title="homeport can't see this bind on disk — browse it inside the container instead"
            @click="openContainer(m)"
          >{{ m.rw ? 'browse' : 'view' }}</button>
        </template>
        <template v-else>
          <button
            v-if="canBrowse(m)"
            class="shrink-0 rounded-md border border-accent/30 px-1.5 py-0.5 text-[10px] text-accent-light hover:bg-accent/10"
            :title="`Browse + edit files inside this ${m.kind === 'volume' ? 'volume' : 'mount'}`"
            @click="openContainer(m)"
          >{{ m.rw ? 'browse' : 'view' }}</button>
          <NuxtLink
            v-if="m.kind === 'volume'"
            to="/storage"
            class="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/5"
            title="Manage this volume under Storage"
          >storage ↗</NuxtLink>
        </template>
      </div>
    </div>

    <ContainerFiles
      v-if="browsing"
      :container="browsing.container"
      :root="browsing.root"
      :name="stack"
      :title="browsing.title"
      :read-only="browsing.readOnly"
      @close="browsing = null"
    />
  </section>
</template>

<script setup lang="ts">
interface VolumeMount { kind: 'volume'; name: string; anonymous: boolean; dest: string; rw: boolean; services: string[]; container: string }
interface BindInternal { kind: 'bind-internal'; rel: string; dest: string; rw: boolean; services: string[]; container: string; hostVisible?: boolean }
interface BindExternal { kind: 'bind-external'; source: string; dest: string; rw: boolean; services: string[]; container: string }
type Mount = VolumeMount | BindInternal | BindExternal

const props = defineProps<{ stack: string }>()
defineEmits<{ browse: [rel: string] }>()

const { caps, load: loadCaps } = useCapabilities()
const mounts = ref<Mount[]>([])
const loading = ref(false)
const browsing = ref<{ container: string; root: string; title: string; readOnly: boolean } | null>(null)

function key(m: Mount): string {
  return m.kind === 'volume'
    ? `v:${m.name}:${m.dest}`
    : m.kind === 'bind-internal'
      ? `bi:${m.rel}:${m.dest}`
      : `be:${m.source}:${m.dest}`
}

// browsing INSIDE the container needs the capability + a container that has the mount
function canBrowse(m: Mount): boolean {
  return caps.value.containerFiles && !!m.container
}
function openContainer(m: Mount) {
  browsing.value = {
    container: m.container,
    root: m.dest,
    title: m.kind === 'volume' ? m.name : m.dest,
    readOnly: !m.rw,
  }
}

async function load() {
  loading.value = true
  try {
    const r = await $fetch<{ mounts: Mount[] }>(`/api/stacks/${encodeURIComponent(props.stack)}/mounts`)
    mounts.value = r.mounts
  } catch {
    mounts.value = [] // stacks disabled / host down — hide the section rather than error
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadCaps()
  load()
})
</script>
