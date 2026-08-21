import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTurnTimer, type TurnTiming } from "../contexts/useTurnTimer";

type HarnessProps = Parameters<typeof useTurnTimer>[0] & {
  capture: (timing: TurnTiming) => void;
};

function Harness({ capture, ...options }: HarnessProps) {
  capture(useTurnTimer(options));
  return null;
}

const storage = new Map<string, string>();
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

beforeEach(() => {
  storage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T00:00:00.000Z"));
  const sessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size; },
  } satisfies Storage;
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: sessionStorage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
});

afterEach(() => {
  vi.useRealTimers();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete (globalThis as { window?: unknown }).window;
  if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

describe("useTurnTimer session lifecycle (#489)", () => {
  it("does not persist session A timing under an empty session B key", () => {
    storage.set("brainpilot:turn-timing:A", JSON.stringify({
      turnId: "run-a",
      durationMs: 4_200,
      status: "completed",
    }));
    let timing: TurnTiming | null = null;
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(<Harness capture={(value) => { timing = value; }} resetKey="A" runActive={null} />);
    });
    expect(timing).toMatchObject({ turnId: "run-a", elapsedMs: 4_200, status: "completed" });

    act(() => {
      renderer.update(<Harness capture={(value) => { timing = value; }} resetKey="B" runActive={null} />);
    });
    expect(storage.has("brainpilot:turn-timing:B")).toBe(false);
    expect(timing).toMatchObject({ turnId: null, elapsedMs: null, status: null });
    act(() => renderer.unmount());
  });

  it("records ask_user Stop as interrupted, then a rapid resumed run as completed", () => {
    const base = Date.now();
    let timing: TurnTiming | null = null;
    let renderer!: ReactTestRenderer;
    const capture = (value: TurnTiming) => { timing = value; };

    act(() => {
      renderer = create(
        <Harness
          capture={capture}
          resetKey="session-1"
          runActive={{ active: true, atMs: base }}
          turn={{ id: "run-ask", atMs: base }}
          settleMs={900}
        />,
      );
    });
    expect(timing).toMatchObject({ turnId: "run-ask", running: true, status: "running" });

    act(() => {
      renderer.update(
        <Harness
          capture={capture}
          resetKey="session-1"
          runActive={{ active: false, atMs: base + 5_000 }}
          turn={{ id: "run-ask", atMs: base }}
          interruption={{ id: "interrupt:session-1:run-ask", turnId: "run-ask", atMs: base + 5_000 }}
          settleMs={900}
        />,
      );
    });
    expect(timing).toMatchObject({ turnId: "run-ask", elapsedMs: 5_000, status: "interrupted" });

    act(() => {
      renderer.update(
        <Harness
          capture={capture}
          resetKey="session-1"
          runActive={{ active: true, atMs: base + 6_000 }}
          turn={{ id: "run-resumed", atMs: base + 6_000 }}
          settleMs={900}
        />,
      );
    });
    expect(timing).toMatchObject({ turnId: "run-resumed", running: true, status: "running" });

    act(() => {
      renderer.update(
        <Harness
          capture={capture}
          resetKey="session-1"
          runActive={{ active: false, atMs: base + 6_250 }}
          turn={{ id: "run-resumed", atMs: base + 6_000 }}
          settleMs={900}
        />,
      );
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(timing).toMatchObject({
      turnId: "run-resumed",
      running: false,
      elapsedMs: 250,
      status: "completed",
    });
    expect(JSON.parse(storage.get("brainpilot:turn-timing:session-1") ?? "{}")).toMatchObject({
      turnId: "run-resumed",
      durationMs: 250,
      status: "completed",
    });
    act(() => renderer.unmount());
  });

  it("rehydrates a background-work Stop from durable turn timestamps", () => {
    const startedAt = Date.parse("2026-08-21T00:00:00.000Z");
    const stoppedAt = startedAt + 27_250;
    vi.setSystemTime(stoppedAt + 2_000);
    let timing: TurnTiming | null = null;
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <Harness
          capture={(value) => { timing = value; }}
          resetKey="background-session"
          runActive={{ active: false, atMs: stoppedAt }}
          turn={{ id: "run-background", atMs: startedAt }}
          interruption={{
            id: "interrupt:background-session:run-background",
            turnId: "run-background",
            atMs: stoppedAt,
            startedAt,
          }}
        />,
      );
    });
    expect(timing).toMatchObject({
      running: false,
      turnId: "run-background",
      elapsedMs: 27_250,
      status: "interrupted",
    });
    act(() => renderer.unmount());
  });
});
