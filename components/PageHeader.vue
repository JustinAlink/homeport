<template>
  <header class="mb-6 lg:mb-8">
    <nav v-if="crumbs?.length" class="mb-2 flex min-w-0 items-center gap-1 text-xs text-slate-500" aria-label="Breadcrumb">
      <template v-for="(c, i) in crumbs" :key="i">
        <NuxtLink v-if="c.to" :to="c.to" class="truncate hover:text-slate-200">{{ c.label }}</NuxtLink>
        <span v-else class="truncate">{{ c.label }}</span>
        <Icon name="chevron-right" class="h-3 w-3 shrink-0 opacity-60" />
      </template>
    </nav>
    <div class="flex flex-wrap items-start gap-x-6 gap-y-4">
      <!-- min width so narrow screens wrap the actions below instead of squeezing the title to nothing -->
      <div class="flex min-w-[min(100%,18rem)] flex-1 items-center gap-3.5">
        <slot name="icon" />
        <div class="min-w-0">
          <div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 class="truncate text-[22px] font-semibold leading-tight tracking-[-0.015em] text-slate-100">{{ title }}</h1>
            <slot name="badges" />
          </div>
          <p v-if="subtitle || $slots.subtitle" class="mt-1 max-w-3xl text-[13px] leading-relaxed text-slate-500">
            <slot name="subtitle">{{ subtitle }}</slot>
          </p>
        </div>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </header>
</template>

<script setup lang="ts">
// Shared page header: optional breadcrumb trail, title + badges, a one-line
// explanation and a right-aligned action row. Top-level pages leave `crumbs`
// out (the sidebar is the way back); detail pages pass their parent chain.
defineProps<{ title: string; subtitle?: string; crumbs?: { label: string; to?: string }[] }>()
</script>
