import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(props: IconProps) {
  const { size = 18, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

export function ConsoleIcon({
  name,
  ...props
}: IconProps & { name: 'grid' | 'chart' | 'bot' | 'brain' | 'tasks' | 'arrow' | 'folder' | 'terminal' }) {
  switch (name) {
    case 'grid':
      return (
        <svg {...base(props)}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...base(props)}>
          <path d="M3 3v18h18" />
          <path d="M7 14l3-4 3 3 4-6" />
        </svg>
      );
    case 'bot':
      return (
        <svg {...base(props)}>
          <rect x="4" y="8" width="16" height="12" rx="2" />
          <path d="M12 4v4M9 14h.01M15 14h.01M9 17h6" />
        </svg>
      );
    case 'brain':
      return (
        <svg {...base(props)}>
          <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 2 4 3 3 0 0 0 5 1V5a3 3 0 0 0-3-1Z" />
          <path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-2 4 3 3 0 0 1-5 1" />
        </svg>
      );
    case 'tasks':
      return (
        <svg {...base(props)}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="m8 12 2.5 2.5L16 9" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...base(props)}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...base(props)}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3M12 15h5" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...base(props)}>
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
      );
  }
}
