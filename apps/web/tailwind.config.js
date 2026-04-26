/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Основные цвета проекта
        primary: {
          DEFAULT: '#B7EFFF',
          50: '#F2FCFF',
          100: '#E5F8FF',
          200: '#CFF4FF',
          300: '#B7EFFF',
          400: '#8EE2FA',
          500: '#5DCEEF',
          600: '#34B4D8',
          700: '#1E8FB1',
          800: '#176E89',
          900: '#114F62',
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
