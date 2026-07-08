export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',

  modules: ['@nuxtjs/tailwindcss'],

  // Server backend (reads the Docker socket) — NOT static.
  nitro: {
    preset: 'node-server',
    experimental: {
      websocket: true, // web terminal (crossws ships with nitro)
    },
  },

  // All real config is read at request time from process.env in server/utils/config.ts,
  // so a single prebuilt image is fully configurable at container runtime.
  runtimeConfig: {
    public: {
      appName: 'homeport',
    },
  },

  app: {
    head: {
      title: 'homeport',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'A zero-config status hub for your self-hosted Docker fleet.' },
        { name: 'theme-color', content: '#0a0e15' },
        { name: 'robots', content: 'noindex' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'homeport' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
      htmlAttrs: { lang: 'en' },
      script: [
        {
          // theme before first paint (no flash): explicit choice wins, else OS
          innerHTML: `(function(){try{var t=localStorage.getItem('hp:theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){document.documentElement.classList.add('dark')}})()`,
        },
      ],
    },
  },

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
  },
})
