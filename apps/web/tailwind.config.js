/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  safelist: ['tone-brand', 'tone-positive', 'tone-warning', 'tone-negative', 'tone-neutral'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#4F46E5',
          50: '#F5F4FF',
          100: '#EEEDFF',
          200: '#DDD9FF',
          300: '#C4BDFF',
          400: '#9B8CFA',
          500: '#7060EF',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
          900: '#302A70',
          950: '#1E1B3A',
        },
        navy: {
          DEFAULT: '#1E3248',
          light: '#2A4460',
          dark: '#131F30',
        },
        neutral: {
          DEFAULT: '#575757',
          50: '#F7F7F7',
          100: '#EDEDED',
          200: '#D9D9D9',
          300: '#B8B8B8',
          400: '#8B8B8B',
          500: '#6E6E6E',
          600: '#575757',
          700: '#444444',
          800: '#2E2E2E',
          900: '#1A1A1A',
        },
        positive: '#16A34A',
        negative: '#DC2626',
        muted: '#9CA3AF',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(87, 87, 87, 0.08), 0 1px 2px rgba(87, 87, 87, 0.04)',
      },
    },
  },
  plugins: [],
};
