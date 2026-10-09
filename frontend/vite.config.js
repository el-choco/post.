import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const sourceHash = createHash("sha256");
for (const file of [
  "src/pages/Mailbox.jsx",
  "src/components/MessageBody.jsx",
  "src/components/MessageAttachments.jsx",
  "src/components/SettingsPage.jsx",
  "src/components/Contacts.jsx",
  "src/index.css",
]) {
  sourceHash.update(file).update(readFileSync(new URL(file, import.meta.url)));
}
const buildInfo = {
  version,
  buildId: sourceHash.digest("hex").slice(0, 16),
  builtAt: new Date().toISOString(),
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "post-build-info",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify(buildInfo, null, 2),
        });
      },
    },
  ],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    host: "127.0.0.1",
    proxy: { "/api": process.env.WEBMAIL_BACKEND || "http://127.0.0.1:3000" },
  },
});
