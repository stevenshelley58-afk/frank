import type { Config } from 'tailwindcss';

/**
 * FRANK — Light Design System 1.0 (design-tokens.json).
 *
 * Warm paper canvas, olive-ink chrome, one brand signal. The semantic names
 * below (shell, rail, card, ink, line, muted, accent, …) are the vocabulary
 * every surface already uses, so remapping them here re-skins the whole app —
 * chat, living frame, and every console module — without touching markup.
 *
 * Room identity lives in per-room tints (see lib/rooms.ts), never in the
 * shell chrome.
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
        /* -------- surfaces (light) -------- */
        shell: '#F1EFE6',   // background — warm paper
        rail: '#E7E3D7',    // chrome — sunken paper
        card: '#FBFAF5',    // surface — paper highlight
        hover: '#E7E3D7',   // interactive hover on paper
        subtle: '#F1EFE6',  // quiet fill
        paper: '#FBFAF5',   // raised paper surface
        paper2: '#F1EFE6',  // paper mid
        paper3: '#E7E3D7',  // paper sunken
        frame: '#EDEAE0',   // living frame — soft paper
        /* -------- ink -------- */
        ink: '#151711',     // text / command chrome
        ink2: '#353A33',    // secondary text
        muted: '#6E7068',   // muted text
        /* -------- hairline + brand + semantic -------- */
        line: '#D2CEC2',    // warm hairline border
        accent: '#F23B1D',  // brand signal orange
        success: '#76AC0F', // verified — acid (AA-contrast ink-on-paper)
        running: '#3E69BD', // running — blue
        warning: '#A96F0D', // waiting — amber
        danger: '#B52D34',  // critical — red
        acid: '#B8F238',    // verified accent (decorative, ink text)
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
