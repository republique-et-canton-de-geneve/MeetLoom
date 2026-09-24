import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Role, Session, SessionResponse } from "../shared/model";
import { editableSessionSchema } from "../shared/validation";
import { api, apiMessage, ApiError } from "./api";
import { editableDocument, mergeSessionDraft } from "./session-merge";

type SaveStatus = "saved" | "saving" | "unsaved" | "conflict";
interface SessionState {
  session: Session | null;
  role: Role;
  error: string;
  status: SaveStatus;
}

/** One write queue per session. Overlapping reads cannot replace local drafts or
 * a newer lifecycle. Independent of React so asynchronous races are testable. */
export class SessionController {
  private state: SessionState = {
    session: null,
    role: "viewer",
    error: "",
    status: "saved",
  };
  private listeners = new Set<() => void>();
  private revision = 0;
  private saved = 0;
  private conflict = false;
  private base: Session | null = null;
  private active = true;
  private generation = 0;
  private readEpoch = 0;
  private abort = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Set<symbol>();
  private saving: Promise<boolean> | null = null;
  private actions = new Map<string, Promise<void>>();
  constructor(
    private id: string,
    private request: typeof api = api,
    private debounceMs = 800,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  isDirty = () => this.revision !== this.saved;
  private emit(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  setError = (error: string) => this.emit({ error });
  private alive(generation: number) {
    return this.active && generation === this.generation;
  }
  activate() {
    if (this.active) return;
    this.active = true;
    this.abort = new AbortController();
  }
  dispose() {
    this.active = false;
    this.generation++;
    this.readEpoch++;
    this.abort.abort();
    clearTimeout(this.timer);
    this.pending.clear();
    this.tail = Promise.resolve();
    this.saving = null;
    this.actions.clear();
  }
  private enqueue<T>(
    operation: (generation: number) => Promise<T>,
    cancelled: T,
  ): Promise<T> {
    const generation = this.generation,
      key = Symbol();
    this.pending.add(key);
    const work = this.tail.then(() =>
      this.alive(generation) ? operation(generation) : cancelled,
    );
    this.tail = work.catch(() => undefined);
    return work.finally(() => {
      this.pending.delete(key);
    });
  }
  private failure(error: unknown, generation: number) {
    if (!this.alive(generation)) return;
    this.emit({
      error:
        error instanceof Error ? error.message : apiMessage("INTERNAL_ERROR"),
    });
  }
  load = (): Promise<void> => {
    clearTimeout(this.timer);
    this.readEpoch++;
    return this.enqueue(async (generation) => {
      const revision = this.revision;
      try {
        const result = await this.request<SessionResponse>(
          `/sessions/${this.id}`,
          { signal: this.abort.signal },
        );
        if (!this.alive(generation)) return;
        if (this.revision !== revision) {
          this.emit({ error: apiMessage("DRAFT_CHANGED") });
          return;
        }
        this.revision = this.saved = 0;
        this.conflict = false;
        this.base = result.session;
        this.emit({
          session: result.session,
          role: result.role,
          status: "saved",
          error: "",
        });
      } catch (error) {
        this.failure(error, generation);
      }
    }, undefined);
  };
  private mergeServerState(draft: Session, server: Session): Session {
    return {
      ...draft,
      id: server.id,
      ownerId: server.ownerId,
      createdAt: server.createdAt,
      version: server.version,
      updatedAt: server.updatedAt,
      run: server.run,
    };
  }
  private acceptRemote(result: SessionResponse): boolean {
    const draft = this.state.session;
    if (!draft || !this.isDirty()) {
      this.base = result.session;
      this.emit({
        session: result.session,
        role: result.role,
        status: "saved",
        error: "",
      });
      return true;
    }
    if (this.conflict) {
      this.emit({
        session: { ...draft, run: result.session.run },
        role: result.role,
      });
      return false;
    }
    const merged = mergeSessionDraft(this.base ?? draft, draft, result.session);
    if (!merged.session) {
      this.conflict = true;
      clearTimeout(this.timer);
      this.emit({
        session: { ...draft, run: result.session.run },
        role: result.role,
        status: "conflict",
        error: apiMessage("VERSION_CONFLICT"),
      });
      return false;
    }
    this.base = result.session;
    this.emit({
      session: merged.session,
      role: result.role,
      status: "unsaved",
      error: "",
    });
    return true;
  }
  private async saveNow(generation: number): Promise<boolean> {
    clearTimeout(this.timer);
    if (!this.state.session || this.conflict) return false;
    let rebases = 0;
    while (this.alive(generation) && this.isDirty()) {
      const snapshot = structuredClone(this.state.session);
      const checked = editableSessionSchema.safeParse(
        editableDocument(snapshot),
      );
      if (!checked.success) {
        this.emit({ status: "unsaved", error: apiMessage("DRAFT_INVALID") });
        return false;
      }
      const revision = this.revision;
      this.emit({ status: "saving" });
      try {
        const result = await this.request<SessionResponse>(
          `/sessions/${this.id}`,
          {
            method: "PUT",
            signal: this.abort.signal,
            body: JSON.stringify({
              session: checked.data,
              version: snapshot.version,
            }),
          },
        );
        if (!this.alive(generation)) return false;
        this.saved = revision;
        this.base = result.session;
        const session =
          this.revision === revision
            ? result.session
            : this.mergeServerState(this.state.session!, result.session);
        this.emit({
          session,
          role: result.role,
          error: "",
          status: this.isDirty() ? "unsaved" : "saved",
        });
      } catch (error) {
        if (!this.alive(generation)) return false;
        const versionConflict =
          error instanceof ApiError &&
          error.status === 409 &&
          (!error.code || error.code === "VERSION_CONFLICT");
        if (versionConflict) {
          if (rebases++ >= 2) {
            this.emit({
              status: "unsaved",
              error: apiMessage("COLLABORATION_BUSY"),
            });
            return false;
          }
          try {
            const remote = await this.request<SessionResponse>(
              `/sessions/${this.id}`,
              { signal: this.abort.signal },
            );
            if (!this.alive(generation)) return false;
            if (!this.acceptRemote(remote)) return false;
            continue;
          } catch (refreshError) {
            if (!this.alive(generation)) return false;
            this.emit({ status: "unsaved" });
            this.failure(refreshError, generation);
            return false;
          }
        }
        this.emit({ status: "unsaved" });
        this.failure(error, generation);
        return false;
      }
    }
    return this.alive(generation) && !this.isDirty();
  }
  save = (): Promise<boolean> => {
    if (this.saving) return this.saving;
    const task = this.enqueue((generation) => this.saveNow(generation), false);
    this.saving = task;
    void task.finally(() => {
      if (this.saving === task) this.saving = null;
    });
    return task;
  };
  retry = () => {
    // A CAS conflict needs an explicit reload, never an implicit overwrite.
    if (this.conflict) return;
    if (!this.state.session) {
      void this.load();
      return;
    }
    if (this.isDirty()) void this.save();
    else void this.poll();
  };
  update = (change: (session: Session) => Session) => {
    if (!this.active || !this.state.session) return;
    const session = change(structuredClone(this.state.session));
    this.revision++;
    this.emit({
      session,
      status: this.conflict ? "conflict" : "unsaved",
      error: this.conflict ? this.state.error : "",
    });
    clearTimeout(this.timer);
    if (!this.conflict)
      this.timer = setTimeout(() => void this.save(), this.debounceMs);
  };
  action = (
    action: string,
    input: Record<string, unknown> = {},
  ): Promise<void> => {
    const key = JSON.stringify({ action, input });
    const existing = this.actions.get(key);
    if (existing) return existing;
    const task = this.enqueue(async (generation) => {
      // Stopping remains possible when an incomplete draft cannot be saved.
      // Only running state changes, while the local draft stays intact.
      const stopping = ["reset", "stop", "finish", "pause"].includes(action);
      if (!stopping && !(await this.saveNow(generation))) return;
      const before = this.state.session;
      if (!before || !this.alive(generation)) return;
      try {
        const result = await this.request<SessionResponse>(
          `/sessions/${this.id}/run`,
          {
            method: "POST",
            signal: this.abort.signal,
            body: JSON.stringify({
              ...input,
              action,
              revision: before.run.revision,
            }),
          },
        );
        if (!this.alive(generation)) return;
        this.acceptRemote(result);
      } catch (error) {
        this.failure(error, generation);
      }
    }, undefined);
    this.actions.set(key, task);
    void task.finally(() => {
      if (this.actions.get(key) === task) this.actions.delete(key);
    });
    return task;
  };
  poll = async (): Promise<void> => {
    if (!this.active || this.pending.size || this.conflict) return;
    const generation = this.generation,
      epoch = this.readEpoch;
    try {
      const result = await this.request<SessionResponse>(
        `/sessions/${this.id}`,
        { signal: this.abort.signal },
      );
      if (
        this.alive(generation) &&
        epoch === this.readEpoch &&
        !this.pending.size &&
        !this.conflict &&
        result.session.version >= (this.state.session?.version ?? 0)
      ) {
        this.acceptRemote(result);
      }
    } catch (error) {
      if (epoch === this.readEpoch && !this.pending.size && !this.isDirty())
        this.failure(error, generation);
    }
  };
}

export function useSession(id: string) {
  const controller = useMemo(() => new SessionController(id), [id]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.activate();
    void controller.load();
    const polling = setInterval(() => void controller.poll(), 3000);
    const refresh = () => {
      if (document.visibilityState === "visible") void controller.poll();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (controller.isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("beforeunload", unload);
    return () => {
      clearInterval(polling);
      controller.dispose();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("beforeunload", unload);
    };
  }, [controller]);
  return {
    ...state,
    update: controller.update,
    action: controller.action,
    save: controller.save,
    load: controller.load,
    setError: controller.setError,
    retry: controller.retry,
  };
}
