import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  {
    linterOptions: {
      // ESLint 9 flags `eslint-disable` comments that no longer suppress
      // anything. The repo has 8 of these left over from the Next 14 config.
      reportUnusedDisableDirectives: "off",
    },
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // The codebase predates the flat-config migration and uses `any` widely
      // in Supabase/JSON boundary code. Turning this into an error would bury
      // real findings under 380 pre-existing hits.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "off",
      // Next 16 ships the React Compiler-era hooks rules. The existing client
      // components were written against React 18 semantics.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "prefer-const": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    ".next-build/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);
