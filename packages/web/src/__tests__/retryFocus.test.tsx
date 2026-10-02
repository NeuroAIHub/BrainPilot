import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useRetryFocus,
  type RememberRetryFocus,
  type RetryFocusResource,
} from "../components/primitives/useRetryFocus";
import { rememberComposerRetryFocus, useScopedComposerRetryFocus } from "../components/chat/PromptComposer";

/**
 * Focus recovery for a retry that its own success unmounts.
 *
 * The package's vitest runs in the `node` env, so there is no DOM: the hook
 * only ever reads `isConnected` / `activeElement` and calls `focus()`, which
 * these fakes provide. That is also the point of the design — recovery is
 * decided from the resource's committed state, never from a promise.
 */
type FakeElement = { isConnected: boolean; focus: ReturnType<typeof vi.fn> };

const element = (isConnected = true): FakeElement => ({ isConnected, focus: vi.fn() });

const asElement = (fake: FakeElement) => fake as unknown as HTMLElement;

/** Stub `document` with a body and whatever currently holds focus. */
function stubDocument(body: FakeElement, activeElement: unknown) {
  const doc = { body, activeElement };
  vi.stubGlobal("document", doc);
  return doc;
}

const idle: RetryFocusResource = { status: "idle" };
const loading: RetryFocusResource = { status: "loading" };
const ready = (): RetryFocusResource => ({ status: "ready" });
const failed = (): RetryFocusResource => ({ status: "error" });

function mount(isOpen: boolean, resource: RetryFocusResource) {
  let remember!: RememberRetryFocus;
  const Harness = (props: { isOpen: boolean; resource: RetryFocusResource }) => {
    remember = useRetryFocus(props.isOpen, props.resource);
    return null;
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Harness isOpen={isOpen} resource={resource} />);
  });
  return {
    remember: (trigger: FakeElement, target: FakeElement | null) =>
      remember(asElement(trigger), target ? asElement(target) : null),
    rememberElement: (trigger: HTMLElement, target: HTMLElement | null) => remember(trigger, target),
    update: (nextOpen: boolean, next: RetryFocusResource) =>
      act(() => renderer.update(<Harness isOpen={nextOpen} resource={next} />)),
    unmount: () => act(() => renderer.unmount()),
  };
}

