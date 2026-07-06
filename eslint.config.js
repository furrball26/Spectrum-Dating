import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Flat ESLint config (F14). The headline goal is enforcing the Rules of Hooks —
// specifically catching a hook placed after an early return, the class of bug
// that crashed ConversationScreen (React #310). `react-hooks/rules-of-hooks` is
// therefore an ERROR and gates CI; stylistic rules are softened to warnings so
// the existing, hand-maintained baseline stays green.
export default [
  {
    ignores: [
      "dist/**",
      // Any nested build output, not just the root dist/. Agent worktrees live
      // under .claude/worktrees/<id>/ and carry their own dist/ — without this
      // the root `npx eslint .` ship gate lints thousands of built lines that
      // aren't ours and fails. Covers .claude/** and any stray nested dist/.
      ".claude/**",
      "**/dist/**",
      "node_modules/**",
      "public/**",
      "scripts/**",
      "*.config.js",
      // Backend is its own project with its own flat config + lint script.
      // Root `eslint .` is frontend-only; lint the server via
      // `cd server && npm run lint` (or the server-ci workflow).
      "server/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // ── House rule, enforced ───────────────────────────────────────────────
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // ── Softened so the current baseline lints clean (warnings, not errors) ──
      "no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^_" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
