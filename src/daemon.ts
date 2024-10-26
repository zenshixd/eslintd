import { createRequire } from "node:module";
import type EslintModule from "eslint";
import { DaemonServer, Options } from "./server.js";
import { delayShutdown, stopShutdown } from "./shutdown.js";
import { killOtherDaemons, saveDaemonPid } from "./singleton.js";
import { log } from "./log.js";

export async function startDaemon() {
  await killOtherDaemons();

  const daemon = new DaemonServer(handler);
  await daemon.listen();

  await saveDaemonPid();

  return () => {
    stopShutdown();
    daemon.close();
  };
}

export async function handler(options: Options, data: string) {
  delayShutdown();
  if (!options.stdin || !options.stdinFilename) {
    return "Error: Input and filename are required";
  }

  log("handler: resolve");
  const [module, config] = await resolveEslintAndConfig(
    options.cwd,
    options.stdinFilename,
  );
  log("handler: lintText");
  const linter = new module.Linter({ cwd: options.cwd });

  if (options.fixToStdout) {
    log("handler: verifyAndFix");
    const result = linter.verifyAndFix(data, config, options.stdinFilename);
    return result.output;
  }

  try {
    log("handler: ESLint");
    const eslint = new module.ESLint({
      cwd: options.cwd,
      overrideConfig: config,
    });
    log("handler: lintText");
    const results = await eslint.lintText(data, {
      filePath: options.stdinFilename,
    });
    log("handler: loadFormatter");
    const formatter = await eslint.loadFormatter(options.format);
    const output = await formatter.format(results);
    log("handler: format");
    return output;
  } catch (e) {
    if (e instanceof Error) {
      return "Error: " + e.name + ": " + e.message;
    }

    throw e;
  }
}

const require = createRequire(import.meta.url);
let eslintInstance: typeof EslintModule | undefined = undefined;
const linterInstanceCache = new Map<string, [typeof EslintModule, any]>();

async function resolveEslintAndConfig(
  cwd: string,
  filepath: string,
): Promise<[typeof EslintModule, any]> {
  if (linterInstanceCache.has(cwd)) {
    return linterInstanceCache.get(cwd)!;
  }

  const eslintPath = require.resolve("eslint", { paths: [cwd] });
  const eslintModule: typeof EslintModule = require(eslintPath);
  if (eslintInstance != eslintModule) {
    eslintInstance = eslintModule;
    linterInstanceCache.clear();
  }

  const eslint = new eslintModule.ESLint({
    cwd,
    baseConfig: eslintModule.ESLint.defaultConfig,
  });
  const config = await eslint.calculateConfigForFile(filepath);
  linterInstanceCache.set(cwd, [eslintModule, config]);
  return [eslintModule, config];
}
