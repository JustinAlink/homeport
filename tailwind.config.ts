import type { Config } from 'tailwindcss'

// homeport — spacious "control panel" theme, light + dark via CSS variables
// (see assets/css/main.css). Palette names are historical and dark-first:
// ink = surfaces, slate = text scale, white = hairline base, accent = brand
// (indigo, interactive), ok = healthy/running (emerald, status).
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

export default <Partial<Config>>{
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          950: v('ink-950'),
          900: v('ink-900'),
          850: v('ink-850'),
          800: v('ink-800'),
          700: v('ink-700'),
        },
        slate: {
          100: v('slate-100'),
          200: v('slate-200'),
          300: v('slate-300'),
          400: v('slate-400'),
          500: v('slate-500'),
          600: v('slate-600'),
          700: v('slate-700'),
        },
        white: v('line'),
        accent: {
          DEFAULT: v('accent'),
          dark: v('accent-dark'),
          light: v('accent-light'),
        },
        'on-accent': v('on-accent'),
        ok: {
          DEFAULT: v('ok'),
          soft: v('ok-soft'),
        },
        red: { 300: v('red-300'), 400: v('red-400'), 500: v('red-500') },
        amber: { 300: v('amber-300'), 400: v('amber-400'), 500: v('amber-500') },
        sky: { 200: v('sky-200'), 300: v('sky-300'), 400: v('sky-400'), 500: v('sky-500') },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
}