function mountScoped(scope: string | null, resource: RetryFocusResource) {
  let remember!: RememberRetryFocus;
  const Harness = (props: { scope: string | null; resource: RetryFocusResource }) => {
    remember = useScopedComposerRetryFocus(props.scope, props.resource);
    return null;
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Harness scope={scope} resource={resource} />);
  });
  return {
    remember: (trigger: FakeElement, target: FakeElement) => remember(asElement(trigger), asElement(target)),
    update: (nextScope: string | null, next: RetryFocusResource) =>
      act(() => renderer.update(<Harness scope={nextScope} resource={next} />)),
    unmount: () => act(() => renderer.unmount()),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRetryFocus", () => {
  it("returns focus after a successful provider retry with no active session or draft", () => {
    const body = element();
    const form = element();
    const trigger = element();
    const doc = stubDocument(body, trigger);
    const hook = mountScoped(null, failed());
    try {
      hook.remember(trigger, form);
      hook.update(null, loading);
      expect(form.focus).not.toHaveBeenCalled();

      trigger.isConnected = false;
      doc.activeElement = body;
      hook.update(null, ready());
      expect(form.focus).toHaveBeenCalledOnce();
    } finally {
      hook.unmount();
    }
  });

  it("cancels a no-session retry focus record when a session opens", () => {
    const body = element();
    const form = element();
    const trigger = element();
    const doc = stubDocument(body, trigger);
    const hook = mountScoped(null, failed());
    try {
      hook.remember(trigger, form);
      hook.update(null, loading);
      hook.update("new-session", loading);

      trigger.isConnected = false;
      doc.activeElement = body;
      hook.update("new-session", ready());
      expect(form.focus).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
    }
  });

  it("prefers the composer form when it is present", () => {
    const remember = vi.fn();
    const trigger = element();
    const form = element();
    const region = element();
    rememberComposerRetryFocus(remember, asElement(trigger), asElement(form) as unknown as HTMLFormElement, asElement(region));
    expect(remember).toHaveBeenCalledExactlyOnceWith(asElement(trigger), asElement(form));
  });

  it("uses the persistent prompt region when ask_user replaces the composer form", () => {
    const body = element();
    const region = element();
    const trigger = element();
    const doc = stubDocument(body, trigger);
    const hook = mount(true, failed());
    try {
      const remember = vi.fn(hook.rememberElement);
      rememberComposerRetryFocus(remember, asElement(trigger), null, asElement(region));
      expect(remember).toHaveBeenCalledExactlyOnceWith(asElement(trigger), asElement(region));
      hook.update(true, loading);
      expect(region.focus).not.toHaveBeenCalled();

      trigger.isConnected = false;
      doc.activeElement = body;
      hook.update(true, ready());
      expect(region.focus).toHaveBeenCalledOnce();
    } finally {
      hook.unmount();
    }
  });

  it("holds focus during the retry and hands it to the target once the data lands", () => {
    const body = element();
    const heading = element();
    const trigger = element();
    const doc = stubDocument(body, trigger);
    const hook = mount(true, failed());
    try {
      hook.remember(trigger, heading);

      // In flight: the notice — and the focused button — is still mounted.
      hook.update(true, loading);
      expect(heading.focus).not.toHaveBeenCalled();

      // Success removes the notice; the browser has dropped focus to <body>.
      trigger.isConnected = false;
      doc.activeElement = body;
      hook.update(true, ready());
      expect(heading.focus).toHaveBeenCalledTimes(1);
    } finally {
      hook.unmount();
    }
  });

  it("does not wait for the retry (or any optional follow-up) promise to settle", () => {
    const body = element();
    const heading = element();
    const trigger = element();
    const doc = stubDocument(body, trigger);
    const hook = mount(true, failed());
    try {
      // The caller's retry — plus whatever optional work it chains, e.g. a
      // provider health probe — never settles here.
      const neverSettles = new Promise<void>(() => {});
      hook.remember(trigger, heading);
      void neverSettles;

      trigger.isConnected = false;
      doc.activeElement = body;
      hook.update(true, ready());
      expect(heading.focus).toHaveBeenCalledTimes(1);
    } finally {
      hook.unmount();
    }
  });

  it("leaves focus alone when a failed retry keeps the button on screen", () => {
    const body = element();
    const heading = element();
    const trigger = element();
    stubDocument(body, trigger);
    const hook = mount(true, failed());
    try {
      hook.remember(trigger, heading);
      hook.update(true, loading);
      hook.update(true, failed()); // Failed again: the notice (and focus) stays.
      expect(heading.focus).not.toHaveBeenCalled();
      expect(trigger.focus).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
    }
  });

  it("forgets the record once a retry settles, so a later success moves nothing", () => {
    const body = element();
    const heading = element();
    const trigger = element();
    const doc = stubDocument(body, trigger);
    const hook = mount(true, failed());
    try {
      hook.remember(trigger, heading);
      hook.update(true, loading);
      hook.update(true, failed());

      // A later background success is not "this user's retry" any more.
      trigger.isConnected = false;
      doc.activeElement = body;
      hook.update(true, ready());
      expect(heading.focus).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
    }
  });

  it("never steals focus from a control the user moved to", () => {
    const body = element();
    const heading = element();
    const trigger = element();
    const other = element();
    const doc = stubDocument(body, trigger);
    const hook = mount(true, failed());
    try {
      hook.remember(trigger, heading);
      hook.update(true, loading);

      trigger.isConnected = false;
      doc.activeElement = other; // The user tabbed on while the retry ran.
      hook.update(true, ready());
      expect(heading.focus).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
    }
  });

  it("does nothing when the target itself went away (tab switch, closed section)", () => {
    const body = element();
    const heading = element();
    const trigger = element();
    const doc = stubDocument(body, trigger);
    const hook = mount(true, failed());
    try {
      hook.remember(trigger, heading);
      hook.update(true, loading);

      trigger.isConnected = false;
      heading.isConnected = false;
      doc.activeElement = body;
      hook.update(true, ready());
      expect(heading.focus).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
    }
  });

  it("drops the record when the dialog closes", () => {
    const body = element();
    const heading = element();
    const trigger = element();
    const doc = stubDocument(body, trigger);
    const hook = mount(true, failed());
    try {
      hook.remember(trigger, heading);
      hook.update(false, loading); // Closed mid-retry.

      // Reopened later, with a reply for the old request arriving.
      trigger.isConnected = false;
      doc.activeElement = body;
      hook.update(true, ready());
      expect(heading.focus).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
    }
  });

  it("ignores a retry that was never focused, and plain loads with no retry at all", () => {
    const body = element();
    const heading = element();
    const trigger = element();
    const other = element();
    const doc = stubDocument(body, other); // A mouse click that did not focus.
    const hook = mount(true, idle);
    try {
      hook.remember(trigger, heading);
      hook.remember(trigger, null); // No landing spot: nothing to remember.

      trigger.isConnected = false;
      doc.activeElement = body;
      hook.update(true, ready());
      expect(heading.focus).not.toHaveBeenCalled();

      // An ordinary refresh cycle without any remembered retry.
      hook.update(true, loading);
      hook.update(true, ready());
      expect(heading.focus).not.toHaveBeenCalled();
      expect(body.focus).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
    }
  });
});
