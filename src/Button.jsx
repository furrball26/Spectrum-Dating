import { useState } from "react";
import { t } from "./tokens.js";

// Reusable button with a light, calm hierarchy. Three variants:
//  - primary:   solid accentStrong, white text (the main action)
//  - secondary: filled green100 with accentStrong text + 1px border
//  - tertiary:  transparent, accentStrong text (low-emphasis action)
// 44px min height, visible focus ring, 150ms transition. Accepts `style` so
// callers control width — it is NOT forced full-width.

const VARIANTS = {
  primary: {
    background: t.accentStrong,
    color: "#fff",
    border: `1px solid ${t.accentStrong}`,
  },
  secondary: {
    background: t.green100,
    color: t.accentStrong,
    border: `1px solid ${t.border}`,
  },
  tertiary: {
    background: "transparent",
    color: t.accentStrong,
    border: "1px solid transparent",
  },
};

export default function Button({ variant = "primary", children, style, disabled, ...props }) {
  const [focused, setFocused] = useState(false);
  const variantStyle = VARIANTS[variant] || VARIANTS.primary;

  return (
    <button
      type="button"
      disabled={disabled}
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      style={{
        minHeight: 44,
        padding: "10px 18px",
        borderRadius: 11,
        fontSize: 15,
        fontWeight: 600,
        fontFamily: t.sans,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: `background ${t.motion.base} ${t.motion.standard}, color ${t.motion.base} ${t.motion.standard}, border-color ${t.motion.base} ${t.motion.standard}`,
        ...variantStyle,
        ...(focused
          ? { outline: `2px solid ${t.focus}`, outlineOffset: "2px" }
          : { outline: "none" }),
        ...style,
      }}
    >
      {children}
    </button>
  );
}
