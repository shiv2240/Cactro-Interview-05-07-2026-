const path = require("path");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, "src/**/*.{html,js,ts,tsx}"),
    path.join(__dirname, "src/**/*.html"),
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        mist: {
          50: "#f4f7fb",
          100: "#e8eef6",
          200: "#d0dceb",
          700: "#3a4a5c",
          800: "#2a3644",
          900: "#1a222c",
        },
        sky: {
          accent: "#3b82f6",
          soft: "#7dd3fc",
        },
        ink: {
          DEFAULT: "#1e293b",
          muted: "#64748b",
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', "Segoe UI", "system-ui", "sans-serif"],
        display: ['"Fraunces"', "Georgia", "serif"],
      },
      boxShadow: {
        glass: "0 8px 32px rgba(30, 41, 59, 0.12)",
      },
    },
  },
  plugins: [],
};
