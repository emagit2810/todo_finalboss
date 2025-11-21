import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  content: [
    "./index.html",
    "./App.tsx",
    "./index.tsx",
    "./components/**/*.{ts,tsx}",
    "./services/**/*.{ts,tsx}",
    "./utils/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'Source Sans Pro'", "system-ui", "sans-serif"],
      },
      colors: {
        accent: {
          primary: "#2563eb",
          muted: "#e0e7ff",
        },
        primary: {
          500: "#6366f1",
          600: "#4f46e5",
        },
        slate: {
          850: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
      },
      animation: {
        "pulse-fast": "pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [animate],
};

export default config;
