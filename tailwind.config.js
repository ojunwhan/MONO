/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Pretendard", "Inter", "Noto Sans JP", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
    }
  },
  plugins: []
};