/** Inline SVG icon set — stroke icons, currentColor, RTL-aware via .dir-flip. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: P): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...rest,
  };
}

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconHeart = (p: P & { filled?: boolean }) => {
  const { filled, ...rest } = p;
  return (
    <svg {...base(rest)} fill={filled ? "currentColor" : "none"}>
      <path d="M12 20.5C7 16.5 3.5 13.4 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3.1.8 4 2.1C12.9 5.8 14.4 5 16 5c2.5 0 4.5 2 4.5 4.6 0 3.8-3.5 6.9-8.5 10.9Z" />
    </svg>
  );
};

export const IconUser = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20c1.6-3.2 4.3-5 7.5-5s5.9 1.8 7.5 5" />
  </svg>
);

export const IconBag = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 8h14l-1 12.5H6L5 8Z" />
    <path d="M8.5 10V6.5a3.5 3.5 0 0 1 7 0V10" />
  </svg>
);

export const IconMenu = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconChevronDown = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconArrow = (p: P) => (
  <svg {...base(p)} className={`dir-flip ${p.className ?? ""}`}>
    <path d="M4 12h16m-6-6 6 6-6 6" />
  </svg>
);

export const IconStar = (p: P & { filled?: boolean }) => {
  const { filled = true, ...rest } = p;
  return (
    <svg {...base({ size: rest.size ?? 16, ...rest })} fill={filled ? "currentColor" : "none"}>
      <path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3Z" />
    </svg>
  );
};

export const IconWhatsApp = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 2.5A9.4 9.4 0 0 0 2.6 11.9c0 1.7.4 3.3 1.2 4.7L2.5 21.5l5-1.3a9.4 9.4 0 0 0 4.5 1.1 9.4 9.4 0 0 0 9.4-9.4A9.4 9.4 0 0 0 12 2.5Zm0 17.1c-1.4 0-2.8-.4-4-1l-.3-.2-3 .8.8-2.9-.2-.3a7.7 7.7 0 1 1 6.7 3.6Zm4.2-5.8c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.3 6.3 0 0 1-3.1-2.7c-.2-.4 0-.5.2-.7l.5-.6c.1-.2.1-.3 0-.5l-.7-1.8c-.2-.4-.4-.4-.5-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9.6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1 0-.1-.2-.2-.4-.3Z" />
  </svg>
);

export const IconInstagram = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconMinus = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V5h6v2m-8.5 0 .8 13h9.4l.8-13" />
  </svg>
);

export const IconGlobe = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5s1.3-6.2 3.8-8.5Z" />
  </svg>
);

export const IconCrown = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="m4.5 16.5-1.2-8 4.4 3.2L12 6l4.3 5.7 4.4-3.2-1.2 8H4.5Zm0 1.6h15v1.9h-15v-1.9Z" />
  </svg>
);

export const IconTruck = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.5v3h-7" />
    <circle cx="6.5" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </svg>
);

export const IconShield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 5 5.8v5.4c0 4.3 2.9 7.7 7 9.3 4.1-1.6 7-5 7-9.3V5.8L12 3Z" />
    <path d="m9 11.7 2.2 2.2L15.5 9.5" />
  </svg>
);

export const IconRuler = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="9" width="19" height="6.5" rx="1.5" />
    <path d="M6.5 9v3M10.5 9v2M14.5 9v3M18.5 9v2" />
  </svg>
);
