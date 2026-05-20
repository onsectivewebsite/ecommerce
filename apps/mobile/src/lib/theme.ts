// Dark-first palette mirroring the buyer-web design tokens so the brand identity
// stays consistent across native + web. Pure values — components consume directly.

export const colors = {
  ink: {
    50:  '#f8f9fc',
    100: '#e3e6ee',
    200: '#bcc1cf',
    300: '#90969f',
    400: '#6c7180',
    500: '#4a4f5d',
    600: '#2f3340',
    700: '#1f222b',
    800: '#15171d',
    900: '#0e0f15',
    950: '#0a0b0f',
  },
  gold: {
    400: '#d4a93f',
    500: '#b88c1f',
  },
  accent: {
    200: '#f9c39b',
    300: '#f5a268',
    500: '#cb6c2a',
    700: '#94481a',
  },
  success: '#36b37e',
  warning: '#e2b93b',
  danger: '#e25c5c',
};

export const radii = { sm: 6, md: 10, lg: 16, xl: 22 };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32 };

export const typography = {
  display: { fontFamily: 'System', fontWeight: '700' as const },
  body: { fontFamily: 'System', fontWeight: '400' as const },
  mono: { fontFamily: 'Menlo' },
};
