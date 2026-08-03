import type { Config } from 'tailwindcss';

/**
 * FRANK Atlantic Design System 1.1.
 *
 * Components consume semantic roles, never palette primitives. The RGB
 * custom properties are defined in app/globals.css so Tailwind opacity
 * modifiers continue to work and the same component geometry can be used by
 * both Atlantic themes.
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      colors: {
        shell: 'rgb(var(--tw-shell) / <alpha-value>)',
        rail: 'rgb(var(--tw-rail) / <alpha-value>)',
        card: 'rgb(var(--tw-card) / <alpha-value>)',
        hover: 'rgb(var(--tw-hover) / <alpha-value>)',
        subtle: 'rgb(var(--tw-subtle) / <alpha-value>)',
        paper: 'rgb(var(--tw-paper) / <alpha-value>)',
        paper2: 'rgb(var(--tw-paper-2) / <alpha-value>)',
        paper3: 'rgb(var(--tw-paper-3) / <alpha-value>)',
        frame: 'rgb(var(--tw-frame) / <alpha-value>)',
        ink: 'rgb(var(--tw-ink) / <alpha-value>)',
        ink2: 'rgb(var(--tw-ink-2) / <alpha-value>)',
        muted: 'rgb(var(--tw-muted) / <alpha-value>)',
        line: 'rgb(var(--tw-line) / <alpha-value>)',
        accent: 'rgb(var(--tw-accent) / <alpha-value>)',
        success: 'rgb(var(--tw-success) / <alpha-value>)',
        running: 'rgb(var(--tw-running) / <alpha-value>)',
        warning: 'rgb(var(--tw-warning) / <alpha-value>)',
        danger: 'rgb(var(--tw-danger) / <alpha-value>)',
        acid: 'rgb(var(--tw-acid) / <alpha-value>)',
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
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
          '0%, 100%': { boxShadow: '0 0 0 3px rgba(242,59,29,0.16)' },
          '50%': { boxShadow: '0 0 0 6px rgba(242,59,29,0.05)' },
        },
      },
      animation: {
        'msg-in': 'msg-in 0.4s cubic-bezier(0.2, 0.7, 0.3, 1) both',
        'room-in': 'room-in 0.28s cubic-bezier(0.2, 0, 0, 1) both',
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
