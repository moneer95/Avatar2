/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#08090c",
          900: "#0c0e13",
          850: "#10131a",
          800: "#161a23",
          700: "#1f2430",
          600: "#2b3140",
          500: "#3a4156",
        },
        accent: {
          400: "#7dd3fc",
          500: "#38bdf8",
          600: "#0ea5e9",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 40px -10px rgba(56,189,248,0.5)",
      },
    },
  },
  plugins: [],
};
