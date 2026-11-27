export default defineNuxtPlugin((nuxtApp) => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // the status page's visitors are not homeport users: don't install the admin
      // app's worker (and its cached shell) in their browsers
      if (nuxtApp.$router.currentRoute.value.meta.public) return
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
})
