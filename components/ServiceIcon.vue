<template>
  <span
    class="grid shrink-0 place-items-center overflow-hidden rounded-md"
    :style="wrapStyle"
  >
    <img
      v-if="logoUrl && !failed"
      :src="logoUrl"
      :alt="name"
      class="h-full w-full object-contain p-1"
      loading="lazy"
      @error="failed = true"
    />
    <span v-else-if="emoji" class="leading-none" :style="{ fontSize: size * 0.55 + 'px' }">{{ emoji }}</span>
    <span v-else class="font-semibold leading-none" :style="{ fontSize: size * 0.4 + 'px' }">{{ initial }}</span>
  </span>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{ name: string; icon?: string | null; size?: number; remote?: boolean }>(),
  { size: 30, remote: true },
)

const CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg'
const isUrl = (s: string) => /^https?:\/\//.test(s)
const isEmoji = (s: string) => [...s].length <= 2 && !/^[a-z0-9]+$/i.test(s)
const slugify = (s: string) =>
  s.toLowerCase().replace(/\.service$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const failed = ref(false)
watch(() => [props.name, props.icon], () => (failed.value = false))

const emoji = computed(() => (props.icon && isEmoji(props.icon) ? props.icon : null))
const logoUrl = computed(() => {
  const src = props.icon
  if (src) {
    if (isUrl(src)) return src // explicit URL — always honored
    if (isEmoji(src)) return null
    return props.remote ? `${CDN}/${slugify(src)}.svg` : null // slug → CDN lookup
  }
  return props.remote ? `${CDN}/${slugify(props.name)}.svg` : null // guess from name → CDN
})

const initial = computed(() => props.name.charAt(0).toUpperCase())

// Monogram colour (only used on fallback) — hashed from the name.
const hue = computed(() => {
  let h = 0
  for (const c of props.name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
})
const showingLogo = computed(() => !!logoUrl.value && !failed.value)
const wrapStyle = computed(() => ({
  width: props.size + 'px',
  height: props.size + 'px',
  background: showingLogo.value ? 'rgba(255,255,255,0.05)' : `hsl(${hue.value} 38% 20%)`,
  color: `hsl(${hue.value} 65% 68%)`,
}))
</script>
