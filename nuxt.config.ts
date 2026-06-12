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
        { name: 'theme-color', content: '#0b0f14' },
        { name: 'robots', content: 'noindex' },
      ],
      htmlAttrs: { lang: 'en' },
    },
  },

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
  },
})
