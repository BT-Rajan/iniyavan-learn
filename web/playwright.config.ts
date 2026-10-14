import { defineConfig } from "@playwright/test";

// End-to-end: a fresh database with the demo school, the API on :8100 and the web app on :5180.
const db = "/tmp/iniyavan-e2e.db";
const env = `DATABASE_URL=sqlite:///${db} SECRET_KEY=e2e-secret-key-e2e-secret-key-e2e-secret UPLOAD_DIR=/tmp/iniyavan-e2e-uploads`;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:5180",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: `cd ../api && rm -f ${db} && ${env} alembic upgrade head && ${env} python -m app.cli demo && ${env} uvicorn app.main:app --port 8100`,
      url: "http://127.0.0.1:8100/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    { command: "API_URL=http://127.0.0.1:8100 npx vite --port 5180 --strictPort", url: "http://localhost:5180", reuseExistingServer: false },
  ],
});
