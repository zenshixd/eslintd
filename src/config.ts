import fs from "node:fs/promises";
import path from "node:path";

export async function resolveConfigFile(cwd: string) {
  const CONFIG_FILES = [
    ".eslintrc.ts",
    ".eslintrc.cts",
    ".eslintrc.mts",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.mjs",
    ".eslintrc.json",
    ".eslintrc.yaml",
    ".eslintrc.yml",
  ];

  let currentDir = cwd;
  while (currentDir != null) {
    for (const configFile of CONFIG_FILES) {
      const configPath = path.join(cwd, configFile);
      if (await fileExists(configPath)) {
        return configPath;
      }

      const packageJsonPath = path.join(currentDir, "package.json");
      if (await fileExists(packageJsonPath)) {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
        if (packageJson.eslintConfig) {
          return packageJsonPath;
        }
      }

      currentDir = path.dirname(currentDir);
    }
  }

  return null;
}

async function fileExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch (e) {
    return false;
  }
}
