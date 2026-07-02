import { useState } from "react";
import { t } from "./tokens.js";

// Shared keyboard-focus ring (F15 — was copy-pasted in ~15 files).
// Spread the returned handlers + style onto any interactive element:
//   const f = useFocusable();
//   <button style={{ ...base, ...f.style }} onFocus={f.onFocus} onBlur={f.onBlur}>
export const focusRing = { outline: `2px solid ${t.focus}`, outlineOffset: "2px" };

export function useFocusable() {
  const [focused, setFocused] = useState(false);
  return {
    style: focused ? focusRing : { outline: "none" },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
