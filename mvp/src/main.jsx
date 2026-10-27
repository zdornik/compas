import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";
import {contourVariant} from './visual-variant.js';

document.documentElement.dataset.contourVariant=contourVariant;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Production only. The service worker caches an explicit allowlist of public UI files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // App remains available online if installation/offline caching is unavailable.
    });
  });
}
