/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        vault: {
          yellow: '#ffd814',
          blue: '#1d4ed8',
          dark: '#1e293b'
        }
      }
    },
  },
  plugins: [],
}
