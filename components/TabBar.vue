<template>
  <div class="relative -mx-4 mb-6 sm:mx-0">
    <nav
      ref="nav"
      class="overflow-x-auto px-4 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden"
      role="tablist"
      @scroll.passive="measure"
    >
      <div class="flex min-w-max items-center gap-1 border-b border-white/[0.08]">
        <button
          v-for="t in tabs"
          :key="t.key"
          :ref="(el) => setBtn(t.key, el as HTMLElement | null)"
          type="button"
          role="tab"
          :aria-selected="modelValue === t.key"
          class="relative -mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-2.5 text-[13px] font-medium transition-colors sm:px-3"
          :class="modelValue === t.key ? 'border-accent text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'"
          @click="$emit('update:modelValue', t.key)"
        >
          <Icon v-if="t.icon" :name="t.icon" class="hidden h-3.5 w-3.5 sm:block" />
          {{ t.label }}
          <span v-if="t.dot" class="dot h-1.5 w-1.5 bg-sky-400" aria-hidden="true" />
        </button>
      </div>
    </nav>
    <!-- edge hints: more tabs this way (and whether one of them has news) -->
    <button
      v-if="canLeft"
      type="button"
      tabindex="-1"
      aria-hidden="true"
      class="absolute inset-y-0 left-0 flex w-10 items-center bg-gradient-to-r from-ink-950 via-ink-950/80 to-transparent pl-1 text-slate-400"
      @click="nudge(-1)"
    ><Icon name="chevron-left" class="h-4 w-4" /></button>
    <button
      v-if="canRight"
      type="button"
      tabindex="-1"
      aria-hidden="true"
      class="absolute inset-y-0 right-0 flex w-12 items-center justify-end gap-1 bg-gradient-to-l from-ink-950 via-ink-950/80 to-transparent pr-1 text-slate-400"
      @click="nudge(1)"
    >
      <span v-if="dotRight" class="dot h-1.5 w-1.5 bg-sky-400" />
      <Icon name="chevron-right" class="h-4 w-4" />
    </button>
  </div>
</template>

<script setup lang="ts">
// Underlined tab strip that scrolls sideways on narrow screens instead of
// clipping the last tabs. Edge fades say there is more, the active tab is kept in
// view, and a tab with a dot (an update waiting) that is scrolled out of sight
// still shows its dot on the edge.
const props = defineProps<{ tabs: { key: string; label: string; icon?: string; dot?: boolean }[]; modelValue: string }>()
defineEmits<{ 'update:modelValue': [string] }>()

const nav = ref<HTMLElement | null>(null)
const btns = new Map<string, HTMLElement>()
const setBtn = (key: string, el: HTMLElement | null) => (el ? btns.set(key, el) : btns.delete(key))
const canLeft = ref(false)
const canRight = ref(false)
const dotRight = ref(false)

function measure() {
  const n = nav.value
  if (!n) return
  canLeft.value = n.scrollLeft > 2
  canRight.value = n.scrollLeft + n.clientWidth < n.scrollWidth - 2
  const edge = n.getBoundingClientRect().right - 24
  dotRight.value = props.tabs.some((t) => t.dot && (btns.get(t.key)?.getBoundingClientRect().right ?? 0) > edge)
}

function nudge(dir: 1 | -1) {
  nav.value?.scrollBy({ left: dir * nav.value.clientWidth * 0.6, behavior: 'smooth' })
}

// scroll the strip itself (scrollIntoView would also move the page), clear of the edge fades
function showActive(behavior: ScrollBehavior = 'smooth') {
  const n = nav.value
  const b = btns.get(props.modelValue)
  if (!n || !b) return
  const nr = n.getBoundingClientRect()
  const br = b.getBoundingClientRect()
  if (br.left < nr.left + 40) n.scrollBy({ left: br.left - nr.left - 40, behavior })
  else if (br.right > nr.right - 48) n.scrollBy({ left: br.right - nr.right + 48, behavior })
}

let ro: ResizeObserver | null = null
onMounted(() => {
  measure()
  showActive('auto')
  ro = new ResizeObserver(measure)
  if (nav.value) ro.observe(nav.value)
})
onBeforeUnmount(() => ro?.disconnect())
watch(() => props.modelValue, () => nextTick(showActive))
// tabs can arrive late (the Update tab once update data loads): place the active one again
watch(
  () => props.tabs,
  () =>
    nextTick(() => {
      showActive('auto')
      measure()
    }),
  { deep: true },
)
</script>
