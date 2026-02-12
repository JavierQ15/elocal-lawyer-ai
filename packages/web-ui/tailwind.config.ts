import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Space Grotesk", "Segoe UI", "Tahoma", "sans-serif"],
      },
      colors: {
        slatebrand: {
          50: "#f5f7fa",
          100: "#e6edf4",
          200: "#cad8e7",
          300: "#a9bed6",
          400: "#7d9ebf",
          500: "#5f84ab",
          600: "#4b6c90",
          700: "#3e5773",
          800: "#36485f",
          900: "#303d4f",
        },
      },
      boxShadow: {
        panel: "0 16px 34px rgba(30, 42, 58, 0.15)",
      },
    },
  },
  plugins: [],
};

export default config;
