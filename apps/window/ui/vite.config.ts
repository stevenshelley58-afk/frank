import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // The bundle is copied to /web/ui inside the Frank image and served at
  // /ui/<asset>, while the page itself is served at the root owner routes
  // (/, /project/blockwise/...). An absolute base keeps every asset URL
  // pointing at /ui/assets/ whatever path the document was requested from.
  base: "/ui/",
  plugins: [react(), tailwindcss()],
  server: {
    // The dev server must be allowed to read the vanilla modules beside ui/.
    fs: { allow: [".", path.resolve(__dirname, "../web")] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The vanilla Window modules the shell reuses as-is: the owner route
      // grammar, the native application panel host and the Ads workspace.
      // One source for each; the shell does not carry a copy.
      "@legacy": path.resolve(__dirname, "../web/js"),
    },
  },
})
