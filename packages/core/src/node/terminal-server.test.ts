import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeTerminalInput, encodeTerminalResize } from "@rakazo/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { TERMINAL_SERVER_PROGRAM } from "./terminal-server.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const step of cleanup.splice(0)) step();
});

async function startServer() {
  const root = mkdtempSync(path.join(tmpdir(), "terminal-server-"));
  const program = path.join(root, "server.py");
  const socket = path.join(root, "pty.sock");
  writeFileSync(program, TERMINAL_SERVER_PROGRAM);
  const server: ChildProcess = spawn("python3", [program, socket, root], {
    env: { PATH: process.env.PATH, HOME: root, SHELL: "/bin/sh" },
    stdio: "ignore",
  });
  cleanup.push(() => {
    server.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !existsSync(socket); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { root, socket };
}

function connect(socket: string) {
  const client = net.createConnection(socket);
  cleanup.push(() => client.destroy());
  let output = "";
  client.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  const waitFor = async (pattern: RegExp) => {
    for (let i = 0; i < 250; i += 1) {
      if (pattern.test(output)) return output;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`terminal output did not match ${pattern}: ${output}`);
  };
  return { client, waitFor };
}

describe("terminal server", () => {
  it("runs a shell in the workspace and applies resize frames", async () => {
    const { root, socket } = await startServer();
    const { client, waitFor } = connect(socket);
    client.write(encodeTerminalResize(123, 45));
    // Split one frame across writes: framing must survive arbitrary stream chunking.
    const frame = encodeTerminalInput("pwd; stty size; echo done-$((20 + 22))\n");
    client.write(frame.subarray(0, 3));
    client.write(frame.subarray(3));
    const output = await waitFor(/done-42/);
    expect(output).toContain(root);
    expect(output).toContain("45 123");
  });

  it("gives each connection its own shell", async () => {
    const { socket } = await startServer();
    const first = connect(socket);
    const second = connect(socket);
    first.client.write(encodeTerminalInput("export MARK=first; echo set-$MARK\n"));
    await first.waitFor(/set-first/);
    second.client.write(encodeTerminalInput("echo other-$MARK-end\n"));
    await expect(second.waitFor(/other--end/)).resolves.toContain("other--end");
  });
});
