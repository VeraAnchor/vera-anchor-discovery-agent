import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

const root = document.getElementById("root");

if (!root) {
  throw new Error("ROOT_ELEMENT_NOT_FOUND");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);