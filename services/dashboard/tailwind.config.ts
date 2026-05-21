import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      colors: {
        // Pokemon-type accents (used sparingly — variant badges, type halos).
        poke: {
          fire: "#EE8130",
          water: "#6390F0",
          electric: "#F7D02C",
          grass: "#7AC74C",
          ice: "#96D9D6",
          psychic: "#F95587",
          dragon: "#6F35FC",
          dark: "#705746",
          fairy: "#D685AD",
          fighting: "#C22E28",
          flying: "#A98FF3",
          poison: "#A33EA1",
          ground: "#E2BF65",
          rock: "#B6A136",
          bug: "#A6B91A",
          ghost: "#735797",
          steel: "#B7B7CE",
          normal: "#A8A77A",
        },
      },
      keyframes: {
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "spin-slow": "spin-slow 1.4s linear infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
