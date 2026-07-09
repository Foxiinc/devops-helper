import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme } from "./theme/applyTheme";
import { loadUiState } from "./state/persist";
import { DEFAULT_THEME_SETTINGS } from "./theme/types";

applyTheme(loadUiState().theme ?? DEFAULT_THEME_SETTINGS);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
