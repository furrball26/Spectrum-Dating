import { useState, useEffect } from "react";
const Q = { desktop: "(min-width: 1024px)", tablet: "(min-width:600px) and (max-width:1023px)" };
export function useViewport() {
  const get = () => window.matchMedia(Q.desktop).matches ? "desktop" : window.matchMedia(Q.tablet).matches ? "tablet" : "mobile";
  const [v, setV] = useState(get);
  useEffect(() => {
    const ms = Object.values(Q).map(q => window.matchMedia(q));
    const on = () => setV(get());
    ms.forEach(m => m.addEventListener("change", on));
    return () => ms.forEach(m => m.removeEventListener("change", on));
  }, []);
  return v; // "mobile" | "tablet" | "desktop"
}
