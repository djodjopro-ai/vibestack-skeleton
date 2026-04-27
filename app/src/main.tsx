import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import { ThemeProvider } from "./lib/theme";
import "./styles.css";

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const isPreview = import.meta.env.VITE_PREVIEW_MODE === "true";

function Root() {
  if (isPreview || !clerkKey) {
    return <App />;
  }
  return (
    <ClerkProvider publishableKey={clerkKey}>
      <App />
    </ClerkProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </React.StrictMode>,
);
