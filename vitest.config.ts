import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    // Eksplisitt liste gjør at både frontend-, synk- og agenttestene kjøres
    // likt med `npm test` og `bun run test`.
    include: [
      "src/lib/**/*.test.ts",
      "src/components/**/*.test.tsx",
      "agent/**/*.test.mjs",
    ],
    globals: false,
    restoreMocks: true,
  },
});
