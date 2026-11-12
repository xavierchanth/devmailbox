import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyAppearance, readAppearance } from "./lib/appearance.ts";
import "./styles/app.css";

applyAppearance(readAppearance());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
