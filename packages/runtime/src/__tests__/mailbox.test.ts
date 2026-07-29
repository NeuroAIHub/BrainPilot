import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mailbox, MailboxFullError, MAX_INBOX } from "../mailbox.js";

function msg(content: string, to = "principal") {
  return { fromAgent: "a", toAgent: to, content, msgType: "task_delegate" as const };
}

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

  describe("backpressure (#76)", () => {
    it("rejects a write past MAX_INBOX with MailboxFullError", async () => {
      const mb = new Mailbox("cap");
      for (let i = 0; i < MAX_INBOX; i++) await mb.write(msg(`m${i}`));
      expect(mb.count("principal")).toBe(MAX_INBOX);
      await expect(mb.write(msg("overflow"))).rejects.toBeInstanceOf(MailboxFullError);
      // The rejected message did not land.
      expect(mb.count("principal")).toBe(MAX_INBOX);
    });

    it("draining below the cap allows writes again", async () => {
      const mb = new Mailbox("cap2");
      for (let i = 0; i < MAX_INBOX; i++) await mb.write(msg(`m${i}`));
      await mb.read("principal"); // drain all
      await expect(mb.write(msg("now ok"))).resolves.toBeUndefined();
      expect(mb.count("principal")).toBe(1);
    });
  });

  describe("clearAll (#90 stop/interrupt)", () => {
    it("drains every inbox in-memory so no message re-wakes an agent", async () => {
      const mb = new Mailbox("clr");
      await mb.write(msg("to-pi", "principal"));
      await mb.write(msg("to-eng", "engineer"));
      await mb.write(msg("to-lib", "librarian"));
      expect(mb.count("principal")).toBe(1);
      expect(mb.count("engineer")).toBe(1);
      expect(mb.count("librarian")).toBe(1);

      await mb.clearAll();

      expect(mb.count("principal")).toBe(0);
      expect(mb.count("engineer")).toBe(0);
      expect(mb.count("librarian")).toBe(0);
      expect(await mb.read("engineer")).toHaveLength(0);
    });

    it("empties persisted inbox files on disk", async () => {
      const dir = await mkdtemp(join(tmpdir(), "bp-mb-clr-"));
      try {
        const mb = new Mailbox("clr2", dir);
        await mb.write(msg("m1", "engineer"));
        await mb.write(msg("m2", "engineer"));
        await mb.flush();
        expect(JSON.parse(await readFile(join(dir, "engineer.json"), "utf8"))).toHaveLength(2);

        await mb.clearAll();
        await mb.flush();
        expect(JSON.parse(await readFile(join(dir, "engineer.json"), "utf8"))).toHaveLength(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("readBatch (#76)", () => {
    it("takes at most maxMessages and preserves FIFO + remainder", async () => {
      const mb = new Mailbox("b1");
      for (const c of ["m1", "m2", "m3", "m4", "m5"]) await mb.write(msg(c));
      const first = await mb.readBatch("principal", 3, 1_000_000);
      expect(first.map((m) => m.content)).toEqual(["m1", "m2", "m3"]);
      const second = await mb.readBatch("principal", 3, 1_000_000);
      expect(second.map((m) => m.content)).toEqual(["m4", "m5"]);
      expect(mb.count("principal")).toBe(0);
    });

    it("stops at the char budget but always takes the first message", async () => {
      const mb = new Mailbox("b2");
      await mb.write(msg("a".repeat(100)));
      await mb.write(msg("b".repeat(100)));
      await mb.write(msg("c".repeat(100)));
      // Budget fits only ~1.5 messages → first two would exceed; take just one.
      const batch = await mb.readBatch("principal", 3, 150);
      expect(batch).toHaveLength(1);
      expect(batch[0]!.content).toBe("a".repeat(100));
      expect(mb.count("principal")).toBe(2);
    });

    it("ships an oversized first message alone rather than stranding it", async () => {
      const mb = new Mailbox("b3");
      await mb.write(msg("X".repeat(50_000))); // bigger than any sane budget
      await mb.write(msg("small"));
      const batch = await mb.readBatch("principal", 3, 24_000);
      expect(batch).toHaveLength(1);
      expect(batch[0]!.content.length).toBe(50_000);
      // The small one waits for the next turn (FIFO preserved).
      expect(mb.count("principal")).toBe(1);
    });

    it("does not mix task delegations from different senders", async () => {
      const mb = new Mailbox("b-senders");
      await mb.write({ fromAgent: "principal", toAgent: "engineer", content: "p1", msgType: "task_delegate" });
      await mb.write({ fromAgent: "principal", toAgent: "engineer", content: "p2", msgType: "task_delegate" });
      await mb.write({ fromAgent: "experimentalist", toAgent: "engineer", content: "e1", msgType: "task_delegate" });

      const first = await mb.readBatch("engineer", 3, 1_000_000);
      expect(first.map((m) => `${m.fromAgent}:${m.content}`)).toEqual([
        "principal:p1",
        "principal:p2",
      ]);
      const second = await mb.readBatch("engineer", 3, 1_000_000);
      expect(second.map((m) => `${m.fromAgent}:${m.content}`)).toEqual([
        "experimentalist:e1",
      ]);
    });

    it("does not mix a direct user task with an agent delegation", async () => {
      const mb = new Mailbox("b-user-sender");
      await mb.write({ fromAgent: "user", toAgent: "engineer", content: "u1", msgType: "user_message" });
      await mb.write({ fromAgent: "experimentalist", toAgent: "engineer", content: "e1", msgType: "task_delegate" });

      expect((await mb.readBatch("engineer")).map((m) => m.content)).toEqual(["u1"]);
      expect((await mb.readBatch("engineer")).map((m) => m.content)).toEqual(["e1"]);
    });

    it("keeps downstream results separate from a newly queued task", async () => {
      const mb = new Mailbox("b-result-then-task");
      await mb.write({ fromAgent: "engineer", toAgent: "experimentalist", content: "old result", msgType: "result_deliver" });
      await mb.write({ fromAgent: "principal", toAgent: "experimentalist", content: "new task", msgType: "task_delegate" });

      expect((await mb.readBatch("experimentalist")).map((m) => m.content)).toEqual(["old result"]);
      expect((await mb.readBatch("experimentalist")).map((m) => m.content)).toEqual(["new task"]);
    });

    it("keeps a new task separate from an older queued result", async () => {
      const mb = new Mailbox("b-task-then-result");
      await mb.write({ fromAgent: "principal", toAgent: "experimentalist", content: "new task", msgType: "task_delegate" });
      await mb.write({ fromAgent: "engineer", toAgent: "experimentalist", content: "old result", msgType: "result_deliver" });

      expect((await mb.readBatch("experimentalist")).map((m) => m.content)).toEqual(["new task"]);
      expect((await mb.readBatch("experimentalist")).map((m) => m.content)).toEqual(["old result"]);
    });

    it("returns empty for an empty inbox", async () => {
      const mb = new Mailbox("b4");
      expect(await mb.readBatch("principal")).toEqual([]);
    });
  });
});
