import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initialTheme } from "./lib/theme-store";
import "./index.css";

document.documentElement.dataset.theme = initialTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
