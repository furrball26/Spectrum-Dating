import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// Stale-deploy recovery: each Vercel deployment purges the previous build's
// hashed assets, so a client that kept an old tab open (or raced a deploy)
// 404s when it lazy-loads a chunk → blank screen. Vite emits
// `vite:preloadError` for exactly this; reload once to pick up the fresh
// build. The timestamp guard allows at most one recovery reload per 30s so a
// genuinely broken deploy can't cause a reload loop.
window.addEventListener("vite:preloadError", (event) => {
  const last = Number(sessionStorage.getItem("spectrum_chunk_reload") || 0);
  if (Date.now() - last < 30000) return; // recently tried — don't loop
  sessionStorage.setItem("spectrum_chunk_reload", String(Date.now()));
  event.preventDefault();
  // Cache-busting navigation (not location.reload()): iOS Safari can serve the
  // stale cached HTML on a programmatic reload, which would just 404 again.
  const url = new URL(window.location.href);
  url.searchParams.set("v", String(Date.now()));
  window.location.replace(url.toString());
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
