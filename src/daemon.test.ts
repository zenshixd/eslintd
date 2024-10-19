import { test, before, after } from "node:test";
import net from "node:net";
import assert from "node:assert";
import { startDaemon } from "./daemon.js";
import { SOCKET_FILENAME } from "./singleton.js";
import path from "node:path";

let daemonStop: () => void;
before(async () => {
  process.argv.push("--debug");
  daemonStop = await startDaemon();
});

after(() => {
  console.log("stopping daemon");
  daemonStop();
});

test("should reformat code", async () => {
  return new Promise<void>((resolve) => {
    const socket = net.createConnection(
      {
        path: SOCKET_FILENAME,
      },
      () => {
        console.log("connected");
      },
    );

    socket.on("data", (data) => {
      const result = data.toString();
      console.log("data", result);
      assert.equal(result, 'console.log("hello");\0');
      socket.end();
      resolve();
    });

    const filepath = path.join(process.cwd(), "index.js");
    socket.write(
      process.cwd() + "\0" + filepath + "\0" + "console.log('hello');\n\0",
    );
  });
});
