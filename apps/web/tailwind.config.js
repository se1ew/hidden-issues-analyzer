/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Основные цвета проекта
        primary: {
          DEFAULT: '#90C0F0',
          50:  '#F0F7FF',
          100: '#E0EEFA',
          200: '#C0DCFA',
          300: '#90BFF0',
          400: '#5A9AE0',
          500: '#3678C5',
          600: '#255AAE',
          700: '#1B4590',
          800: '#133270',
          900: '#0C2050',
          950: '#071330',
        },
        navy: {
          DEFAULT: '#1E3248',
          light:   '#2A4460',
          dark:    '#131F30',
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
