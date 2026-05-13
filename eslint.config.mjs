const ignores = ["@girs/**", ".direnv/**", "node_modules/**"]

async function config() {
  try {
    const [{ default: js }, { default: tseslint }] = await Promise.all([
      import("@eslint/js"),
      import("typescript-eslint"),
    ])

    return tseslint.config(
      { ignores },
      js.configs.recommended,
      ...tseslint.configs.recommended,
      {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
          parserOptions: {
            project: "./tsconfig.json",
            tsconfigRootDir: import.meta.dirname,
          },
        },
        rules: {
          "@typescript-eslint/no-explicit-any": "error",
        },
      },
      {
        files: ["**/*.d.ts"],
        rules: {
          "@typescript-eslint/no-namespace": "off",
        },
      },
    )
  } catch {
    return [{ ignores: [...ignores, "**/*.{ts,tsx}"] }]
  }
}

export default await config()
