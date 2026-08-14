/**
 * Tiny lucide-compatible glyphs used by the vendored assistant-ui
 * components (components/chat/assistant-ui/*). Frank deliberately has no
 * lucide-react dependency (ui/icons.tsx carries the shadcn set); these are
 * the handful of extra glyphs the official tool-fallback/markdown-text
 * components need, as inline SVGs with the same API as ui/icons.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function svg(props: IconProps, children: React.ReactNode) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function LoaderIcon(props: IconProps) {
  return svg(
    props,
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />,
  );
}

export function XCircleIcon(props: IconProps) {
  return svg(
    props,
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </>,
  );
}

export function AlertCircleIcon(props: IconProps) {
  return svg(
    props,
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>,
  );
}

export function CopyIcon(props: IconProps) {
  return svg(
    props,
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>,
  );
}
