import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/utilities.css";
import "./styles/pages.css";
import { App } from "./App.tsx";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element missing");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
