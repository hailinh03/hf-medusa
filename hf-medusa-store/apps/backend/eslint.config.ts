import { defineConfig } from "eslint/config"
import medusa from "@medusajs/eslint-plugin"

export default defineConfig([
  ...medusa.configs.recommended,
  {
    files: ["src/modules/**/models/**/*.{ts,js}"],
    rules: {
      "@medusajs/link-no-cross-module-relationship": "off",
    },
  },
])