const preset = require('@onsective/ui/tailwind-preset');

/**
 * Buyer-web LIGHT theme: invert the shared `ink-*` scale so the same
 * `bg-ink-950` / `text-ink-100` class names produce a clean, retail-style
 * light surface without editing every component.
 *
 *   ink-50  was lightest  → now darkest  (strong text)
 *   ink-950 was darkest   → now white    (page bg)
 *
 * Per-app config; seller / admin / shipping keep the preset's dark scale.
 */
module.exports = {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx,css}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          50:  '#0f172a',   // strongest text
          100: '#1e293b',
          200: '#334155',
          300: '#475569',
          400: '#64748b',   // muted text — still AA on white
          500: '#94a3b8',   // disabled / placeholder
          600: '#cbd5e1',   // strong border
          700: '#e2e8f0',   // default border
          800: '#eef2f7',   // subtle divider
          900: '#f7f8fa',   // soft surface
          950: '#ffffff',   // page background
        },
        // Warm CTA — Amazon-style add-to-cart yellow/orange.
        cta: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
      },
      borderRadius: {
        xl: '12px',
        '2xl': '14px',
      },
    },
  },
};
