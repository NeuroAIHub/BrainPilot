import { describe, expect, it, vi } from "vitest";
import {
  installBrainPilotRetryClassifier,
  isTransientInvalidRequest400,
  PROVIDER_MAX_RETRIES,
  PROVIDER_RETRY_BASE_DELAY_MS,
} from "../pi-retry.js";

const production400 =
  '400: {"message":"The request is invalid: {\\"message\\":\\"invalid request error trace_id: 957c58f4b25567153aa3985bad9e3f72\\",\\"type\\":\\"invalid_request_error\\"}","type":"invalid_request_error","param":"","code":null}';

describe("BrainPilot provider retry policy (#365)", () => {
  it("uses five retries after the initial attempt", () => {
    expect(PROVIDER_MAX_RETRIES).toBe(5);
    expect(
      Array.from(
        { length: PROVIDER_MAX_RETRIES },
        (_, index) => PROVIDER_RETRY_BASE_DELAY_MS * 2 ** index,
      ),
    ).toEqual([2_000, 4_000, 8_000, 16_000, 32_000]);
  });

  it("recognizes the generic transient production 400", () => {
    expect(isTransientInvalidRequest400(production400)).toBe(true);
  });

  it("does not retry concrete validation or auth failures", () => {
    expect(
      isTransientInvalidRequest400(
        '400 {"type":"invalid_request_error","message":"invalid request error trace_id: abc","param":"model","code":"invalid_model"}',
      ),
    ).toBe(false);
    expect(isTransientInvalidRequest400('401 {"type":"authentication_error"}')).toBe(false);
    expect(isTransientInvalidRequest400('400 {"message":"model is required"}')).toBe(false);
  });

  it("extends Pi's classifier without changing its existing retry cases", () => {
    const original = vi.fn((message: { errorMessage?: string }) =>
      message.errorMessage?.includes("429") ?? false,
    );
    const session = { _isRetryableError: original };
    installBrainPilotRetryClassifier(session);

    expect(
      session._isRetryableError({ stopReason: "error", errorMessage: production400 }),
    ).toBe(true);
    expect(
      session._isRetryableError({ stopReason: "error", errorMessage: "429 rate limited" }),
    ).toBe(true);
    expect(
      session._isRetryableError({
        stopReason: "error",
        errorMessage: '400 {"param":"model","code":"invalid_model"}',
      }),
    ).toBe(false);
  });
});
