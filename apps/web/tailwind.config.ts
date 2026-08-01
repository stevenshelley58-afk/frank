import type { Config } from 'tailwindcss';

/**
 * FRANK OS — chat-first shell.
 * Light, minimal theme: warm near-white canvas, white surfaces, hairline
 * borders, ink text, one restrained accent. Room identity lives in small
 * muted tints (dots, chips, per-room send) — never in the shell chrome.
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      colors: {
        // surfaces (light)
        shell: '#FAFAF9',
        rail: '#FFFFFF',
        card: '#FFFFFF',
        hover: '#F5F5F4',
        subtle: '#F5F5F4',
        // ink
        ink: '#1C1917',
        ink2: '#44403C',
        paper: '#FFFFFF',
        paper2: '#F5F5F4',
        paper3: '#FFFFFF',
        muted: '#78716C',
        // hairline + one restrained accent + semantic
        line: '#E7E5E4',
        accent: '#2563EB',
        success: '#16A34A',
        // legacy aliases -> new palette (kept so old classes still render)
        orange: '#2563EB',
        acid: '#16A34A',
        aciddark: '#15803D',
      },
      keyframes: {
        'msg-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'room-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'none' },
        },
        typing: {
          '0%, 80%, 100%': { opacity: '0.25', transform: 'translateY(0)' },
          '40%': { opacity: '1', transform: 'translateY(-2px)' },
        },
        flow: {
          from: { backgroundPosition: '0 0' },
          to: { backgroundPosition: '200% 0' },
        },
        pip: {
          '0%, 100%': { boxShadow: '0 0 0 3px rgba(37,99,235,0.14)' },
          '50%': { boxShadow: '0 0 0 6px rgba(37,99,235,0.04)' },
        },
      },
      animation: {
        'msg-in': 'msg-in 0.4s cubic-bezier(0.2, 0.7, 0.3, 1) both',
        'room-in': 'room-in 0.28s ease both',
        'slide-in': 'slide-in 0.24s cubic-bezier(0.2, 0.7, 0.3, 1) both',
        typing: 'typing 1.2s infinite',
        flow: 'flow 1.7s linear infinite',
        pip: 'pip 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
