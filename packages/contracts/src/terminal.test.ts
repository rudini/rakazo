import { describe, expect, it } from "vitest";
import { type ComputerCommand, foldComputerCommands } from "./events.js";
import { encodeTerminalInput, encodeTerminalResize } from "./terminal.js";

describe("terminal framing", () => {
  it("prefixes input with its kind and byte length", () => {
    expect([...encodeTerminalInput("é")]).toEqual([0, 0, 0, 0, 2, 0xc3, 0xa9]);
  });

  it("clamps resize dimensions", () => {
    expect([...encodeTerminalResize(0, 5000)]).toEqual([1, 0, 0, 0, 4, 0, 1, 0x03, 0xe8]);
  });
});

describe("computer command history", () => {
  const command = (executionId: string, status: ComputerCommand["status"]): ComputerCommand => ({
    executionId,
    command: `echo ${executionId}`,
    cwd: ".",
    status,
    exitCode: status === "done" ? 0 : null,
    output: "",
  });

  it("keeps one entry per command in start order with its latest state", () => {
    expect(
      foldComputerCommands([
        command("a", "running"),
        command("b", "running"),
        command("b", "done"),
        command("a", "done"),
      ]).map((entry) => `${entry.executionId}:${entry.status}`),
    ).toEqual(["a:done", "b:done"]);
  });

  it("never lets a stale running event reopen a finished command", () => {
    expect(
      foldComputerCommands([command("a", "done"), command("a", "running")]).map(
        (entry) => entry.status,
      ),
    ).toEqual(["done"]);
  });
});
