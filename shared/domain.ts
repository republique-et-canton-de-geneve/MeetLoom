import { DEFAULT_SOUND, INITIAL_RUN } from "./model.js";
import type {
  Block,
  Column,
  Day,
  Locale,
  PublicBlock,
  PublicSession,
  Role,
  RunState,
  Session,
  SoundSettings,
} from "./model.js";

const BUILTIN_COLUMNS = ["description", "facilitator"] as const;
const id = () => globalThis.crypto.randomUUID();

export interface DurationNode {
  duration: number;
  kind?: Block["kind"];
  children?: DurationNode[];
  rooms?: { blocks: DurationNode[] }[];
}
export function blockDuration(block: DurationNode): number {
  if (block.kind === "note") return 0;
  if (block.kind === "group")
    return (block.children ?? []).reduce(
      (sum, child) => sum + blockDuration(child),
      0,
    );
  if (block.kind === "parallel")
    return Math.max(
      0,
      ...(block.rooms ?? []).map((room) =>
        room.blocks.reduce((sum, child) => sum + blockDuration(child), 0),
      ),
    );
  return block.duration;
}
/** Every container and descendant, including each parallel room. */
export function allBlocks<T extends PublicBlock>(blocks: readonly T[]): T[] {
  return blocks.flatMap((block) => [
    block,
    ...allBlocks((block.children ?? []) as T[]),
    ...(block.rooms ?? []).flatMap((room) => allBlocks(room.blocks as T[])),
  ]);
}
/** Post-order mapper; container durations are always recalculated from children. */
export function mapBlocks<T extends PublicBlock>(
  blocks: readonly T[],
  map: (block: T) => T,
): T[] {
  return blocks.map((block) => {
    const result = map({
      ...block,
      ...(block.children
        ? { children: mapBlocks(block.children as T[], map) }
        : {}),
      ...(block.rooms
        ? {
            rooms: block.rooms.map((room) => ({
              ...room,
              blocks: mapBlocks(room.blocks as T[], map),
            })),
          }
        : {}),
    } as T);
    return { ...result, duration: blockDuration(result) };
  });
}
/** The linear timer visits activities inside groups; notes are informational.
 * A parallel block is one step lasting as long as its longest room. */
export function runnableBlocks<T extends PublicBlock>(
  blocks: readonly T[],
): T[] {
  return blocks.flatMap((block) =>
    block.kind === "group"
      ? runnableBlocks((block.children ?? []) as T[])
      : block.kind === "note"
        ? []
        : [block],
  );
}

/** Whole-minute proportional scaling of the timed activities of a list
 * (nested groups included) to a target total, using largest remainders so
 * the result adds up exactly. */
