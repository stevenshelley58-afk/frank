import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

// Stylesheets of the vanilla modules the shell hosts as-is (native panel host,
// Ads workspace) plus the generated token aliases they read. They are served by
// the Window host from web/, and they are appended here, after the bundle's own
// stylesheet, so Tailwind's preflight does not reset the markup they style.
for (const href of ["/tokens.css", "/owner-dashboard.css", "/ads.css", "/ads-controls.css"]) {
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = href
  document.head.appendChild(link)
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
)
