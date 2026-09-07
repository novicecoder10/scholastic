import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored pdf.js worker, copied in by scripts/copy-pdf-worker.mjs. Not
    // our source, and minified — linting it produces ~1500 findings.
    "public/pdf.worker.min.mjs",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
