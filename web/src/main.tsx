import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App.js";
import { IS_DEMO } from "./api.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {IS_DEMO ? (
      <HashRouter>
        <App />
      </HashRouter>
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </StrictMode>,
);
