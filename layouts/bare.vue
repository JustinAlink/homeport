<template>
  <!-- The login page: the app's colours, none of the signed-in shell. The shell
       would poll the API from here (capabilities, services, silences, the
       connection check) and every one of those answers 401 before sign-in. -->
  <div class="min-h-screen bg-ink-950 text-slate-200">
    <slot />
  </div>
</template>
