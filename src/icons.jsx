// Small, consistent inline-SVG icons for Spectrum Dating.
// All icons: 1.5px stroke, inherit color via `currentColor`, accept a `size`
// prop (default 18). Light "duotone" feel via a subtle currentColor fill at
// low opacity where it reads well. Decorative by default (aria-hidden) — pair
// with an accessible label on the surrounding control.

function Svg({ size = 18, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ShieldIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <path
        d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
        fill="currentColor"
        fillOpacity={0.12}
      />
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

export function LockIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="currentColor" fillOpacity={0.12} />
      <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function GearIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="12" cy="12" r="3.2" fill="currentColor" fillOpacity={0.12} />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3" />
    </Svg>
  );
}

export function HeartIcon({ size = 18, ...rest }) {
  return (
    <Svg size={size} {...rest}>
      <path
        d="M12 20s-7-4.4-9.2-8.6C1.3 8.7 2.6 5.5 5.7 5.1c1.9-.2 3.4.9 4.3 2.2.9-1.3 2.4-2.4 4.3-2.2 3.1.4 4.4 3.6 2.9 6.3C19 15.6 12 20 12 20z"
        fill="currentColor"
        fillOpacity={0.12}
      />
      <path d="M12 20s-7-4.4-9.2-8.6C1.3 8.7 2.6 5.5 5.7 5.1c1.9-.2 3.4.9 4.3 2.2.9-1.3 2.4-2.4 4.3-2.2 3.1.4 4.4 3.6 2.9 6.3C19 15.6 12 20 12 20z" />
    </Svg>
  );
}

export function SealCheckIcon({ size = 18, ...rest }) {
  // A scalloped "seal" with a checkmark — for the Verified pill.
  return (
    <Svg size={size} {...rest}>
      <path
        d="M12 2.6l2.1 1.5 2.6-.3 1.1 2.4 2.4 1.1-.3 2.6 1.5 2.1-1.5 2.1.3 2.6-2.4 1.1-1.1 2.4-2.6-.3L12 21.4l-2.1-1.5-2.6.3-1.1-2.4-2.4-1.1.3-2.6L2.6 12l1.5-2.1-.3-2.6 2.4-1.1 1.1-2.4 2.6.3L12 2.6z"
        fill="currentColor"
        fillOpacity={0.12}
      />
      <path d="M12 2.6l2.1 1.5 2.6-.3 1.1 2.4 2.4 1.1-.3 2.6 1.5 2.1-1.5 2.1.3 2.6-2.4 1.1-1.1 2.4-2.6-.3L12 21.4l-2.1-1.5-2.6.3-1.1-2.4-2.4-1.1.3-2.6L2.6 12l1.5-2.1-.3-2.6 2.4-1.1 1.1-2.4 2.6.3L12 2.6z" />
      <path d="M8.5 12l2.3 2.3 4.7-4.6" />
    </Svg>
  );
}
