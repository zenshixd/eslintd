import net from "node:net";
import { SOCKET_FILENAME } from "./singleton.js";
import { log, resetTime } from "./log.js";

export const HEADER_SEP = "\n\n";
export const END_MARKER = "\0";

export type Options = {
  cwd: string;
  stdin: boolean;
  stdinFilename: string;
  fix: boolean;
  fixDryRun: boolean;
  fixToStdout: boolean;
  format: string;
  ignorePath: string;
  ignorePattern: string;
  noIgnore: boolean;
};

export type Handler = (options: Options, data: string) => Promise<string>;
export type Parser =
  | {
      headerParsed: true;
      options: Options;
      data: string;
    }
  | {
      headerParsed: false;
      options: undefined;
      data: string;
    };

export class DaemonServer {
  server: net.Server;

  constructor(public handler: Handler) {
    this.server = net.createServer();
  }

  async listen() {
    this.server = net.createServer().listen(SOCKET_FILENAME, async () => {
      return log(`Listening at ${SOCKET_FILENAME}`);
    });

    this.server.on("connection", (socket) => this.newConnection(socket));
  }

  close() {
    this.server.close();
  }

  newConnection(socket: net.Socket) {
    resetTime();
    let parserData: Parser = {
      headerParsed: false,
      options: undefined,
      data: "",
    };
    log("handler: new");

    socket.on("data", async (buffer) => {
      const chunk = buffer.toString();
      log("handler: data", chunk.length, chunk);
      parserData.data += chunk;

      if (!parserData.headerParsed) {
        log("handler: parsingHeader");
        const headerIndex = parserData.data.indexOf(HEADER_SEP);
        if (headerIndex == -1) {
          return;
        }

        log("handler: parsingHeader: headerIndex", headerIndex);
        const options = this.parseOptions(
          parserData.data.slice(0, headerIndex),
        );
        parserData = {
          headerParsed: true,
          options,
          data: parserData.data.slice(headerIndex + HEADER_SEP.length),
        };
        log("handler: parsingHeader: done");
      }

      if (parserData.headerParsed && parserData.data.endsWith(END_MARKER)) {
        log(
          "handler: parsingDone, options=",
          parserData.options,
          "data=",
          parserData.data,
        );
        const result = await this.handler(
          parserData.options,
          parserData.data.slice(0, -END_MARKER.length),
        );

        socket.write(result + END_MARKER);
        socket.end();

        parserData = {
          headerParsed: false,
          options: undefined,
          data: "",
        };
      }
    });
  }

  parseOptions(data: string) {
    log("parseOptions");
    const options: Map<string, string> = new Map();
    const lines = data.split("\n");
    for (const line of lines) {
      const [key, value] = line.split("=");
      options.set(key, value);
    }
    log("parseOptions: options", options);

    const result: Options = {
      cwd: options.get("cwd")!,
      stdin: options.get("stdin") == "1",
      stdinFilename: options.get("stdin-filename")!,
      fix: options.get("fix") == "1",
      fixDryRun: options.get("fix-dry-run") == "1",
      fixToStdout: options.get("fix-to-stdout") == "1",
      format: options.get("format")!,
      ignorePath: options.get("ignore-path")!,
      ignorePattern: options.get("ignore-pattern")!,
      noIgnore: options.get("no-ignore") == "1",
    };
    log("parseOptions: done");

    return result;
  }
}
