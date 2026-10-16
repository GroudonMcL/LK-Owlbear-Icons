import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PopoverApp } from "./popover/PopoverApp";
import { Boot } from "./ui/Boot";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot>{(platform) => <PopoverApp platform={platform} />}</Boot>
  </StrictMode>,
);
