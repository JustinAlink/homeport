<template>
  <!-- layouts/default.vue is the signed-in app; layouts/public.vue (the status page)
       renders on its own: no sidebar, no admin requests, no login redirect, and none
       of the admin shell's code. -->
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
const route = useRoute()
// the admin app's manifest (start_url "/") would turn "Add to home screen" on the
// status page into a shortcut to the login, so a public page goes without it
useHead(() => (route.meta.public === true ? {} : { link: [{ rel: 'manifest', href: '/manifest.webmanifest' }] }))
</script>
