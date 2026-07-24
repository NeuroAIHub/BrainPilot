import { describe, it, expect } from "vitest";
import { SendMessageRequestSchema, UserInputResponseBodySchema } from "../http.js";

describe("SendMessageRequestSchema", () => {
  it("accepts a normal send-message body", () => {
    const r = SendMessageRequestSchema.safeParse({ content: "hello", agent: "principal" });
    expect(r.success).toBe(true);
  });

  it("accepts a user_input_response answer body", () => {
    const r = SendMessageRequestSchema.safeParse({
      type: "user_input_response",
      session_id: "s1",
      request_id: "req_123",
      answer: "option A",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty user_input_response answer", () => {
    expect(UserInputResponseBodySchema.safeParse({
      type: "user_input_response",
      session_id: "s1",
      request_id: "r1",
      answer: "   ",
    }).success).toBe(false);
  });

  it("rejects a body that is neither (no content, no answer)", () => {
    const r = SendMessageRequestSchema.safeParse({ foo: "bar" });
    expect(r.success).toBe(false);
  });
});
