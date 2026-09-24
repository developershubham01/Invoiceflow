import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript: allow explicit any where needed (legacy codebase) but warn on unused vars
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",

    // React
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react-compiler/react-compiler": "off",

    // Next.js
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    // General: keep important safety rules active
    "no-debugger": "warn",
    "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    "prefer-const": "warn",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "electron/**", "tests/**"]
}];

export default eslintConfig;
