export default function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-44 -10 208 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ogBody" x1="0" y1="0" x2="120" y2="140" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF8C00" />
          <stop offset="100%" stopColor="#E06000" />
        </linearGradient>
        <linearGradient id="ogHighlight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      <g>
        <circle cx="60" cy="70" r="74" fill="white" className="drop-shadow" />

        <ellipse cx="60" cy="130" rx="36" ry="6" fill="rgba(0,0,0,0.08)" />

        <path
          d="
            M 60 16
            C 34 16 22 28 22 46
            C 22 62 18 86 16 104
            C 14 116 22 122 34 122
            C 42 122 48 118 60 118
            C 72 118 78 122 86 122
            C 98 122 106 116 104 104
            C 102 86 98 62 98 46
            C 98 28 86 16 60 16
            Z
          "
          fill="url(#ogBody)"
        />

        <path
          d="
            M 22 44
            C 14 36 6 26 6 18
            C 6 12 14 10 18 16
            C 22 22 28 32 26 44
            Z
          "
          fill="url(#ogBody)"
        />

        <path
          d="
            M 22 44
            C 14 36 6 26 6 18
            C 6 12 14 10 18 16
            C 22 22 28 32 26 44
            Z
          "
          fill="url(#ogHighlight)"
        />

        <path
          d="
            M 98 46
            C 98 40 106 34 110 36
            C 114 38 114 46 108 48
            C 104 50 98 50 98 46
            Z
          "
          fill="url(#ogBody)"
        />

        <rect x="46" y="34" width="8" height="13" rx="2.5" fill="white" />
        <rect x="66" y="34" width="8" height="13" rx="2.5" fill="white" />

        <rect x="47" y="35" width="3" height="5" rx="1" fill="rgba(0,0,0,0.1)" />

        <path
          d="M 40 58 Q 60 72 80 58"
          fill="none"
          stroke="white"
          strokeWidth="3.5"
          strokeLinecap="round"
        />

        <path
          d="M 36 22 Q 60 12 84 22"
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="4"
          strokeLinecap="round"
        />

        <path d="M 20 72 Q 14 68 8 76" fill="none" stroke="url(#ogBody)" strokeWidth="10" strokeLinecap="round" />
        <path d="M 100 72 Q 106 68 112 76" fill="none" stroke="url(#ogBody)" strokeWidth="10" strokeLinecap="round" />

        <circle cx="8" cy="76" r="5" fill="#E06000" />
        <circle cx="112" cy="76" r="5" fill="#E06000" />

        <line x1="8" y1="76" x2="-2" y2="14" stroke="#8B4513" strokeWidth="3" strokeLinecap="round" />
        <line x1="112" y1="76" x2="122" y2="14" stroke="#8B4513" strokeWidth="3" strokeLinecap="round" />

        <path d="M -2 16 L -40 28 L 6 60 Z" fill="#2563EB" />
        <path d="M 122 16 L 160 28 L 115 60 Z" fill="#DC2626" />

        <circle cx="-2" cy="14" r="2" fill="#8B4513" />
        <circle cx="122" cy="14" r="2" fill="#8B4513" />
      </g>
    </svg>
  );
}
