/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        'bg-surface': 'var(--color-bg-surface)',
        accent: 'var(--color-accent)',
        'accent-light': 'var(--color-accent-light)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        divider: 'var(--color-divider)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
      },
      borderRadius: {
        md: '10px',
        lg: '14px',
        xl: '18px',
        full: '9999px',
      },
    },
  },
  plugins: [],
};
