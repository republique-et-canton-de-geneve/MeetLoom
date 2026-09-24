export type NavigationGuard = () => Promise<boolean>;
const guards = new Set<NavigationGuard>();
export function registerNavigationGuard(guard: NavigationGuard) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}
async function mayLeave() {
  for (const guard of [...guards]) {
    try {
      if (!(await guard())) return false;
    } catch {
      return false;
    }
  }
  return true;
}
const key = "__meetloomNavigation";
interface Entry {
  url: string;
  state: unknown;
}
interface Position {
  scope: string;
  index: number;
}
export interface NavigationHost {
  read(): Entry;
  replace(state: unknown, url: string): void;
  push(state: unknown, url: string): void;
  go(delta: number): void;
  listen(callback: () => void): () => void;
  commit(url: string): void;
}
function position(state: unknown): Position | undefined {
  if (!state || typeof state !== "object") return;
  const value = (state as Record<string, unknown>)[key];
  if (!value || typeof value !== "object") return;
  const result = value as Position;
  if (typeof result.scope === "string" && Number.isInteger(result.index))
    return result;
}
const stamped = (state: unknown, point: Position) => ({
  ...(state && typeof state === "object" && !Array.isArray(state) ? state : {}),
  [key]: point,
});

/** SPA navigation keeps the current component mounted while guards save. A
 * refused history traversal returns to its original entry rather than pushing
 * a duplicate route and discarding the browser's forward history. */
export class AsyncNavigation {
  private current: Entry;
  private point: Position;
  private detach: (() => void) | undefined;
  private pending: Promise<boolean> | undefined;
  private popTarget: Entry | undefined;
  private restoring = false;
  private active = false;
  constructor(
    private host: NavigationHost,
    private guard = mayLeave,
  ) {
    this.current = host.read();
    this.point = position(this.current.state) ?? {
      scope: crypto.randomUUID(),
      index: 0,
    };
  }
  start() {
    this.active = true;
    this.current = {
      ...this.current,
      state: stamped(this.current.state, this.point),
    };
    this.host.replace(this.current.state, this.current.url);
    this.detach = this.host.listen(this.onPop);
    return () => {
      this.active = false;
      this.detach?.();
    };
  }
  private commit(entry: Entry) {
    const point = position(entry.state);
    this.point = point ?? { scope: crypto.randomUUID(), index: 0 };
    this.current = { ...entry, state: stamped(entry.state, this.point) };
    if (!point) this.host.replace(this.current.state, entry.url);
    this.host.commit(entry.url);
  }
  private restore(target: Entry) {
    const targetPoint = position(target.state);
    if (
      targetPoint?.scope === this.point.scope &&
      targetPoint.index !== this.point.index
    ) {
      this.restoring = true;
      this.host.go(this.point.index - targetPoint.index);
    } else this.host.replace(this.current.state, this.current.url);
  }
  private finishPop(allowed: boolean) {
    const target = this.popTarget;
    this.popTarget = undefined;
    if (!target) return false;
    if (allowed) this.commit(target);
    else this.restore(target);
    return allowed;
  }
  private check() {
    return Promise.resolve()
      .then(this.guard)
      .catch(() => false);
  }
  private onPop = () => {
    const target = this.host.read();
    if (this.restoring) {
      const targetPoint = position(target.state);
      if (
        targetPoint?.scope === this.point.scope &&
        targetPoint.index !== this.point.index
      ) {
        this.host.go(this.point.index - targetPoint.index);
      } else {
        this.restoring = false;
        if (target.url !== this.current.url)
          this.host.replace(this.current.state, this.current.url);
      }
      return;
    }
    this.popTarget = target;
    if (this.pending) return;
    this.pending = this.check()
      .then((allowed) => (this.active ? this.finishPop(allowed) : false))
      .finally(() => {
        this.pending = undefined;
      });
  };
  navigate = (url: string): Promise<boolean> => {
    if (!this.active || this.pending || this.restoring)
      return Promise.resolve(false);
    const target = new URL(url, this.current.url);
    if (target.origin !== new URL(this.current.url).origin)
      return Promise.resolve(false);
    if (target.href === this.current.url) return Promise.resolve(true);
    this.pending = this.check()
      .then((allowed) => {
        if (!this.active) return false;
        if (this.popTarget) return this.finishPop(allowed);
        if (!allowed) return false;
        const state = stamped(null, {
          scope: this.point.scope,
          index: this.point.index + 1,
        });
        this.host.push(state, target.href);
        this.commit({ url: target.href, state });
        return true;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  };
  /** Allows tests and callers to await an already requested browser traversal. */
  settled() {
    return this.pending ?? Promise.resolve(true);
  }
}
export function browserNavigation(commit: (url: string) => void) {
  return new AsyncNavigation({
    read: () => ({ url: location.href, state: history.state }),
    replace: (state, url) => history.replaceState(state, "", url),
    push: (state, url) => history.pushState(state, "", url),
    go: (delta) => history.go(delta),
    listen: (callback) => {
      window.addEventListener("popstate", callback);
      return () => window.removeEventListener("popstate", callback);
    },
    commit,
  });
}
