export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',

  modules: ['@nuxtjs/tailwindcss'],

  // self-hosted fonts (no CDN request; homeport often runs on a LAN or offline)
  css: ['@fontsource-variable/inter/wght.css', '@fontsource-variable/jetbrains-mono/wght.css'],

  // Server backend (reads the Docker socket) — NOT static.
  nitro: {
    preset: 'node-server',
    typescript: { tsConfig: { compilerOptions: { noUncheckedIndexedAccess: false } } },
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
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
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

  // Nuxt 4 turns on noUncheckedIndexedAccess (every list[0] becomes "possibly
  // undefined": 175 places here). homeport was written under Nuxt 3's rules;
  // adopting the stricter mode is its own hardening job, not part of the upgrade.
  typescript: {
    tsConfig: { compilerOptions: { noUncheckedIndexedAccess: false } },
    sharedTsConfig: { compilerOptions: { noUncheckedIndexedAccess: false } },
    nodeTsConfig: { compilerOptions: { noUncheckedIndexedAccess: false } },
  },

  // The app manifest only serves client-side route rules and prerender checks,
  // and homeport has neither. Its fetch (builds/meta/<id>.json on every load)
  // is aborted when a page is left quickly, which logged NUXT_E5002 now and then.
  experimental: {
    appManifest: false,
  },

  // @nuxtjs/tailwindcss adds `tailwindcss/nesting`, which Nuxt 4's PostCSS loader
  // can't load (a build warning). main.css uses no nested rules, so it's off.
  postcss: {
    plugins: { 'tailwindcss/nesting': false },
  },
})
