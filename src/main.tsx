import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./board.css";
import "./styles.css";
import { applyBoardLook } from "./boardSettings";

applyBoardLook();

createRoot(document.getElementById("root")!).render(<App />);