function scaleActivities<T extends PublicBlock>(
  blocks: T[],
  target: number,
): T[] {
  // Nested groups are walked; a nested parallel block keeps its own plan.
  const walk = (items: readonly T[]): T[] =>
    items.flatMap((block) =>
      block.kind === "group"
        ? walk((block.children ?? []) as T[])
        : block.kind === "note" || block.kind === "parallel"
          ? []
          : [block],
    );
  const leaves = walk(blocks);
  const total = leaves.reduce((sum, block) => sum + block.duration, 0);
  if (!leaves.length || total <= 0) return blocks;
  const raw = leaves.map((block) => (block.duration * target) / total);
  const scaled = raw.map((value) => Math.floor(value + 1e-9));
  let remainder = target - scaled.reduce((sum, value) => sum + value, 0);
  raw
    .map((value, index) => ({ index, fraction: value - scaled[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    .forEach(({ index }) => {
      if (remainder-- > 0) scaled[index]++;
    });
  const next = new Map(leaves.map((block, index) => [block.id, scaled[index]]));
  return mapBlocks(blocks, (block) =>
    next.has(block.id) ? { ...block, duration: next.get(block.id)! } : block,
  );
}

/** Spreads a parallel block's actual time (whole minutes) over its rooms.
 * All rooms ran at the same time: the longest room(s) take the actual time,
 * their activities scaled proportionally; shorter rooms keep their plan,
 * unless the actual time is shorter, which caps them. */
function spreadParallelActual<T extends PublicBlock>(
  block: T,
  minutes: number,
): T {
  const rooms = block.rooms ?? [];
  const totals = rooms.map((room) =>
    room.blocks.reduce((sum, child) => sum + blockDuration(child), 0),
  );
  const longest = Math.max(0, ...totals);
  return {
    ...block,
    rooms: rooms.map((room, index) => {
      const target =
        totals[index] === longest ? minutes : Math.min(totals[index], minutes);
      return target === totals[index]
        ? room
        : { ...room, blocks: scaleActivities(room.blocks as T[], target) };
    }),
  };
}

/** Adds time to a timed step. A parallel block's duration comes from its
 * rooms, so the time goes to the last activity of its longest room. */
function extendBlock<T extends PublicBlock>(
  blocks: readonly T[],
  id: string,
  minutes: number,
): T[] {
  const lengthen = (items: readonly T[]): T[] => {
    const last = items.at(-1);
    if (!last) return [...items];
    return [
      ...items.slice(0, -1),
      last.kind === "parallel" || last.kind === "group"
        ? extendContainer(last)
        : { ...last, duration: last.duration + minutes },
    ];
  };
  const extendContainer = (block: T): T => {
    if (block.kind === "group")
      return { ...block, children: lengthen((block.children ?? []) as T[]) };
    const rooms = block.rooms ?? [];
    const lengths = rooms.map((room) =>
      room.blocks.reduce((sum, child) => sum + blockDuration(child), 0),
    );
    const longest = lengths.indexOf(Math.max(...lengths));
    if (longest < 0 || !rooms[longest].blocks.length)
      return { ...block, duration: block.duration + minutes };
    return {
      ...block,
      rooms: rooms.map((room, index) =>
        index === longest
          ? { ...room, blocks: lengthen(room.blocks as T[]) }
          : room,
      ),
    };
  };
  return mapBlocks(blocks, (block) =>
    block.id !== id
      ? block
      : block.kind === "parallel"
        ? extendContainer(block)
        : { ...block, duration: block.duration + minutes },
  );
}
export function cloneBlockTree(block: Block): Block {
  return mapBlocks([structuredClone(block)], (value) => ({
    ...value,
    id: id(),
    ...(value.rooms
      ? { rooms: value.rooms.map((room) => ({ ...room, id: id() })) }
      : {}),
  }))[0];
}

export function newBlock(
  locale: Locale,
  overrides: Partial<Block> = {},
): Block {
  const block: Block = {
    id: id(),
    title: locale === "fr" ? "Nouvelle activité" : "New activity",
    description: "",
    duration: 10,
    category: "discussion",
    facilitator: "",
    section: "",
    fields: {},
    ...overrides,
  };
  if (block.kind === "group") block.children ??= [];
  if (block.kind === "parallel") block.rooms ??= [];
  block.duration = blockDuration(block);
  return block;
}

/** Calendar date (YYYY-MM-DD) of an instant in a timezone, or in the
 * runtime's own timezone when none is given. `toISOString()` would give the
 * UTC date, which is yesterday in Geneva until 01:00 or 02:00. */
export function localDate(at: Date = new Date(), timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) =>
    parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const DEFAULT_TIMEZONE = "Europe/Zurich";

export function createSession(
  userId: string,
  title: string,
  locale: Locale,
  demo = false,
  at: Date = new Date(),
): Session {
  const fr = locale === "fr";
  const day: Day = {
    id: id(),
    title: fr ? "Jour 1" : "Day 1",
    date: localDate(at, DEFAULT_TIMEZONE),
    startTime: "09:00",
    blocks: [],
  };
  const columns: Column[] = [
    {
      id: "description",
      label: fr ? "Description" : "Description",
      visibility: "public",
      visible: true,
    },
    {
      id: "facilitator",
      label: fr ? "Intervenant" : "Facilitator",
      visibility: "public",
      visible: true,
    },
    {
      id: "notes",
      label: fr ? "Notes de présentation" : "Speaker notes",
      visibility: "team",
      visible: true,
    },
    {
      id: "additional",
      label: fr ? "Informations supplémentaires" : "Additional information",
      visibility: "team",
      visible: false,
    },
    {
      id: "objectives",
      label: fr ? "Objectifs" : "Objectives",
      visibility: "team",
      visible: false,
    },
    {
      id: "materials",
      label: fr ? "Matériel" : "Materials",
      kind: "materials",
      visibility: "team",
      visible: false,
    },
    {
      id: "instructions",
      label: fr ? "Instructions" : "Instructions",
      visibility: "team",
      visible: false,
    },
    {
      id: "context",
      label: fr ? "Contexte" : "Background",
      visibility: "team",
      visible: false,
    },
  ];
  if (demo) {
    const agenda: Array<Partial<Block>> = fr
      ? [
          {
            title: "Bienvenue et intentions",
            duration: 10,
            category: "opening",
            description:
              "Partager le résultat attendu et donner la parole à chacun.",
            section: "Ouvrir la discussion",
            fields: {
              notes:
                "Rappeler que chaque idée peut être discutée. Inviter les personnes qui parlent peu.",
            },
          },
          {
            title: "Ce qui fonctionne déjà",
            duration: 15,
            category: "discussion",
            description:
              "Identifier ensemble les pratiques utiles à conserver.",
            section: "Ouvrir la discussion",
          },
          {
            title: "Dessiner les prochaines étapes",
            duration: 25,
            category: "activity",
            description:
              "Construire trois propositions concrètes en petits groupes.",
            section: "Construire ensemble",
            fields: {
              notes:
                "À mi-parcours, demander aux groupes de choisir une personne pour la restitution.",
            },
          },
          {
            title: "Pause",
            duration: 10,
            category: "break",
            description: "Prendre un moment pour souffler.",
            section: "Construire ensemble",
          },
          {
            title: "Choisir une expérimentation",
            duration: 20,
            category: "decision",
            description:
              "Comparer les propositions et retenir une action réalisable cette semaine.",
            section: "Passer à l’action",
          },
          {
            title: "Engagements et clôture",
            duration: 10,
            category: "closing",
            description: "Nommer les responsables et partager un dernier mot.",
            section: "Passer à l’action",
          },
        ]
      : [
          {
            title: "Welcome and intentions",
            duration: 10,
            category: "opening",
            description: "Share the desired outcome and hear from everyone.",
            section: "Open the conversation",
            fields: {
              notes:
                "Invite quieter participants to contribute. Every idea can be discussed.",
            },
          },
          {
            title: "What already works",
            duration: 15,
            category: "discussion",
            description: "Identify useful practices to keep together.",
            section: "Open the conversation",
          },
          {
            title: "Design the next steps",
            duration: 25,
            category: "activity",
            description: "Build three concrete proposals in small groups.",
            section: "Create together",
            fields: {
              notes:
                "Halfway through, ask each group to choose a spokesperson.",
            },
          },
          {
            title: "Break",
            duration: 10,
            category: "break",
            description: "Take a moment to recharge.",
            section: "Create together",
          },
          {
            title: "Choose an experiment",
            duration: 20,
            category: "decision",
            description:
              "Compare proposals and choose one action to try this week.",
            section: "Move to action",
          },
          {
            title: "Commitments and closing",
            duration: 10,
            category: "closing",
            description: "Agree who will do what and share a closing thought.",
            section: "Move to action",
          },
        ];
    day.blocks = agenda.map((block) => newBlock(locale, block));
  }
  const now = at.toISOString();
  return {
    id: id(),
    title,
    description: "",
    timezone: DEFAULT_TIMEZONE,
    ownerId: userId,
    days: [day],
    columns,
    sound: { ...DEFAULT_SOUND },
    run: { ...INITIAL_RUN, dayId: day.id },
    version: 1,
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
}

const minuteOfDay = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

export interface ScheduledBlock<T extends PublicBlock = Block> {
  block: T;
  startMinute: number;
  endMinute: number;
  gapMinutes: number;
  conflict: boolean;
}
export interface ScheduledTreeBlock<
  T extends PublicBlock = Block,
> extends ScheduledBlock<T> {
  depth: number;
  roomPath: string[];
}
function blockAnchor(block: PublicBlock): number | null {
  if (block.lockedStart !== undefined) return minuteOfDay(block.lockedStart);
  if (block.kind === "group") {
    let before = 0;
    for (const child of block.children ?? []) {
      const anchor = blockAnchor(child);
      if (anchor !== null) return anchor - before;
      before += blockDuration(child);
    }
  }
  return null;
}
/** Container duration is work time; its clock span also includes locked gaps.
 * All rooms start together. Internal locks remain explicit and expose overlaps. */
export function scheduleTreeDay<T extends PublicBlock>(day: {
  startTime: string;
  blocks: T[];
}): ScheduledTreeBlock<T>[] {
  const sequence = (
    blocks: T[],
    initial: number,
    depth: number,
    roomPath: string[],
    backCalculate: boolean,
  ): ScheduledTreeBlock<T>[] => {
    let cursor = initial;
    if (backCalculate) {
      let before = 0;
      for (const block of blocks) {
        const anchor = blockAnchor(block);
        if (anchor !== null) {
          cursor = anchor - before;
          break;
        }
        before += blockDuration(block);
      }
    }
    return blocks.flatMap((block, index) => {
      // The day's first block always starts at the day's start time: it is
      // the day's own lock. Later locks leave gaps or expose overlaps.
      const startMinute =
        depth === 0 && index === 0 ? initial : (blockAnchor(block) ?? cursor);
      // Agenda times are whole minutes: a sub-minute difference (from a
      // fractional legacy duration, or a lock set at a displayed time) is
      // neither a gap nor an overlap.
      const gapMinutes =
        Math.abs(startMinute - cursor) < 1 ? 0 : startMinute - cursor;
      const children =
        block.kind === "group"
          ? sequence(
              (block.children ?? []) as T[],
              startMinute,
              depth + 1,
              roomPath,
              false,
            )
          : block.kind === "parallel"
            ? (block.rooms ?? []).flatMap((room) =>
                sequence(
                  room.blocks as T[],
                  startMinute,
                  depth + 1,
                  [...roomPath, room.title],
                  false,
                ),
              )
            : [];
      const endMinute =
        block.kind === "group" || block.kind === "parallel"
          ? Math.max(startMinute, ...children.map((row) => row.endMinute))
          : startMinute + blockDuration(block);
      cursor = endMinute;
      return [
        {
          block,
          startMinute,
          endMinute,
          gapMinutes,
          conflict: gapMinutes < 0 || children.some((row) => row.conflict),
          depth,
          roomPath,
        },
        ...children,
      ];
    });
  };
  return sequence(day.blocks, minuteOfDay(day.startTime), 0, [], false);
}
export function scheduleDay<T extends PublicBlock>(day: {
  startTime: string;
  blocks: T[];
}): ScheduledBlock<T>[] {
  return scheduleTreeDay(day).filter((row) => row.depth === 0);
}

/** Resolve the planned wall clock in the agenda timezone, independently of the
 * server's timezone. Ambiguous autumn times use the first occurrence; missing
 * spring-forward times are rejected instead of silently shifting the agenda. */
export function plannedStartTimestamp(
  session: Pick<Session, "days" | "timezone">,
  dayId: string,
  blockId?: string,
): number {
  const day = session.days.find((value) => value.id === dayId);
  if (!day) throw new Error("Unknown day");
  const row = scheduleTreeDay(day).find((value) =>
    blockId === undefined
      ? value.block.kind !== "group" &&
        value.block.kind !== "parallel" &&
        value.block.kind !== "note"
      : value.block.id === blockId,
  );
  if (!row) throw new Error("No block to start");
  const target =
    Math.round(
      (new Date(`${day.date}T00:00:00.000Z`).getTime() +
        row.startMinute * 60_000) /
        1000,
    ) * 1000;
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: session.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wall = (timestamp: number) => {
    const parts = Object.fromEntries(
      format.formatToParts(timestamp).map((part) => [part.type, part.value]),
    );
    const date = new Date(0);
    date.setUTCFullYear(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
    );
    date.setUTCHours(
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      0,
    );
    return date.getTime();
  };
  const candidates = [-36, 0, 36]
    .map((hours) => {
      const sample = target + hours * 3_600_000;
      return target - (wall(sample) - sample);
    })
    .filter(
      (candidate) => Number.isFinite(candidate) && wall(candidate) === target,
    );
  if (!candidates.length)
    throw new Error("Planned time does not exist in this timezone");
  return Math.min(...candidates);
}

export function formatTime(minutes: number): string {
  const normalized = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${Math.floor(normalized / 60)
    .toString()
    .padStart(2, "0")}:${(normalized % 60).toString().padStart(2, "0")}`;
}

/** Sum of activity durations in minutes; locked gaps are not activities. */
export const totalDuration = (session: {
  days: Array<{ blocks: DurationNode[] }>;
}): number =>
  session.days.reduce(
    (sum, day) =>
      sum + day.blocks.reduce((s, block) => s + blockDuration(block), 0),
    0,
  );

/** Security boundary: intentionally construct every nested object from a whitelist. */
export function publicProjection(
  session: Session | PublicSession,
): PublicSession {
  const columns = session.columns
    .filter((column) => column.visibility === "public")
    .map((column) => ({
      id: column.id,
      ...(["text", "materials", "tasks"].includes(column.kind ?? "")
        ? { kind: column.kind }
        : {}),
      label: column.label,
      visibility: "public" as const,
      visible: column.visible,
    }));
  const publicIds = new Set(columns.map((column) => column.id));
  const publicFields = columns.filter(
    (column) =>
      !BUILTIN_COLUMNS.includes(column.id as (typeof BUILTIN_COLUMNS)[number]),
  );
  const projectBlock = (block: Block | PublicBlock): PublicBlock => {
    const projected: PublicBlock = {
      id: block.id,
      title: block.title,
      duration: blockDuration(block),
      category: block.category,
      section: block.section,
      fields: Object.fromEntries(
        publicFields.flatMap((column) =>
          Object.hasOwn(block.fields, column.id)
            ? [[column.id, block.fields[column.id]]]
            : [],
        ),
      ),
    };
    if (["activity", "note", "group", "parallel"].includes(block.kind ?? ""))
      projected.kind = block.kind;
    if (block.kind === "group")
      projected.children = (block.children ?? []).map(projectBlock);
    if (block.kind === "parallel")
      projected.rooms = (block.rooms ?? []).map((room) => ({
        id: room.id,
        title: room.title,
        blocks: room.blocks.map(projectBlock),
      }));
    if (block.lockedStart !== undefined)
      projected.lockedStart = block.lockedStart;
    if (publicIds.has("description") && block.description !== undefined)
      projected.description = block.description;
    if (publicIds.has("facilitator") && block.facilitator !== undefined)
      projected.facilitator = block.facilitator;
    return projected;
  };
  const days = session.days.map((day) => ({
    id: day.id,
    title: day.title,
    date: day.date,
    startTime: day.startTime,
    blocks: day.blocks.map(projectBlock),
  }));
  const run = session.run;
  const pages = pageProjection(session.pages);
  const usedCategories = new Set(
    days.flatMap((day) => allBlocks(day.blocks).map((block) => block.category)),
  );
  return {
    id: session.id,
    ...(session.pages
      ? {
          pages,
          contentOrder: orderedContent({
            days,
            pages,
            contentOrder: session.contentOrder,
          }),
        }
      : {}),
    title: session.title,
    description: session.description,
    ...(session.categories
      ? {
          categories: session.categories
            .filter((category) => usedCategories.has(category.id))
            .map((category) => ({
              id: category.id,
              label: category.label,
              color: category.color,
            })),
        }
      : {}),
    timezone: session.timezone,
    days,
    columns,
    version: session.version,
    run: {
      status: run.status,
      dayId: run.dayId,
      blockId: run.blockId,
      startedAt: run.startedAt,
      elapsedBeforePause: run.elapsedBeforePause,
      runStartedAt: run.runStartedAt,
      completedDuration: run.completedDuration,
      autoAdvance: run.autoAdvance,
      revision: run.revision,
      ...(run.plannedTotal !== undefined
        ? { plannedTotal: run.plannedTotal }
        : {}),
      ...(run.plannedDurations
        ? {
            plannedDurations: Object.fromEntries(
              allBlocks(
                days.find((day) => day.id === run.dayId)?.blocks ?? [],
              ).flatMap((block) =>
                Object.hasOwn(run.plannedDurations!, block.id) &&
                typeof run.plannedDurations![block.id] === "number" &&
                Number.isFinite(run.plannedDurations![block.id])
                  ? [[block.id, run.plannedDurations![block.id]]]
                  : [],
              ),
            ),
          }
        : {}),
      ...(run.actualDurations
        ? {
            actualDurations: Object.fromEntries(
              allBlocks(
                days.find((day) => day.id === run.dayId)?.blocks ?? [],
              ).flatMap((block) =>
                Object.hasOwn(run.actualDurations!, block.id) &&
                typeof run.actualDurations![block.id] === "number" &&
                Number.isFinite(run.actualDurations![block.id])
                  ? [[block.id, run.actualDurations![block.id]]]
                  : [],
              ),
            ),
          }
        : {}),
    },
  };
}

export const can = (role: Role, action: "edit" | "run" | "share"): boolean => {
  if (role === "owner") return true;
  if (role === "editor") return action !== "share";
  return role === "facilitator" && action === "run";
};

export function elapsedSeconds(run: RunState, now: number): number {
  return Math.max(
    0,
    run.elapsedBeforePause +
      (run.status === "running" && run.startedAt !== null
        ? Math.max(0, now - run.startedAt) / 1000
        : 0),
  );
}

export function warningThresholdSeconds(
  sound: SoundSettings,
  durationSeconds: number,
): number | null {
  if (
    !sound.enabled ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  )
    return null;
  const threshold =
    sound.mode === "minutes"
      ? sound.value * 60
      : (durationSeconds * sound.value) / 100;
  return Number.isFinite(threshold) &&
    threshold > 0 &&
    threshold < durationSeconds
    ? threshold
    : null;
}

/** Caller remembers alreadyPlayed per block execution. Large ticks still cross the threshold. */
export function shouldPlayWarning(
  sound: SoundSettings,
  durationSeconds: number,
  previousRemaining: number,
  remaining: number,
  alreadyPlayed = false,
): boolean {
  const threshold = warningThresholdSeconds(sound, durationSeconds);
  return (
    !alreadyPlayed &&
    threshold !== null &&
    previousRemaining > threshold &&
    remaining <= threshold &&
    remaining > 0
  );
}

type TimedSession =
  | Pick<Session, "days" | "run" | "sound">
  | (PublicSession & { sound?: SoundSettings });
const plannedBlockSeconds = (
  run: RunState,
  block: PublicBlock | null | undefined,
): number => {
  if (!block) return 0;
  return run.plannedDurations && Object.hasOwn(run.plannedDurations, block.id)
    ? run.plannedDurations[block.id]
    : block.duration * 60;
};
/**
 * A day's blocks with new durations (seconds per timed step, from a run):
 * whole minutes rounded down when `actual`, and a parallel step spread over
 * its longest room like the timer does. Blocks without a value keep theirs.
 */
export function withStepDurations<D extends { id: string; blocks: Block[] }>(
  days: D[],
  dayId: string,
  durations: Record<string, number>,
  actual = true,
): D[] {
  return days.map((day) =>
    day.id !== dayId
      ? day
      : {
          ...day,
          blocks: mapBlocks(day.blocks, (block) => {
            if (!Object.hasOwn(durations, block.id)) return block;
            if (actual && block.kind === "parallel")
              return spreadParallelActual(
                block,
                Math.floor(durations[block.id] / 60 + 1e-9),
              );
            // Whole minutes, rounded down: the agenda never shows seconds.
            const duration = actual
              ? Math.floor(durations[block.id] / 60 + 1e-9)
              : durations[block.id] / 60;
            if (!Number.isFinite(duration) || duration < 0 || duration > 1440)
              throw new Error("Actual duration exceeds agenda limit");
            return { ...block, duration };
          }),
        },
  );
}

export function timerView(session: TimedSession, now = Date.now()) {
  const day = session.days.find(
    (candidate) => candidate.id === session.run.dayId,
  );
  const block =
    runnableBlocks(day?.blocks ?? []).find(
      (candidate) => candidate.id === session.run.blockId,
    ) ?? null;
  const elapsed = elapsedSeconds(session.run, now);
  const duration = (block?.duration ?? 0) * 60;
  const remaining = duration - elapsed;
  const threshold = session.sound
    ? warningThresholdSeconds(session.sound, duration)
    : null;
  const active =
    session.run.status === "running" || session.run.status === "paused";
  // Delta is the projected end of the day against the immutable durations
  // captured at the actual start: time already spent (pauses included), what
  // is left of the current block and the current durations of the blocks still
  // to come. Overruns, early moves and durations edited or extended during the
  // run all show up. Blocks added during the run had no planned time. The
  // scheduled clock/date and gaps between locked starts do not define the
  // origin of the delivery clock.
  const playable = runnableBlocks(day?.blocks ?? []);
  const upcoming = block
    ? playable.slice(playable.findIndex((value) => value.id === block.id) + 1)
    : [];
  const plannedUpcoming = (value: PublicBlock) =>
    session.run.plannedDurations
      ? (session.run.plannedDurations[value.id] ?? 0)
      : value.duration * 60;
  const delta =
    active &&
    session.run.runStartedAt !== null &&
    session.run.plannedTotal !== undefined
      ? // Projected end against the day planned at the start: a block
        // removed ahead saves its time, a block added costs its duration.
        Math.max(0, now - session.run.runStartedAt) / 1000 +
        Math.max(0, remaining) +
        upcoming.reduce((sum, value) => sum + value.duration * 60, 0) -
        session.run.plannedTotal
      : active && session.run.runStartedAt !== null
        ? Math.max(0, now - session.run.runStartedAt) / 1000 -
          session.run.completedDuration +
          Math.max(0, remaining) -
          plannedBlockSeconds(session.run, block) +
          upcoming.reduce(
            (sum, value) => sum + value.duration * 60 - plannedUpcoming(value),
            0,
          )
        : 0;
  const waiting =
    session.run.status === "running" &&
    session.run.startedAt !== null &&
    session.run.elapsedBeforePause === 0 &&
    session.run.startedAt > now;
  const startsIn = waiting ? (session.run.startedAt! - now) / 1000 : 0;
  // What is left of the whole day at the current durations: the rest of the
  // current block (nothing once it overruns) and every block still to come.
  const dayRemaining = block
    ? startsIn +
      Math.max(0, remaining) +
      upcoming.reduce((sum, value) => sum + value.duration * 60, 0)
    : 0;
  return {
    block,
    /** Seconds until a scheduled start that is still ahead, otherwise 0. */
    startsInSeconds: startsIn,
    /** Seconds left until the end of the day's last block. */
    dayRemainingSeconds: dayRemaining,
    /** When the day is expected to end (epoch milliseconds), or null. */
    projectedEnd: active && block ? now + dayRemaining * 1000 : null,
    remainingSeconds: block ? remaining : 0,
    elapsedSeconds: elapsed,
    progress: duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0,
    deltaSeconds: delta,
    warning: active && threshold !== null && remaining <= threshold,
  };
}

export type RunAction =
  | "start"
  | "pause"
  | "resume"
  | "next"
  | "previous"
  | "stop"
  | "reset"
  | "extend"
  | "restore-plan"
  | "apply-actual"
  | "sync"
  | "configure";
export interface RunInput {
  dayId?: string;
  blockId?: string;
  seconds?: number;
  autoAdvance?: boolean;
  startMode?: "now" | "planned";
}

/** Editing the just-completed block in automatic mode reallocates elapsed time
 * from the next block. Manual navigation deliberately invalidates this boundary.
 * The immutable baseline and elapsed time excluding pauses are preserved. */
export function reconcileAutomaticExtension(
  previous: Session,
  candidate: Session,
  now = Date.now(),
): Session {
  const run = candidate.run,
    boundary = run.lastAutoAdvance;
  if (
    !boundary ||
    !run.autoAdvance ||
    run.status === "idle" ||
    run.revision !== previous.run.revision
  )
    return candidate;
  const oldBlock = runnableBlocks(
    previous.days.find((day) => day.id === run.dayId)?.blocks ?? [],
  ).find((block) => block.id === boundary.blockId);
  const changed = runnableBlocks(
    candidate.days.find((day) => day.id === run.dayId)?.blocks ?? [],
  ).find((block) => block.id === boundary.blockId);
  if (!oldBlock || !changed || changed.duration <= oldBlock.duration)
    return candidate;
  const extension = (changed.duration - oldBlock.duration) * 60;
  const afterBoundary =
    run.status === "finished"
      ? Math.max(0, now - boundary.endedAt) / 1000
      : elapsedSeconds(run, now);
  const elapsed = boundary.elapsed + afterBoundary;
  const rewind = changed.duration * 60 > elapsed;
  const next: RunState = {
    ...run,
    revision: run.revision + 1,
    actualDurations: {
      ...run.actualDurations,
      [boundary.blockId]:
        boundary.actualBefore + (rewind ? 0 : changed.duration * 60),
    },
  };
  if (rewind) {
    next.status = run.status === "paused" ? "paused" : "running";
    next.blockId = boundary.blockId;
    next.completedDuration = boundary.completedBefore;
    next.elapsedBeforePause = elapsed;
    next.startedAt = next.status === "running" ? now : null;
    delete next.lastAutoAdvance;
  } else {
    next.lastAutoAdvance = {
      ...boundary,
      elapsed: changed.duration * 60,
      endedAt: boundary.endedAt + extension * 1000,
    };
    if (run.status !== "finished") {
      next.elapsedBeforePause = Math.max(0, afterBoundary - extension);
      next.startedAt = run.status === "running" ? now : null;
    }
  }
  return { ...candidate, run: next };
}

/** Pure state transition. The persistence layer owns Session.version and updatedAt. */
export function transitionRun(
  session: Session,
  action: RunAction,
  input: RunInput = {},
  now = Date.now(),
): Session {
  if (!Number.isFinite(now)) throw new Error("Invalid timestamp");
  if (action === "sync") {
    if (session.run.status !== "running" || !session.run.autoAdvance)
      return session;
    let result = session;
    // Advance at the actual boundary, carrying elapsed time across polling gaps.
    for (let guard = 0; guard < 1001; guard++) {
      const current = timerView(result, now);
      if (
        !current.block ||
        current.remainingSeconds > 0 ||
        result.run.status !== "running"
      )
        return result;
      const boundary = now + current.remainingSeconds * 1000;
      const lastAutoAdvance: NonNullable<RunState["lastAutoAdvance"]> = {
        blockId: current.block.id,
        elapsed: elapsedSeconds(result.run, boundary),
        actualBefore: result.run.actualDurations?.[current.block.id] ?? 0,
        completedBefore: result.run.completedDuration,
        endedAt: boundary,
      };
      result = transitionRun(result, "next", {}, boundary);
      result = { ...result, run: { ...result.run, lastAutoAdvance } };
    }
    return result;
  }
  if (
    action === "extend" &&
    input.blockId &&
    input.blockId !== session.run.blockId
  ) {
    const target = runnableBlocks(
      session.days.find((day) => day.id === session.run.dayId)?.blocks ?? [],
    ).find((block) => block.id === input.blockId);
    const seconds = input.seconds ?? 60;
    if (
      !session.run.autoAdvance ||
      session.run.lastAutoAdvance?.blockId !== input.blockId ||
      !target ||
      !Number.isInteger(seconds) ||
      seconds <= 0 ||
      target.duration + seconds / 60 > 1440
    )
      throw new Error(
        "Only the last automatic block can be extended after transition",
      );
    const candidate = {
      ...session,
      days: session.days.map((day) =>
        day.id !== session.run.dayId
          ? day
          : {
              ...day,
              blocks: extendBlock(day.blocks, target.id, seconds / 60),
            },
      ),
    };
    return reconcileAutomaticExtension(session, candidate, now);
  }
  const current = session.run;
  const run: RunState = { ...current };
  if (
    [
      "start",
      "reset",
      "next",
      "previous",
      "stop",
      "restore-plan",
      "apply-actual",
      "configure",
    ].includes(action)
  )
    delete run.lastAutoAdvance;
  let days = session.days;
  const day = days.find((candidate) => candidate.id === current.dayId);
  const playable = runnableBlocks(day?.blocks ?? []);
  const index = playable.findIndex((block) => block.id === current.blockId);
  const block = index >= 0 ? playable[index] : undefined;
  if (action === "reset") {
    const dayId = input.dayId ?? current.dayId;
    if (!days.some((candidate) => candidate.id === dayId))
      throw new Error("Unknown day");
    Object.assign(run, INITIAL_RUN, { dayId });
    delete run.plannedDurations;
    delete run.plannedTotal;
    delete run.actualDurations;
  } else if (action === "start") {
    if (input.dayId && !days.some((candidate) => candidate.id === input.dayId))
      throw new Error("Unknown day");
    const chosenDay =
      days.find(
        (candidate) => candidate.id === (input.dayId ?? current.dayId),
      ) ?? days[0];
    const chosenBlocks = runnableBlocks(chosenDay?.blocks ?? []);
    const selected = input.blockId
      ? allBlocks(chosenDay?.blocks ?? []).find(
          (candidate) => candidate.id === input.blockId,
        )
      : undefined;
    const chosenBlock = input.blockId
      ? selected
        ? runnableBlocks([selected])[0]
        : undefined
      : chosenBlocks[0];
    if (!chosenDay || !chosenBlock) throw new Error("No block to start");
    const start =
      input.startMode === "planned"
        ? plannedStartTimestamp(session, chosenDay.id, chosenBlock.id)
        : now;
    // A scheduled start still ahead is accepted: the run counts down until
    // it, then the first block starts on time.
    if (start < 0 || Math.abs(now - start) > 100_000_000_000)
      throw new Error("Invalid planned start");
    Object.assign(run, {
      status: "running",
      dayId: chosenDay.id,
      blockId: chosenBlock.id,
      startedAt: start,
      elapsedBeforePause: 0,
      runStartedAt: start,
      completedDuration: 0,
      autoAdvance: input.autoAdvance ?? current.autoAdvance,
      // Activities inside parallel rooms are captured too, so "restore plan"
      // can undo the actual time spread over the rooms.
      plannedDurations: Object.fromEntries(
        [
          ...chosenBlocks,
          ...chosenBlocks
            .filter((value) => value.kind === "parallel")
            .flatMap((value) => allBlocks([value]).slice(1)),
        ].map((value) => [value.id, value.duration * 60]),
      ),
      plannedTotal: chosenBlocks
        .slice(
          Math.max(
            0,
            chosenBlocks.findIndex((value) => value.id === chosenBlock.id),
          ),
        )
        .reduce((sum, value) => sum + value.duration * 60, 0),
      actualDurations: {},
    });
  } else if (action === "pause" && current.status === "running") {
    run.elapsedBeforePause = elapsedSeconds(current, now);
    run.startedAt = null;
    run.status = "paused";
  } else if (action === "resume" && current.status === "paused") {
    run.startedAt = now;
    run.status = "running";
  } else if (
    action === "stop" &&
    (current.status === "running" || current.status === "paused")
  ) {
    run.elapsedBeforePause = elapsedSeconds(current, now);
    if (block)
      run.actualDurations = {
        ...current.actualDurations,
        [block.id]:
          (current.actualDurations?.[block.id] ?? 0) + run.elapsedBeforePause,
      };
    run.startedAt = null;
    run.status = "finished";
  } else if (
    (action === "next" || action === "previous") &&
    block &&
    (current.status === "running" || current.status === "paused")
  ) {
    const nextIndex = index + (action === "next" ? 1 : -1);
    const next = playable[nextIndex];
    if (action === "previous" && !next) return session;
    const actualDurations = { ...current.actualDurations };
    let resumed = 0;
    if (action === "next")
      actualDurations[block.id] =
        (actualDurations[block.id] ?? 0) + elapsedSeconds(current, now);
    else {
      // Going back treats the advance as a mistake: the clock kept running
      // for the earlier block, which resumes with its own time plus the
      // detour, against its current (possibly edited) duration. The block
      // being left becomes upcoming again.
      resumed =
        (actualDurations[next.id] ?? 0) +
        (actualDurations[block.id] ?? 0) +
        elapsedSeconds(current, now);
      delete actualDurations[block.id];
      delete actualDurations[next.id];
    }
    run.actualDurations = actualDurations;
    run.completedDuration = Math.max(
      0,
      current.completedDuration +
        (action === "next"
          ? plannedBlockSeconds(current, block)
          : -plannedBlockSeconds(current, next)),
    );
    run.elapsedBeforePause = resumed;
    run.blockId = next?.id ?? null;
    run.status = next ? current.status : "finished";
    run.startedAt = next && current.status === "running" ? now : null;
  } else if (
    action === "extend" &&
    block &&
    (current.status === "running" || current.status === "paused")
  ) {
    const seconds = input.seconds ?? 60;
    const duration = block.duration + seconds / 60;
    if (
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      !Number.isInteger(seconds) ||
      duration > 1440
    )
      throw new Error("Invalid extension");
    days = days.map((candidate) =>
      candidate.id === current.dayId
        ? {
            ...candidate,
            blocks: extendBlock(candidate.blocks, block.id, seconds / 60),
          }
        : candidate,
    );
  } else if (action === "restore-plan" || action === "apply-actual") {
    if (current.status !== "finished")
      throw new Error("Finish the run before applying durations");
    const durations =
      action === "restore-plan"
        ? current.plannedDurations
        : current.actualDurations;
    if (!durations) return session;
    days = withStepDurations(
      days,
      current.dayId,
      durations,
      action === "apply-actual",
    );
  } else if (action === "configure" && input.autoAdvance !== undefined)
    run.autoAdvance = input.autoAdvance;
  else return session;
  if (days === session.days && JSON.stringify(run) === JSON.stringify(current))
    return session;
  run.revision = current.revision + 1;
  const result = { ...session, days, run };
  return action === "start" && run.autoAdvance
    ? transitionRun(result, "sync", {}, now)
    : result;
}
import { orderedContent, pageProjection } from "./content.js";
