import { describe, it, expect } from "vitest";
import { PERSONAS, BUILTIN_PERSONA_NAMES, personaFor } from "../personas.js";

describe("personas", () => {
  const EXPECTED = ["principal", "librarian", "experimentalist", "engineer", "writer", "trace"];

  it("ships a curated persona for every built-in agent", () => {
    for (const name of EXPECTED) {
      expect(BUILTIN_PERSONA_NAMES).toContain(name);
      const p = PERSONAS[name];
      expect(p, name).toBeTruthy();
      // Not the old one-line placeholder.
      expect(p.length, name).toBeGreaterThan(200);
    }
  });

  it("uses BARE tool names — never the legacy mcp__builtin__ prefix", () => {
    for (const [name, p] of Object.entries(PERSONAS)) {
      expect(p, name).not.toContain("mcp__builtin__");
    }
  });

  it("does not reference legacy Docker mount paths", () => {
    for (const [name, p] of Object.entries(PERSONAS)) {
      expect(p, name).not.toContain("/workspace");
      expect(p, name).not.toContain("/root/.claude");
      expect(p, name).not.toContain("/shared");
    }
  });

  it("principal persona is delegation-oriented and names the experts", () => {
    const p = PERSONAS.principal!;
    expect(p).toContain("send_message");
    expect(p).toContain("librarian");
    expect(p).toContain("engineer");
    expect(p).toContain("writer");
    expect(p).toContain("experimentalist");
  });

  it("expert personas carry the send_message-back contract", () => {
    for (const name of ["librarian", "engineer", "experimentalist", "writer"]) {
      expect(PERSONAS[name], name).toContain('send_message(to="principal"');
    }
  });

  it("authoring experts mention their write/run capability", () => {
    expect(PERSONAS.engineer!).toContain("bash");
    expect(PERSONAS.writer!).toContain("write");
  });

  it("personaFor falls back to a generic expert persona for unknown agents", () => {
    const p = personaFor("statistician", "expert");
    expect(p).toContain("statistician");
    expect(p).toContain('send_message(to="principal"');
    expect(p).not.toContain("mcp__builtin__");
  });

  it("personaFor returns the curated persona when one exists", () => {
    expect(personaFor("engineer", "expert")).toBe(PERSONAS.engineer);
  });
});
