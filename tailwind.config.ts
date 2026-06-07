import type { Config } from 'tailwindcss'

// homeport — dark "control panel" theme: deep slate surfaces + emerald accent.
export default <Partial<Config>>{
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0f14',
          900: '#11161d',
          850: '#141a22',
          800: '#1a212b',
          700: '#252e3a',
        },
        accent: {
          DEFAULT: '#10b981',
          dark: '#0e9f6e',
          light: '#34d399',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
}
