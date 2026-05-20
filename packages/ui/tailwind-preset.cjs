/** Onsective premium design system Tailwind preset. */
module.exports = {
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: '1.25rem',
      screens: {
        '2xl': '1280px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        display: ['"Fraunces"', '"Inter"', 'serif'],
      },
      colors: {
        ink: {
          50: '#f7f7f8',
          100: '#ececef',
          200: '#d6d6dc',
          300: '#b1b2bb',
          400: '#878793',
          500: '#5a5b67',
          600: '#3d3e49',
          700: '#26272f',
          800: '#16171d',
          900: '#0a0b0f',
          950: '#06070a',
        },
        accent: {
          50:  '#f0f6ff',
          100: '#dbe9ff',
          200: '#b8d3ff',
          300: '#85b3ff',
          400: '#5189ff',
          500: '#2563ff',
          600: '#1c47db',
          700: '#1738a8',
          800: '#142e84',
          900: '#11266a',
        },
        gold: {
          400: '#e9c46a',
          500: '#d4a93f',
          600: '#a9851f',
        },
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
      },
      boxShadow: {
        elev1: '0 1px 2px rgba(0,0,0,0.06), 0 1px 1px rgba(0,0,0,0.04)',
        elev2: '0 4px 12px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06)',
        elev3: '0 20px 40px -12px rgba(0,0,0,0.4)',
        glow:  '0 0 0 1px rgba(37,99,255,0.4), 0 8px 30px rgba(37,99,255,0.25)',
      },
      borderRadius: {
        xl: '14px',
        '2xl': '20px',
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out both',
        'slide-up': 'slide-up 240ms cubic-bezier(0.2,0.7,0.2,1) both',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
