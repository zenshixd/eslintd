import net from "node:net";
import { createRequire } from "node:module";
import type EslintModule from "eslint";
import { delayShutdown, stopShutdown } from "./shutdown.js";
import {
  saveDaemonPid,
  killOtherDaemons,
  SOCKET_FILENAME,
} from "./singleton.js";
import { log, resetTime } from "./log.js";

export async function startDaemon() {
  await killOtherDaemons();
  const server = net.createServer().listen(SOCKET_FILENAME, async () => {
    await saveDaemonPid();
    return log(`Listening at ${SOCKET_FILENAME}`);
  });

  server.on("connection", handler);

  return () => {
    stopShutdown();
    server.close();
  };
}

enum Field {
  Cwd = "cwd",
  Filepath = "filepath",
  Input = "input",
}
const FIELDS = Object.values(Field);

const END_MARKER = "\0";
function handler(socket: net.Socket) {
  resetTime();
  delayShutdown();
  log("handler: new");
  let parsingField = 0;
  let state: Record<Field, string> = {
    cwd: "",
    filepath: "",
    input: "",
  };

  const parseString = (fieldIndex: number, data: string): boolean => {
    const endMarkerIndex = data.indexOf(END_MARKER);
    if (endMarkerIndex == -1) {
      state[FIELDS[fieldIndex]] += data;
      return false;
    }

    state[FIELDS[fieldIndex]] += data.slice(0, endMarkerIndex);

    if (fieldIndex + 1 < FIELDS.length) {
      parsingField = fieldIndex + 1;
      return parseString(
        parsingField,
        data.slice(endMarkerIndex + END_MARKER.length),
      );
    }

    return true;
  };

  socket.on("data", async (data) => {
    log("handler: data", data.toString().length, data.toString());

    let doneParsing = parseString(parsingField, data.toString());

    if (doneParsing) {
      log("handler: done parsing", state);
      const eslint = await resolveEslint(state.cwd);

      log("handler: linting", state.filepath);
      const result = await eslint.lintText(state.input, {
        filePath: state.filepath,
      });

      log("handler: formatting");
      const formatter = await eslint.loadFormatter();

      socket.write(await formatter.format(result));
      socket.end();
      log("handler: done");

      parsingField = 0;
      state = {
        cwd: "",
        filepath: "",
        input: "",
      };
    }
  });
}

const require = createRequire(import.meta.url);
let eslintInstance: typeof EslintModule | undefined = undefined;
const linterInstanceCache = new Map<string, EslintModule.ESLint>();

async function resolveEslint(cwd: string): Promise<EslintModule.ESLint> {
  log("resolveEslint");
  if (linterInstanceCache.has(cwd)) {
    log("resolveEslint: cache hit");
    return linterInstanceCache.get(cwd)!;
  }

  log("resolveEslint: cache miss");
  const eslintPath = require.resolve("eslint", { paths: [cwd] });
  log("resolveEslint: resolved to", eslintPath);
  const eslintModule: typeof EslintModule = require(eslintPath);
  if (eslintInstance != eslintModule) {
    log("resolveEslint: cache busted! eslintInstance changed");
    eslintInstance = eslintModule;
    linterInstanceCache.clear();
  }
  log("resolveEslint: resolving ESLint");

  const eslint = new eslintModule.ESLint({
    cwd,
    baseConfig: eslintModule.ESLint.defaultConfig,
  });
  linterInstanceCache.set(cwd, eslint);
  log("resolveEslint: resolved");
  return eslint;
}
