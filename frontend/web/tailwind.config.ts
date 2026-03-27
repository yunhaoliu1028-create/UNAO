import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}", "./lib/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        appbg: "var(--bg)",
        appcard: "var(--card)",
        appline: "var(--line)",
        apptext: "var(--text)",
        appmuted: "var(--muted)",
        appprimary: "var(--primary)",
        appok: "var(--ok)",
        appdanger: "var(--danger)"
      },
      boxShadow: {
        card: "0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 30px rgba(0, 0, 0, 0.06)",
        soft: "0 2px 18px rgba(0, 0, 0, 0.05)"
      }
    }
  },
  plugins: []
};

export default config;
