import type { WorkStatus } from "@brainpilot/protocol";

export interface WorkState {
  active: boolean;
  status: WorkStatus;
  epoch: number;
}

export interface SessionWorkFacts {
  active: boolean;
}

export interface PersistedWorkflowState {
  epoch: number;
}

export interface SessionStateAuthorityOptions {
  restored?: PersistedWorkflowState;
  inspect: () => SessionWorkFacts;
  publish: () => void;
  persist: (state: PersistedWorkflowState) => void | Promise<void>;
  schedule?: (callback: () => void) => void;
}

/** Owns the session's two-state liveness projection. */
export class SessionStateAuthority {
  private epoch: number;
  private state: WorkState;
  private revision = 0;
  private idleRevision?: number;
  private persistOperations: Promise<void> = Promise.resolve();

  constructor(private readonly options: SessionStateAuthorityOptions) {
    this.epoch = Math.max(0, Math.trunc(options.restored?.epoch ?? 0));
    this.state = this.makeState("idle");
  }

  snapshot(): WorkState {
    return { ...this.state };
  }

  persisted(): PersistedWorkflowState {
    return { epoch: this.epoch };
  }

  beginEpoch(): void {
    this.epoch += 1;
    this.revision += 1;
    this.idleRevision = undefined;
    this.state = this.makeState("active");
    void this.enqueuePersist(this.persisted()).catch(() => undefined);
    this.options.publish();
  }

  /** A restarted sandbox never revives its pre-crash execution. */
  async recoverAfterRestart(publish = true): Promise<void> {
    this.revision += 1;
    this.idleRevision = undefined;
    this.state = this.makeState("idle");
    if (this.epoch === 0) {
      if (publish) this.options.publish();
      return;
    }
    await this.enqueuePersist(this.persisted()).catch(() => undefined);
    if (publish) this.options.publish();
  }

  changed(publish = true): void {
    this.revision += 1;
    if (this.options.inspect().active) {
      this.idleRevision = undefined;
      this.update(this.makeState("active"), publish);
      return;
    }
    if (this.state.status === "idle") {
      this.idleRevision = undefined;
      if (publish) this.options.publish();
      return;
    }
    this.scheduleIdle(publish);
  }

  private scheduleIdle(publish: boolean): void {
    const candidate = this.revision;
    if (this.idleRevision === candidate) return;
    this.idleRevision = candidate;
    const schedule = this.options.schedule ?? queueMicrotask;
    schedule(() => {
      if (this.idleRevision !== candidate || this.revision !== candidate) return;
      if (this.options.inspect().active) {
        this.idleRevision = undefined;
        this.changed(publish);
        return;
      }
      this.idleRevision = undefined;
      this.update(this.makeState("idle"), publish);
    });
  }

  private makeState(status: WorkStatus): WorkState {
    return { active: status === "active", status, epoch: this.epoch };
  }

  private update(next: WorkState, publish: boolean): void {
    this.state = next;
    if (publish) this.options.publish();
  }

  private enqueuePersist(state: PersistedWorkflowState): Promise<void> {
    const snapshot = structuredClone(state);
    const operation = this.persistOperations.then(() => this.options.persist(snapshot));
    this.persistOperations = operation.catch(() => undefined);
    return operation;
  }
}
