<template>
  <!-- The signed-in app: sidebar, palette, dialogs and toasts. A layout, so Nuxt
       ships it as its own chunk and a page with another layout (the public status
       page) never downloads any of it, while hydration still waits for it. -->
  <div class="min-h-screen bg-ink-950 text-slate-200">
    <AppShell>
      <slot />
    </AppShell>
    <ConfirmDialog />
    <ToastHost />
  </div>
</template>
