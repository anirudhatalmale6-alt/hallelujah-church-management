/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#faf6f0',
          100: '#f0e6d4',
          200: '#e0cba8',
          300: '#cfad78',
          400: '#c49553',
          500: '#b87f3a',
          600: '#a06830',
          700: '#5a3e1b',
          800: '#4a3216',
          900: '#3a2711',
        },
        gold: {
          50: '#fdf9ef',
          100: '#faf0d5',
          200: '#f4ddaa',
          300: '#ecc574',
          400: '#d4a853',
          500: '#c99a3a',
          600: '#b1802e',
          700: '#936427',
          800: '#794f25',
          900: '#644222',
        },
      },
    },
  },
  plugins: [],
}
