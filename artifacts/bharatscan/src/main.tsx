import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { LoginGate } from "./components/LoginGate.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <LoginGate>
      <App />
    </LoginGate>
  </ErrorBoundary>
);
