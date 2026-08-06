/**
 * ui/icons.tsx — minimal lucide-compatible icon set for vendored shadcn
 * components (Track A1). Frank keeps its own icon language in
 * `components/icons.tsx`; these are the handful of glyphs the vendored
 * primitives need (Check, X, Search, chevrons, Circle), sized via the
 * same `size-4`/`size-3` Tailwind utilities shadcn passes through
 * className — no lucide-react dependency.
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

export function Check(props: IconProps) {
  return svg(props, <path d="M20 6 9 17l-5-5" />);
}

export function X(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>,
  );
}

export function Search(props: IconProps) {
  return svg(
    props,
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>,
  );
}

export function ChevronDown(props: IconProps) {
  return svg(props, <path d="m6 9 6 6 6-6" />);
}

export function ChevronUp(props: IconProps) {
  return svg(props, <path d="m18 15-6-6-6 6" />);
}

export function ChevronRight(props: IconProps) {
  return svg(props, <path d="m9 18 6-6-6-6" />);
}

export function Circle(props: IconProps) {
  return svg(props, <circle cx="12" cy="12" r="10" />);
}
