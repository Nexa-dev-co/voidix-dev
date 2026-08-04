import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        fg: "var(--fg)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        // The anchor deepened for the hero's cream — see the contrast note in globals.css :root.
        "accent-deep": "var(--accent-deep)",
        border: "var(--border)",
        card: "var(--card)",
        // The heat ramp. A temperature scale, not a tint scale: the hue rotates as it brightens.
        // ⚠ heat-400 and below fail small-text contrast even on black — light and geometry only.
        heat: {
          "000": "var(--heat-000)",
          100: "var(--heat-100)",
          200: "var(--heat-200)",
          300: "var(--heat-300)",
          400: "var(--heat-400)",
          500: "var(--heat-500)",
          600: "var(--heat-600)",
          700: "var(--heat-700)",
          800: "var(--heat-800)",
          900: "var(--heat-900)",
          950: "var(--heat-950)",
          999: "var(--heat-999)",
        },
        // The cool counterweight. Lighting and substrate only — never brand, type or UI.
        slate: {
          200: "var(--slate-200)",
          400: "var(--slate-400)",
          600: "var(--slate-600)",
          800: "var(--slate-800)",
        },
      },
      fontFamily: {
        display: ["var(--font-syne)", "sans-serif"],
        body: ["var(--font-dm-sans)", "sans-serif"],
      },
      letterSpacing: {
        eyebrow: "3px",
      },
    },
  },
  plugins: [],
};

export default config;
