import type { ComputerCommand, ProductEvent } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  formatComputerCommand,
  formatSize,
  mergeComputerCommand,
  parentPath,
  publishComputerCommand,
  sortEntries,
  subscribeComputerCommands,
  terminalSocketUrl,
} from "./computer-workspace";

const command = (overrides: Partial<ComputerCommand> = {}): ComputerCommand => ({
  executionId: "call-1",
  command: "ls",
  cwd: "bots/bot-1",
  status: "done",
  exitCode: 0,
  output: "a\nb\n",
  ...overrides,
});

describe("computer terminal feed", () => {
  it("renders a prompt line, output, and only failing exit codes", () => {
    expect(formatComputerCommand(command())).toBe("\x1b[1m$ ls\x1b[0m\r\na\r\nb\r\n");
    expect(formatComputerCommand(command({ exitCode: 2, output: "" }))).toBe(
      "\x1b[1m$ ls\x1b[0m\r\n\x1b[2m[exit 2]\x1b[0m\r\n",
    );
  });

  it("replaces a running command with its result in place", () => {
    const started = [
      command({ status: "running", exitCode: null, output: "" }),
      command({ executionId: "call-2" }),
    ];
    expect(mergeComputerCommand(started, command()).map((entry) => entry.status)).toEqual([
      "done",
      "done",
    ]);
  });

  it("forwards only valid command events to subscribers", () => {
    const received: Array<[string, ComputerCommand]> = [];
    const unsubscribe = subscribeComputerCommands((botId, entry) => received.push([botId, entry]));
    const event = (type: string, payload: Record<string, unknown>) =>
      ({ type, botId: "bot-1", payload }) as unknown as ProductEvent;
    publishComputerCommand(event("computer.command", command()));
    publishComputerCommand(event("computer.command", { command: "ls" }));
    publishComputerCommand(event("agent.tool.called", command()));
    unsubscribe();
    publishComputerCommand(event("computer.command", command()));
    expect(received).toEqual([["bot-1", command()]]);
  });

  it("derives the terminal socket from the sealed capability directory", () => {
    expect(
      terminalSocketUrl(
        "/novnc/session/control/123.abc/vnc.html?path=novnc%2Fsession%2Fcontrol%2F123.abc%2Fwebsockify",
        "https://rakazo.example/chat",
      ),
    ).toBe("wss://rakazo.example/novnc/session/control/123.abc/websockify");
    expect(terminalSocketUrl("fake://terminal/computer-1", "http://localhost:5173/")).toBeNull();
  });
});

describe("computer files", () => {
  it("lists folders first, then names alphabetically", () => {
    expect(
      sortEntries([
        { path: "notes/b.txt", kind: "file", size: 1 },
        { path: "notes/z", kind: "dir", size: 0 },
        { path: "notes/a.txt", kind: "file", size: 1 },
      ]).map((entry) => entry.path),
    ).toEqual(["notes/z", "notes/a.txt", "notes/b.txt"]);
  });

  it("navigates up to the bot home", () => {
    expect(parentPath("notes/drafts")).toBe("notes");
    expect(parentPath("notes")).toBe("");
  });

  it("formats sizes compactly", () => {
    expect([formatSize(512), formatSize(2048), formatSize(3 * 1024 * 1024)]).toEqual([
      "512 B",
      "2.0 KB",
      "3.0 MB",
    ]);
  });
});
