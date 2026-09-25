// ESLint flat configuration. `npm run lint` fails on any error; see
// scripts/lint.mjs for the warning budget, which may only go down.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      ".e2e/**",
      ".tools/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Unused values are allowed only when deliberately marked with "_".
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
      // A variable read by a closure before its single assignment stays `let`.
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Findings of these rule families predate the linter. They are
      // warnings under a budget that may only go down (scripts/lint.mjs):
      // fix them when touching the code, never add new ones.
      ...Object.fromEntries(
        Object.entries({
          ...reactHooks.configs.recommended.rules,
          ...jsxA11y.flatConfigs.recommended.rules,
        })
          .filter(([, level]) => ![0, "off"].includes([level].flat()[0]))
          .map(([rule, level]) => [
            rule,
            Array.isArray(level) ? ["warn", ...level.slice(1)] : "warn",
          ]),
      ),
    },
  },
  {
    // Tests exercise untyped HTTP responses.
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
