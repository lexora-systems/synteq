import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f1726",
        ocean: "#0e7490",
        mint: "#0f766e",
        amber: "#d97706",
        ember: "#b91c1c",
        cloud: "#f8fafc"
      },
      boxShadow: {
        panel: "0 10px 40px rgba(15, 23, 38, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
