import type { Session } from "../shared/model";
import {
  editableSessionSchema,
  type EditableSessionInput,
} from "../shared/validation";
import { mapBlocks } from "../shared/domain";

const missing = Symbol("missing");
type Value = unknown | typeof missing;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function equal(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, index) => equal(value, b[index]))
    );
  if (object(a) && object(b)) {
    const keys = Object.keys(a).filter((key) => a[key] !== undefined),
      other = Object.keys(b).filter((key) => b[key] !== undefined);
    return (
      keys.length === other.length &&
      keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  }
  return false;
}
const idArray = (
  value: unknown[],
): value is { id: string; [key: string]: unknown }[] =>
  value.every((item) => object(item) && typeof item.id === "string");
const clone = (value: Value) =>
  value === missing ? missing : structuredClone(value);

/** The API schema owns the allowlist. New editable fields are included while
 * workspace mappings and future privileged lifecycle metadata stay server-owned. */
export function editableDocument(session: Session) {
  const fields = Object.keys(
    editableSessionSchema.shape,
  ) as (keyof EditableSessionInput)[];
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(session, field))
      .map((field) => [field, session[field]]),
  ) as EditableSessionInput;
}

export interface MergeResult {
  session: Session | null;
  conflicts: string[];
}

/** Field-level three-way merge. Identity arrays use stable IDs, never indexes.
 * Delete/edit, identity collisions and inconsistent ordering stay explicit. */
export function mergeSessionDraft(
  base: Session,
  local: Session,
  remote: Session,
): MergeResult {
  const conflicts = new Set<string>();
  const conflict = (path: string) => {
    conflicts.add(path || "agenda");
  };
  const merge = (
    before: Value,
    ours: Value,
    theirs: Value,
    path: string,
  ): Value => {
    if (equal(ours, theirs)) return clone(ours);
    if (equal(ours, before)) return clone(theirs);
    if (equal(theirs, before)) return clone(ours);
    if (before === missing || ours === missing || theirs === missing) {
      conflict(path);
      return clone(ours);
    }
    if (object(before) && object(ours) && object(theirs)) {
      const result: Record<string, unknown> = {};
      for (const key of new Set([
        ...Object.keys(before),
        ...Object.keys(ours),
        ...Object.keys(theirs),
      ])) {
        if (
          key === "duration" &&
          ours.kind === theirs.kind &&
          ["group", "parallel", "note"].includes(String(ours.kind))
        ) {
          result.duration = ours.duration;
          continue;
        }
        const value = merge(
          before[key] === undefined ? missing : before[key],
          ours[key] === undefined ? missing : ours[key],
          theirs[key] === undefined ? missing : theirs[key],
          path ? `${path}.${key}` : key,
        );
        if (value !== missing)
          Object.defineProperty(result, key, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
      }
      return result;
    }
    if (
      Array.isArray(before) &&
      Array.isArray(ours) &&
      Array.isArray(theirs) &&
      idArray(before) &&
      idArray(ours) &&
      idArray(theirs)
    ) {
      const b = new Map(before.map((value) => [value.id, value])),
        l = new Map(ours.map((value) => [value.id, value])),
        r = new Map(theirs.map((value) => [value.id, value]));
      if (
        b.size !== before.length ||
        l.size !== ours.length ||
        r.size !== theirs.length
      ) {
        conflict(`${path}.identity`);
        return clone(ours);
      }
      const values = new Map<string, unknown>();
      for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
        const value = merge(
          b.get(id) ?? missing,
          l.get(id) ?? missing,
          r.get(id) ?? missing,
          `${path}[${id}]`,
        );
        if (value !== missing) values.set(id, value);
      }
      const indexes = (items: { id: string }[]) =>
        new Map(items.map((value, index) => [value.id, index]));
      const bi = indexes(before),
        li = indexes(ours),
        ri = indexes(theirs);
      const relation = (map: Map<string, number>, a: string, z: string) =>
        map.has(a) && map.has(z) ? map.get(a)! < map.get(z)! : null;
      const ids = [...values.keys()],
        edges = new Map(ids.map((id) => [id, new Set<string>()])),
        indegree = new Map(ids.map((id) => [id, 0]));
      const edge = (a: string, z: string) => {
        if (!edges.get(a)!.has(z)) {
          edges.get(a)!.add(z);
          indegree.set(z, indegree.get(z)! + 1);
        }
      };
      for (let a = 0; a < ids.length; a++)
        for (let z = a + 1; z < ids.length; z++) {
          const first = ids[a],
            second = ids[z],
            oldOrder = relation(bi, first, second),
            localOrder = relation(li, first, second),
            remoteOrder = relation(ri, first, second);
          if (oldOrder !== null) {
            const order =
              localOrder !== null && localOrder !== oldOrder
                ? localOrder
                : remoteOrder !== null && remoteOrder !== oldOrder
                  ? remoteOrder
                  : oldOrder;
            edge(order ? first : second, order ? second : first);
          } else {
            if (localOrder !== null)
              edge(localOrder ? first : second, localOrder ? second : first);
            if (remoteOrder !== null)
              edge(remoteOrder ? first : second, remoteOrder ? second : first);
          }
        }
      const ready = ids.filter((id) => indegree.get(id) === 0).sort(),
        ordered: string[] = [];
      while (ready.length) {
        const id = ready.shift()!;
        ordered.push(id);
        for (const next of edges.get(id)!) {
          indegree.set(next, indegree.get(next)! - 1);
          if (indegree.get(next) === 0) {
            ready.push(next);
            ready.sort();
          }
        }
      }
      if (ordered.length !== ids.length) {
        conflict(`${path}.order`);
        return clone(ours);
      }
      return ordered.map((id) => values.get(id));
    }
    conflict(path);
    return clone(ours);
  };
  const value = merge(
    editableDocument(base),
    editableDocument(local),
    editableDocument(remote),
    "",
  ) as ReturnType<typeof editableDocument>;
  if (conflicts.size) return { session: null, conflicts: [...conflicts] };
  // An unfinished title is a legitimate local draft. Validate cross-field
  // consistency when the original draft is valid, without rejecting typing.
  value.days = value.days.map((day) => ({
    ...day,
    blocks: mapBlocks(day.blocks, (block) => block),
  }));
  const original = editableSessionSchema.safeParse(editableDocument(local));
  const checked = editableSessionSchema.safeParse(value);
  if (checked.success) {
    return { session: { ...remote, ...checked.data }, conflicts: [] };
  }
  const priorIssues = new Set(
    original.success
      ? []
      : original.error.issues.map(
          (issue) => `${issue.path.join(".")}:${issue.message}`,
        ),
  );
  const newIssues = checked.error.issues.filter(
    (issue) => !priorIssues.has(`${issue.path.join(".")}:${issue.message}`),
  );
  if (newIssues.length)
    return {
      session: null,
      conflicts: newIssues.map((issue) => issue.path.join(".")),
    };
  return { session: { ...remote, ...value }, conflicts: [] };
}
