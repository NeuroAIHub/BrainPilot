import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mailbox } from "../mailbox.js";

describe("Mailbox", () => {
  it("round-trips a message and drains on read", async () => {
    const mb = new Mailbox("s1");
    await mb.write({ fromAgent: "librarian", toAgent: "principal", content: "hi", msgType: "result_deliver" });
    expect(mb.count("principal")).toBe(1);
    const msgs = await mb.read("principal");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("hi");
    // Drained.
    expect(mb.count("principal")).toBe(0);
    expect(await mb.read("principal")).toHaveLength(0);
  });

  it("persists to disk and recovers after a crash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bp-mb-"));
    try {
      const mb = new Mailbox("s2", dir);
      await mb.write({ fromAgent: "a", toAgent: "principal", content: "m1", msgType: "task_delegate" });
      await mb.write({ fromAgent: "a", toAgent: "principal", content: "m2", msgType: "task_delegate" });
      await mb.flush();

      // File exists on disk.
      const raw = await readFile(join(dir, "principal.json"), "utf8");
      expect(JSON.parse(raw)).toHaveLength(2);

      // A fresh Mailbox over the same dir recovers unread messages.
      const recovered = new Mailbox("s2", dir);
      await recovered.recover();
      expect(recovered.count("principal")).toBe(2);
      const msgs = await recovered.read("principal");
      expect(msgs.map((m) => m.content)).toEqual(["m1", "m2"]);

      // After draining, persisted file is emptied.
      await recovered.flush();
      const after = JSON.parse(await readFile(join(dir, "principal.json"), "utf8"));
      expect(after).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
