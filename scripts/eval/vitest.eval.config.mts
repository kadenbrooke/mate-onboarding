// Live model evals. Never part of `npm test`: they call real providers and
// spend credit. Run one by hand, inside the amos secret helper, e.g.
//   node ~/kaden/amos/scripts/secrets/secret.mjs run -e ANTHROPIC_API_KEY -e GEMINI_API_KEY \
//     -e GEMINI_API_KEY_CARSON -e PORTKEY_GATEWAY_KEY -e OPENAI_API_KEY \
//     -- npx vitest run --config scripts/eval/vitest.eval.config.mts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "../../src") },
  },
  test: {
    environment: "node",
    include: ["scripts/eval/**/*.eval.ts"],
    testTimeout: 15 * 60 * 1000,
  },
});
