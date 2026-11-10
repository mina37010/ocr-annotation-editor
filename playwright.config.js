import { defineConfig } from "@playwright/test";
export default defineConfig({
    testDir: "./e2e",
    timeout: 30000,
    fullyParallel: false,
    use: {
        baseURL: "http://127.0.0.1:5174",
        viewport: { width: 1440, height: 900 },
        headless: true,
        launchOptions: {
            executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        },
    },
    webServer: {
        command: "npm run dev -- --host 127.0.0.1",
        url: "http://127.0.0.1:5174",
        reuseExistingServer: true,
    },
});
