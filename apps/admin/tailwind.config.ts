import type { Config } from 'tailwindcss';

// The panel borrows the site's tokens so it reads as the same product, but it is a TOOL, not a
// showpiece: denser, flatter, and calmer than voidix.tech. No scroll choreography, no WebGL.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        border: 'var(--border)',
        card: 'var(--card)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        display: ['var(--font-syne)', 'sans-serif'],
        sans: ['var(--font-dm-sans)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
