import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          deep: "#073F36",
          petrol: "#0B4A40",
          accent: "#168A78",
          soft: "#EAF3EF",
          surface: "#F7F8F3",
          card: "#FFFFFA",
          gold: "#C7A45D",
          ink: "#0F2F2A",
          slate: "#5B6B66",
          muted: "#87948F",
          border: "#D6E2DC",
        },
      },
      boxShadow: {
        premium: "0 24px 70px rgba(7, 63, 54, 0.13)",
      },
    },
  },
  plugins: [],
};

export default config;
