<template>
  <!-- A public page (the status page) renders on its own: no sidebar, no admin
       requests, no login redirect. The shell's code still ships in the entry chunk,
       as it does for /login: loading it lazily made the settings and service pages
       report hydration mismatches. -->
  <NuxtPage v-if="isPublic" />
  <div v-else class="min-h-screen bg-ink-950 text-slate-200">
    <AppShell>
      <NuxtPage />
    </AppShell>
    <ConfirmDialog />
    <ToastHost />
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const isPublic = computed(() => route.meta.public === true)
// the admin app's manifest (start_url "/") would turn "Add to home screen" on the
// status page into a shortcut to the login, so a public page goes without it
useHead(() => (isPublic.value ? {} : { link: [{ rel: 'manifest', href: '/manifest.webmanifest' }] }))
</script>
