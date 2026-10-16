import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorApp } from "./editor/EditorApp";
import { Boot } from "./ui/Boot";
import "./ui/styles.css";
import "./editor/editor.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot>{(platform) => <EditorApp platform={platform} />}</Boot>
  </StrictMode>,
);
