/** Durable flat task ledger and per-agent notification queue. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type TaskStatus = "pending" | "replied" | "cancelled";

export interface TaskRecord {
  id: string;
  seq: number;
  created_by: string;
  assigned_to: string;
  content: string;
  status: TaskStatus;
  reply?: string;
  created_at: number;
  completed_at?: number;
}

interface StoredTask extends TaskRecord {
  reminded_at?: number;
  unhandled_notified_at?: number;
}

export type TaskNotificationKind =
  | "assigned"
  | "replied"
  | "cancelled"
  | "unhandled"
  | "system"
  | "trace";

export interface TaskNotification {
  id: string;
  seq: number;
  kind: TaskNotificationKind;
  to_agent: string;
  from_agent: string;
  task_id?: string;
  content: string;
  created_at: number;
}

interface StoredLedger {
  next_task_seq: number;
  next_notification_seq: number;
  tasks: StoredTask[];
  notifications: TaskNotification[];
  delivery_paused: boolean;
  paused_agents: string[];
}

export const MAX_PENDING_NOTIFICATIONS = 20;
export const TASK_BATCH_MAX_NOTIFICATIONS = 3;
export const TASK_CONTEXT_MAX_CHARS = 24_000;

export class TaskQueueFullError extends Error {
  constructor(readonly agent: string, readonly limit: number) {
    super(`task notification queue for "${agent}" is full (limit ${limit})`);
    this.name = "TaskQueueFullError";
  }
}

export class TaskLedgerCorruptError extends Error {
  constructor(readonly path: string, cause?: unknown) {
    super(`invalid task ledger: ${path}${cause instanceof Error ? ` (${cause.message})` : ""}`);
    this.name = "TaskLedgerCorruptError";
    this.cause = cause;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateStoredLedger(value: unknown): StoredLedger {
  if (!isRecord(value)) throw new Error("root must be an object");
  const nextTaskSeq = value.next_task_seq;
  const nextNotificationSeq = value.next_notification_seq;
  const tasks = value.tasks;
  const notifications = value.notifications;
  if (!Number.isInteger(nextTaskSeq) || Number(nextTaskSeq) < 1) throw new Error("next_task_seq must be a positive integer");
  if (!Number.isInteger(nextNotificationSeq) || Number(nextNotificationSeq) < 1) throw new Error("next_notification_seq must be a positive integer");
  if (!Array.isArray(tasks) || !Array.isArray(notifications)) throw new Error("tasks and notifications must be arrays");

  const taskIds = new Set<string>();
  const normalizedTasks: StoredTask[] = [];
  let maxTaskSeq = 0;
  for (const task of tasks) {
    if (!isRecord(task) || typeof task.id !== "string" || !Number.isInteger(task.seq) || Number(task.seq) < 1) throw new Error("invalid task record");
    if (taskIds.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    if (typeof task.created_by !== "string" || typeof task.assigned_to !== "string" || typeof task.content !== "string") throw new Error(`invalid task fields: ${task.id}`);
    const status = task.status === "completed" ? "replied" : task.status;
    if (status !== "pending" && status !== "replied" && status !== "cancelled") throw new Error(`invalid task status: ${task.id}`);
    if (typeof task.created_at !== "number") throw new Error(`invalid task timestamp: ${task.id}`);
    taskIds.add(task.id);
    normalizedTasks.push({ ...task, status } as StoredTask);
    maxTaskSeq = Math.max(maxTaskSeq, Number(task.seq));
  }

  const notificationIds = new Set<string>();
  const normalizedNotifications: TaskNotification[] = [];
  let maxNotificationSeq = 0;
  const kinds = new Set<TaskNotificationKind>(["assigned", "replied", "cancelled", "unhandled", "system", "trace"]);
  for (const notification of notifications) {
    if (!isRecord(notification) || typeof notification.id !== "string" || !Number.isInteger(notification.seq) || Number(notification.seq) < 1) throw new Error("invalid notification record");
    if (notificationIds.has(notification.id)) throw new Error(`duplicate notification id: ${notification.id}`);
    const kind = notification.kind === "completed" ? "replied" : notification.kind;
    if (!kinds.has(kind as TaskNotificationKind)) throw new Error(`invalid notification kind: ${notification.id}`);
    if (typeof notification.to_agent !== "string" || typeof notification.from_agent !== "string" || typeof notification.content !== "string" || typeof notification.created_at !== "number") throw new Error(`invalid notification fields: ${notification.id}`);
    if (notification.task_id !== undefined && (!taskIds.has(String(notification.task_id)))) throw new Error(`notification references missing task: ${notification.id}`);
    notificationIds.add(notification.id);
    normalizedNotifications.push({ ...notification, kind } as TaskNotification);
    maxNotificationSeq = Math.max(maxNotificationSeq, Number(notification.seq));
  }
  if (Number(nextTaskSeq) <= maxTaskSeq) throw new Error("next_task_seq does not exceed existing tasks");
  if (Number(nextNotificationSeq) <= maxNotificationSeq) throw new Error("next_notification_seq does not exceed existing notifications");
  const pausedAgents = value.paused_agents ?? [];
  if (!Array.isArray(pausedAgents) || pausedAgents.some((agent) => typeof agent !== "string")) throw new Error("paused_agents must be a string array");
  if (value.delivery_paused !== undefined && typeof value.delivery_paused !== "boolean") throw new Error("delivery_paused must be boolean");
  return {
    next_task_seq: Number(nextTaskSeq),
    next_notification_seq: Number(nextNotificationSeq),
    tasks: normalizedTasks,
    notifications: normalizedNotifications,
    delivery_paused: value.delivery_paused === true,
    paused_agents: [...new Set(pausedAgents)],
  };
}

export class TaskLedger {
  private nextTaskSeq = 1;
  private nextNotificationSeq = 1;
  private tasks: StoredTask[] = [];
  private notifications: TaskNotification[] = [];
  private deliveryPaused = false;
  private pausedAgents = new Set<string>();
  private operations: Promise<void> = Promise.resolve();

  constructor(readonly sessionId: string, private readonly persistPath?: string) {}

  private publicTask(task: StoredTask): TaskRecord {
    const { reminded_at: _r, unhandled_notified_at: _u, ...record } = task;
    return { ...record };
  }

  private taskId(seq: number): string {
    return `task_${String(seq).padStart(6, "0")}`;
  }

  private notificationId(seq: number): string {
    return `task_event_${String(seq).padStart(6, "0")}`;
  }

  private enqueue(
    kind: TaskNotificationKind,
    toAgent: string,
    fromAgent: string,
    content: string,
    taskId?: string,
  ): TaskNotification {
    // Backpressure applies to new work (and trace work), never to terminal
    // replies/cancellations/errors that unblock an existing creator.
    if ((kind === "assigned" || kind === "trace") && this.count(toAgent) >= MAX_PENDING_NOTIFICATIONS) {
      throw new TaskQueueFullError(toAgent, MAX_PENDING_NOTIFICATIONS);
    }
    const seq = this.nextNotificationSeq++;
    const notification: TaskNotification = {
      id: this.notificationId(seq),
      seq,
      kind,
      to_agent: toAgent,
      from_agent: fromAgent,
      ...(taskId ? { task_id: taskId } : {}),
      content,
      created_at: Date.now(),
    };
    this.notifications.push(notification);
    return notification;
  }

  private async mutate<T>(fn: () => T): Promise<T> {
    let result!: T;
    let failure: unknown;
    this.operations = this.operations.then(async () => {
      const before = {
        nextTaskSeq: this.nextTaskSeq,
        nextNotificationSeq: this.nextNotificationSeq,
        tasks: structuredClone(this.tasks),
        notifications: structuredClone(this.notifications),
        deliveryPaused: this.deliveryPaused,
        pausedAgents: new Set(this.pausedAgents),
      };
      try {
        result = fn();
        await this.persist();
      } catch (err) {
        this.nextTaskSeq = before.nextTaskSeq;
        this.nextNotificationSeq = before.nextNotificationSeq;
        this.tasks = before.tasks;
        this.notifications = before.notifications;
        this.deliveryPaused = before.deliveryPaused;
        this.pausedAgents = before.pausedAgents;
        failure = err;
      }
    });
    await this.operations;
    if (failure) throw failure;
    return result;
  }

  async dispatch(createdBy: string, assignedTo: string, content: string): Promise<TaskRecord> {
    return this.mutate(() => {
      const seq = this.nextTaskSeq++;
      const task: StoredTask = {
        id: this.taskId(seq),
        seq,
        created_by: createdBy,
        assigned_to: assignedTo,
        content,
        status: "pending",
        created_at: Date.now(),
      };
      // Queue capacity is checked before the task becomes visible.
      this.enqueue("assigned", assignedTo, createdBy, content, task.id);
      this.tasks.push(task);
      return this.publicTask(task);
    });
  }

  async complete(taskId: string, assignee: string, reply: string): Promise<TaskRecord> {
    return this.mutate(() => {
      const task = this.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new Error(`task not found: ${taskId}`);
      if (task.assigned_to !== assignee) throw new Error(`task ${taskId} is assigned to ${task.assigned_to}`);
      if (task.status === "replied") {
        if (task.reply === reply) return this.publicTask(task);
        throw new Error(`task ${taskId} already has a different reply`);
      }
      if (task.status !== "pending") throw new Error(`task ${taskId} is ${task.status}`);
      this.enqueue("replied", task.created_by, assignee, reply, task.id);
      task.status = "replied";
      task.reply = reply;
      task.completed_at = Date.now();
      this.notifications = this.notifications.filter(
        (notification) => !(notification.kind === "assigned" && notification.task_id === task.id),
      );
      return this.publicTask(task);
    });
  }

  async cancelAssignedTo(agent: string, reason: string): Promise<TaskRecord[]> {
    return this.mutate(() => {
      const cancelled: TaskRecord[] = [];
      for (const task of this.tasks) {
        if (task.assigned_to !== agent || task.status !== "pending") continue;
        this.enqueue("cancelled", task.created_by, "system", reason, task.id);
        task.status = "cancelled";
        task.reply = reason;
        task.completed_at = Date.now();
        this.notifications = this.notifications.filter(
          (notification) => !(notification.kind === "assigned" && notification.task_id === task.id),
        );
        cancelled.push(this.publicTask(task));
      }
      return cancelled;
    });
  }

  /** Destructively clear work that must not survive a workspace rollback. */
  async cancelAllPending(reason: string): Promise<TaskRecord[]> {
    return this.mutate(() => {
      const cancelled: TaskRecord[] = [];
      for (const task of this.tasks) {
        if (task.status !== "pending") continue;
        task.status = "cancelled";
        task.reply = reason;
        task.completed_at = Date.now();
        cancelled.push(this.publicTask(task));
      }
      // Terminal and system notifications can also carry assumptions about
      // the pre-rollback workspace, so the entire delivery queue is discarded.
      this.notifications = [];
      return cancelled;
    });
  }

  async enqueueTrace(fromAgent: string, content: string): Promise<TaskNotification> {
    return this.mutate(() => this.enqueue("trace", "trace", fromAgent, content));
  }

  async enqueueSystem(toAgent: string, content: string, taskId?: string): Promise<void> {
    await this.mutate(() => { this.enqueue("system", toAgent, "system", content, taskId); });
  }

  /** Claim the one allowed reminder for every pending assignment of an agent. */
  async claimReminder(agent: string): Promise<boolean> {
    return this.mutate(() => {
      const now = Date.now();
      const claimable = this.tasks.filter(
        (task) => task.assigned_to === agent && task.status === "pending" && !task.reminded_at,
      );
      for (const task of claimable) task.reminded_at = now;
      return claimable.length > 0;
    });
  }

  async notifyUnhandled(agent: string): Promise<string[]> {
    return this.mutate(() => {
      const now = Date.now();
      const notified: string[] = [];
      for (const task of this.tasks) {
        if (
          task.assigned_to !== agent || task.status !== "pending" ||
          !task.reminded_at || task.unhandled_notified_at
        ) continue;
        this.enqueue(
          "unhandled",
          task.created_by,
          "system",
          `Agent "${agent}" did not act on task ${task.id} after one reminder.`,
          task.id,
        );
        task.unhandled_notified_at = now;
        notified.push(task.id);
      }
      return notified;
    });
  }

  pendingAssignedTo(agent: string): TaskRecord[] {
    return this.tasks
      .filter((task) => task.assigned_to === agent && task.status === "pending")
      .sort((a, b) => a.seq - b.seq)
      .map((task) => this.publicTask(task));
  }

  pendingCreatedBy(agent: string): TaskRecord[] {
    return this.tasks
      .filter((task) => task.created_by === agent && task.status === "pending")
      .sort((a, b) => a.seq - b.seq)
      .map((task) => this.publicTask(task));
  }

  list(): TaskRecord[] {
    const rank: Record<TaskStatus, number> = { pending: 0, replied: 1, cancelled: 2 };
    return [...this.tasks]
      .sort((a, b) => rank[a.status] - rank[b.status] || a.seq - b.seq)
      .map((task) => this.publicTask(task));
  }

  get(taskId: string): TaskRecord | undefined {
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    return task ? this.publicTask(task) : undefined;
  }

  peekBatch(
    agent: string,
    maxNotifications = TASK_BATCH_MAX_NOTIFICATIONS,
    maxChars = TASK_CONTEXT_MAX_CHARS,
  ): TaskNotification[] {
    const out: TaskNotification[] = [];
    let chars = 0;
    for (const notification of this.notifications) {
      if (notification.to_agent !== agent) continue;
      if (out.length >= maxNotifications) break;
      const next = chars + notification.content.length;
      if (out.length > 0 && next > maxChars) break;
      out.push({ ...notification });
      chars = next;
    }
    return out;
  }

  async acknowledge(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    await this.mutate(() => {
      this.notifications = this.notifications.filter((notification) => !idSet.has(notification.id));
    });
  }

  /** Atomically acknowledge a delivered batch only while its target is active. */
  async acknowledgeIfActive(agent: string, ids: readonly string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const idSet = new Set(ids);
    return this.mutate(() => {
      if (this.isPaused(agent)) return false;
      this.notifications = this.notifications.filter((notification) => !idSet.has(notification.id));
      return true;
    });
  }

  count(agent: string): number {
    return this.notifications.reduce((total, notification) => total + Number(notification.to_agent === agent), 0);
  }

  hasNotification(id: string): boolean {
    return this.notifications.some((notification) => notification.id === id);
  }

  notificationTargets(): string[] {
    return [...new Set(this.notifications.map((notification) => notification.to_agent))];
  }

  hasPausedDelivery(): boolean {
    return this.deliveryPaused || this.pausedAgents.size > 0;
  }

  isPaused(agent: string): boolean {
    return this.deliveryPaused || this.pausedAgents.has(agent);
  }

  async pauseAgent(agent: string): Promise<void> {
    if (this.pausedAgents.has(agent)) return;
    await this.mutate(() => { this.pausedAgents.add(agent); });
  }

  async pauseDelivery(): Promise<void> {
    if (this.deliveryPaused) return;
    await this.mutate(() => { this.deliveryPaused = true; });
  }

  async resumeDelivery(): Promise<void> {
    if (!this.hasPausedDelivery()) return;
    await this.mutate(() => {
      this.deliveryPaused = false;
      this.pausedAgents.clear();
    });
  }

  async recover(): Promise<void> {
    if (!this.persistPath) return;
    try {
      const parsed = validateStoredLedger(JSON.parse(await readFile(this.persistPath, "utf8")));
      this.nextTaskSeq = parsed.next_task_seq;
      this.nextNotificationSeq = parsed.next_notification_seq;
      this.tasks = parsed.tasks;
      this.notifications = parsed.notifications;
      this.deliveryPaused = parsed.delivery_paused;
      this.pausedAgents = new Set(parsed.paused_agents);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new TaskLedgerCorruptError(this.persistPath, err);
    }
  }

  async flush(): Promise<void> {
    await this.operations;
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return;
    await mkdir(dirname(this.persistPath), { recursive: true });
    const snapshot: StoredLedger = {
      next_task_seq: this.nextTaskSeq,
      next_notification_seq: this.nextNotificationSeq,
      tasks: this.tasks,
      notifications: this.notifications,
      delivery_paused: this.deliveryPaused,
      paused_agents: [...this.pausedAgents],
    };
    const tmp = `${this.persistPath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
    await rename(tmp, this.persistPath);
  }
}
