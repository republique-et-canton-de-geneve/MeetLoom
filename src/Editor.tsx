import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Plus,
  ChevronDown,
  ChevronRight,
  XCircle,
  Clock3,
  CalendarDays,
  GripVertical,
  MoreHorizontal,
  Share2,
  Settings2,
  Sparkles,
  Columns3,
  LockKeyhole,
  LockKeyholeOpen,
  Eye,
  Copy,
  Trash2,
  Undo2,
  Redo2,
  Download,
  FileUp,
  MessageSquare,
  History,
  Check,
  Cloud,
  AlertCircle,
  Maximize2,
  ArrowUp,
  ArrowDown,
  BarChart3,
  Archive,
  X,
  ArrowRight,
} from "lucide-react";
import type {
  Block,
  Category,
  Session,
  User,
  PublicSession,
} from "../shared/model";
import {
  can,
  formatTime,
  newBlock,
  scheduleDay,
  scheduleTreeDay,
  totalDuration,
  type ScheduledBlock,
  allBlocks,
  mapBlocks,
  blockDuration,
  cloneBlockTree,
} from "../shared/domain";
import { useI18n } from "./i18n";
import {
  Avatar,
  Brand,
  durationLabel,
  ErrorBanner,
  LanguageSwitch,
  Loading,
  Inspector,
} from "./ui";
import { useSession } from "./useSession";
import { api, download } from "./api";
import Timer from "./Timer";
import TimerMinimapProgress from "./TimerMinimapProgress";
import { ColumnsPanel, SettingsPanel, SharePanel } from "./panels";
import ImportPanel from "./ImportPanel";
import LifecyclePanel from "./LifecyclePanel";
import AssigneePicker from "./AssigneePicker";
import { exportSessionCsv } from "./export";
import { PrintableAgenda } from "./PrintableAgenda";
import {
  ActualDurationsContext,
  actualDurationLabel,
  ClockField,
  DurationField,
} from "./TimeFields";
import SessionOverview from "./SessionOverview";
import ColumnResizer from "./ColumnResizer";
import { RichTextEditor } from "./RichTextEditor";
import ExportPanel from "./ExportPanel";
import type { PrintOptions } from "./export-options";
import { TasksMaterialsPanel } from "./TasksMaterialsPanel";
import GroupEditor from "./GroupEditor";
import GroupOutline, { type OutlineActions } from "./GroupOutline";
import InsertMenu, { type InsertKind } from "./InsertMenu";
import {
  duplicateBlockInTree,
  insertBlockInto,
  relocateBlock,
  removeBlockFromTree,
  type BlockDestination,
} from "./block-tree";
import {
  categoriesFor,
  categoryColor,
  type CategoryDefinition,
} from "./categories";
import CategoryPanel from "./CategoryPanel";
import SessionMetadata from "./SessionMetadata";
import PresenceBar from "./PresenceBar";
import SessionNavigation from "./SessionNavigation";
import { PageEditor } from "./PageEditor";
import FormEditor from "./FormEditor";
import type { ContentItem } from "../shared/content";
import type { SessionResponse } from "../shared/model";
import HistoryPanel from "./HistoryPanel";
import CommentsPanel from "./CommentsPanel";
import NotificationBell from "./NotificationBell";
import { MentionProvider } from "./MentionContext";
import PublicDiscussion from "./PublicDiscussion";
import {
  DisplayTimeProvider,
  DisplayTimeControl,
  LocalClock,
} from "./DisplayTime";
import { useCommentCounts } from "./useCommentCounts";
import MultiPlanView from "./MultiPlanView";
import AiPanel from "./AiPanel";
import { mergeSessionDraft } from "./session-merge";
import { flushSync } from "react-dom";
import { registerNavigationGuard } from "./navigation";

function useCategoryLabel(overrides?: CategoryDefinition[]) {
  const { locale } = useI18n();
  return (category: Category) =>
    categoriesFor(locale, overrides).find((c) => c.id === category)?.label ??
    category;
}
type Panel =
  | "columns"
  | "share"
  | "settings"
  | "ai"
  | "history"
  | "comments"
  | "import"
  | "overview"
  | "export"
  | "preparation"
  | "categories"
  | "multi-plan"
  | "lifecycle"
  | null;

export default function Editor({
  id,
  user,
  aiEnabled,
  navigate,
}: {
  id: string;
  user: User;
  aiEnabled: boolean;
  navigate: (url: string) => void;
}) {
  const { t, locale } = useI18n();
  const data = useSession(id),
    { session, role, status } = data;
  const commentCounts = useCommentCounts(id);
  useEffect(() => {
    if (!session) return;
    const mark = () => {
      if (document.visibilityState === "visible")
        void api(`/sessions/${session.id}/view`, {
          method: "POST",
          body: JSON.stringify({ version: session.version }),
        }).catch(() => {});
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [session?.id, session?.version]);
  const categoryLabel = useCategoryLabel(session?.categories);
  const categories = categoriesFor(locale, session?.categories).map(
    (c) => c.id,
  );
  const [selectedDay, setSelectedDay] = useState("");
  const [pinnedPageId, setPinnedPageId] = useState("");
  const [aiTarget, setAiTarget] = useState<string | undefined>();
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(
    null,
  );
  const [commentTarget, setCommentTarget] = useState<{
    blockId?: string;
    commentId?: string;
  }>({});
  const initialNavigation = useRef(false);
  useEffect(() => {
    if (!session || initialNavigation.current) return;
    initialNavigation.current = true;
    const query = new URLSearchParams(location.search),
      blockId = query.get("block") ?? undefined,
      commentId = query.get("comment") ?? undefined;
    const hash = new URLSearchParams(location.hash.slice(1)),
      sectionId = hash.get("section") ?? location.hash.replace("#section-", "");
    const page = session.pages?.find(
      (page) =>
        page.id === hash.get("page") ||
        page.sections.some((section) => section.id === sectionId),
    );
    if (page) {
      setSelectedContent({ kind: "page", id: page.id });
      requestAnimationFrame(() =>
        document.getElementById(`section-${sectionId}`)?.scrollIntoView(),
      );
    } else if (blockId || commentId) {
      const target = session.days.find((day) =>
        allBlocks(day.blocks).some((block) => block.id === blockId),
      );
      if (target) setSelectedDay(target.id);
      setCommentTarget({ blockId, commentId });
      setPanel("comments");
    } else if (session.contentOrder?.[0]) {
      const first = session.contentOrder[0];
      if (first.kind === "day") setSelectedDay(first.id);
      else setSelectedContent(first);
    }
  }, [session]);
  const [panel, setPanelState] = useState<Panel>(null);
  const multiLeave = useRef<(() => Promise<void>) | null>(null);
  useEffect(
    () =>
      registerNavigationGuard(async () => {
        try {
          const focused = document.activeElement;
          // Commit local duration/clock drafts before the store is flushed, including
          // browser Back, which does not necessarily blur the focused input itself.
          flushSync(() => {
            if (focused instanceof HTMLElement) focused.blur();
          });
          if (
            focused instanceof HTMLElement &&
            focused.getAttribute("aria-invalid") === "true"
          )
            throw new Error(
              t(
                "Corrigez le champ invalide avant de quitter cette séance.",
                "Correct the invalid field before leaving this session.",
              ),
            );
          await multiLeave.current?.();
          if (session && !(await data.save()))
            throw new Error(
              t(
                "La séance reste ouverte : enregistrez ou résolvez le conflit avant de quitter.",
                "This session remains open: save or resolve the conflict before leaving.",
              ),
            );
          return true;
        } catch (error) {
          data.setError((error as Error).message);
          return false;
        }
      }),
    [id, session, data.save, data.setError, t],
  );
  const setPanel = (next: Panel) => {
    if (panel === "multi-plan" && next !== panel && multiLeave.current) {
      void multiLeave
        .current()
        .then(() => setPanelState(next))
        .catch((error) => data.setError(error.message));
    } else setPanelState(next);
  };
  const [printAgenda, setPrintAgenda] = useState<{
    session: PublicSession;
    privateAudience: boolean;
    options?: PrintOptions;
  } | null>(null);
  useEffect(() => {
    if (!printAgenda) return;
    const clear = () => setPrintAgenda(null);
    window.addEventListener("afterprint", clear, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", clear);
  }, [printAgenda]);
  const [detail, setDetail] = useState<string | null>(null);
  const showDetail = (blockId: string) => {
    setPinnedPageId("");
    setSelectedContent(null);
    setPanel(null);
    setDetail(blockId);
  };
  useEffect(() => {
    if (panel) {
      setDetail(null);
      setPinnedPageId("");
    }
  }, [panel]);
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(false);
      menuButton.current?.focus();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menu]);
  const [compact, setCompact] = useState(false);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(
    new Set(),
  );
  const [zoom, setZoom] = useState(100);
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(`meetloom-widths-${id}`) ?? "{}",
      );
      return Object.fromEntries(
        Object.entries(saved).filter(
          ([, v]) => typeof v === "number" && v >= 120 && v <= 800,
        ),
      ) as Record<string, number>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`meetloom-widths-${id}`, JSON.stringify(widths));
    } catch {
      // Storage unavailable (private browsing): widths stay for this tab.
    }
  }, [id, widths]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [moveToDay, setMoveToDay] = useState("");
  const [groupName, setGroupName] = useState("");
  const [undo, setUndo] = useState<{ before: Session; after: Session }[]>([]),
    [redo, setRedo] = useState<{ before: Session; after: Session }[]>([]);
  const dragId = useRef<string | null>(null);
  const [roomTabs, setRoomTabs] = useState<Record<string, string>>({});
  const titleInputs = useRef(new Map<string, HTMLInputElement>());
  const focusAfterRender = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = focusAfterRender.current;
    const input = id ? titleInputs.current.get(id) : null;
    if (input) {
      input.focus();
      input.select();
      focusAfterRender.current = null;
    }
  });
  const day =
    session?.days.find((d) => d.id === selectedDay) ?? session?.days[0];
  const scheduled = useMemo(() => (day ? scheduleDay(day) : []), [day]);
  const treeRows = useMemo(
    () =>
      new Map(
        (day ? scheduleTreeDay(day) : []).map((row) => [row.block.id, row]),
      ),
    [day],
  );
  if (!session || !day)
    return data.error ? (
      <main className="fatal">
        <ErrorBanner message={data.error} />
        <button onClick={() => navigate("/")}>
          {t("Retour à mes séances", "Back to sessions")}
        </button>
      </main>
    ) : (
      <Loading />
    );
  const editable = can(role, "edit") && !session.lifecycle?.closedAt,
    runnable = can(role, "run") && !session.lifecycle?.closedAt;
  const mutate = (fn: (s: Session) => Session, track = true) => {
    if (!editable) return;
    data.update((current) => {
      const next = fn(current);
      if (track && next !== current) {
        setUndo((previous) => [
          ...previous.slice(-29),
          { before: structuredClone(current), after: structuredClone(next) },
        ]);
        setRedo([]);
      }
      return next;
    });
  };
  const updateDay = (changes: Partial<typeof day>) =>
    mutate((s) => ({
      ...s,
      days: s.days.map((d) => (d.id === day.id ? { ...d, ...changes } : d)),
    }));
  const editBlock = (blockId: string, changes: Partial<Block>) =>
    mutate((s) => ({
      ...s,
      days: s.days.map((d) => ({
        ...d,
        blocks: mapBlocks(d.blocks, (b) =>
          b.id === blockId ? { ...b, ...changes } : b,
        ),
      })),
    }));
  const addBlock = (afterId?: string) => {
    if (
      session.days.reduce((n, d) => n + allBlocks(d.blocks).length, 0) >= 1000
    )
      return;
    const previous =
      day.blocks.find((b) => b.id === afterId) ?? day.blocks.at(-1);
    const block = newBlock(locale, { section: previous?.section ?? "" });
    const blocks = [...day.blocks];
    const index = afterId
      ? blocks.findIndex((b) => b.id === afterId) + 1
      : blocks.length;
    blocks.splice(index, 0, block);
    updateDay({ blocks });
    setDetail(null);
    focusAfterRender.current = block.id;
  };
  const removeBlock = (blockId: string) => {
    updateDay({ blocks: removeBlockFromTree(day.blocks, blockId) });
    setDetail(null);
  };
  const duplicateBlock = (block: Block) => {
    updateDay({ blocks: duplicateBlockInTree(day.blocks, block.id) });
  };
  const moveBlock = (from: string, to: string) => {
    const blocks = [...day.blocks];
    const source = blocks.findIndex((b) => b.id === from),
      target = blocks.findIndex((b) => b.id === to);
    if (source < 0 || target < 0 || source === target) return;
    const [block] = blocks.splice(source, 1);
    blocks.splice(target, 0, block);
    updateDay({ blocks });
  };
  const titleKey = (
    e: KeyboardEvent<HTMLInputElement>,
    block: Block,
    index: number,
    siblings: Block[] = day.blocks,
    listId: string | null = null,
  ) => {
    if (!editable || e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (listId === null) addBlock(block.id);
      else
        insertAt(newBlock(locale, { section: block.section }), {
          listId,
          beforeId: siblings[index + 1]?.id,
        });
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const up = e.key === "ArrowUp";
      if (up ? index > 0 : index < siblings.length - 1) {
        focusAfterRender.current = block.id;
        outlineActions.relocate(block.id, {
          listId,
          beforeId: siblings[index + (up ? -1 : 2)]?.id,
        });
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateBlock(block);
    } else if (
      e.key === "Backspace" &&
      !block.title &&
      index > 0 &&
      session.run.blockId !== block.id
    ) {
      e.preventDefault();
      focusAfterRender.current = siblings[index - 1].id;
      removeBlock(block.id);
    }
  };
  const changeHistory = (back: boolean) => {
    const stack = back ? undo : redo;
    const snapshot = stack.at(-1);
    if (!snapshot) return;
    const result = mergeSessionDraft(
      back ? snapshot.after : snapshot.before,
      back ? snapshot.before : snapshot.after,
      session,
    );
    if (!result.session) {
      data.setError(
        t(
          "Cette action touche une modification plus récente. Elle ne peut pas être annulée automatiquement sans écraser ce travail.",
          "This action overlaps a newer edit. It cannot be undone automatically without overwriting that work.",
        ),
      );
      return;
    }
    if (back) {
      setUndo(stack.slice(0, -1));
      setRedo((previous) => [...previous, snapshot]);
    } else {
      setRedo(stack.slice(0, -1));
      setUndo((previous) => [...previous, snapshot]);
    }
    data.update(() => result.session!);
  };
  const leave = async () => {
    try {
      await multiLeave.current?.();
      if (status === "saved" || (await data.save())) navigate("/");
    } catch (error) {
      data.setError((error as Error).message);
    }
  };
  const flush = async () => {
    if (!(await data.save()))
      throw new Error(
        t(
          "Enregistrez les modifications avant de publier.",
          "Save changes before publishing.",
        ),
      );
    return (await api<SessionResponse>(`/sessions/${session.id}`)).session;
  };
  const selectedPage = session.pages?.find(
    (page) =>
      selectedContent?.kind === "page" && page.id === selectedContent.id,
  );
  const pinnedPage = session.pages?.find((page) => page.id === pinnedPageId);
  const selectedForm = session.forms?.find(
    (form) =>
      selectedContent?.kind === "form" && form.id === selectedContent.id,
  );
  const currentBlock = allBlocks(day.blocks).find((b) => b.id === detail);
  const containsActive = (block: Block) =>
    ["running", "paused"].includes(session.run.status) &&
    allBlocks([block]).some((b) => b.id === session.run.blockId);
  const createBlock = (kind: InsertKind) =>
    newBlock(locale, {
      ...(kind === "activity" ? {} : { kind }),
      ...(kind === "group"
        ? { title: t("Nouveau groupe", "New group") }
        : kind === "parallel"
          ? {
              title: t("Travail en parallèle", "Parallel activities"),
              rooms: [1, 2].map((n) => ({
                id: crypto.randomUUID(),
                title: t(`Salle ${n}`, `Room ${n}`),
                blocks: [],
              })),
            }
          : kind === "note"
            ? { title: t("Note", "Note") }
            : {}),
    });
  const insertAt = (block: Block, destination: BlockDestination) => {
    if (
      session.days.reduce((n, d) => n + allBlocks(d.blocks).length, 0) >= 1000
    )
      return;
    updateDay({ blocks: insertBlockInto(day.blocks, block, destination) });
    focusAfterRender.current = block.id;
  };
  // The day's start time is the first block's start: a stale lock on that
  // block is cleared so it can never contradict the day.
  const setDayStart = (startTime: string) => {
    const [first, ...rest] = day.blocks;
    updateDay({
      startTime,
      ...(first?.lockedStart
        ? { blocks: [{ ...first, lockedStart: undefined }, ...rest] }
        : {}),
    });
  };
  const addContainer = (kind: "note" | "group" | "parallel") =>
    insertAt(createBlock(kind), { listId: null });
  const outlineActions: OutlineActions = {
    change: editBlock,
    open: showDetail,
    remove: removeBlock,
    insert: insertAt,
    relocate: (id, destination) =>
      updateDay({ blocks: relocateBlock(day.blocks, id, destination) }),
    dragId,
    inspected: detail,
    movable: (id) => {
      const found = allBlocks(day.blocks).find((b) => b.id === id);
      return !!found && !containsActive(found);
    },
  };
  const selectedBlocks = day.blocks.filter((b) => selection.has(b.id));
  const clearSelection = () => setSelection(new Set());
  const selectBlock = (blockId: string, checked: boolean) =>
    setSelection((current) => {
      const next = new Set(current);
      if (checked) next.add(blockId);
      else next.delete(blockId);
      return next;
    });
  const copySelection = () => {
    const blocks = day.blocks.flatMap((b) =>
      selection.has(b.id) ? [b, cloneBlockTree(b)] : [b],
    );
    updateDay({ blocks });
    clearSelection();
  };
  const moveSelection = () => {
    if (!moveToDay || moveToDay === day.id) return;
    mutate((s) => ({
      ...s,
      days: s.days.map((d) =>
        d.id === day.id
          ? { ...d, blocks: d.blocks.filter((b) => !selection.has(b.id)) }
          : d.id === moveToDay
            ? { ...d, blocks: [...d.blocks, ...selectedBlocks] }
            : d,
      ),
    }));
    clearSelection();
    setMoveToDay("");
  };
  const separateTime = !!session.editorLayout?.separateTime;
  const customColumns = session.columns.filter(
    (column) =>
      column.visible &&
      (column.id !== "description" ||
        session.editorLayout?.separateDescription),
  );
  const showDescription =
    !session.editorLayout?.separateDescription &&
    session.columns.some(
      (column) => column.id === "description" && column.visible,
    );
  const gridTemplate = `100px ${separateTime ? "82px " : ""}${widths.title ? `${widths.title}px` : "minmax(280px,1.6fr)"} ${customColumns.map((column) => (widths[column.id] ? `${widths[column.id]}px` : column.id === "facilitator" ? "minmax(140px,.65fr)" : "minmax(210px,1fr)")).join(" ")} 35px`;
  const durationControl = (block: Block) => (
    <DurationField
      value={blockDuration(block)}
      readOnly={
        !editable || ["note", "group", "parallel"].includes(block.kind ?? "")
      }
      label={`${t("Durée de", "Duration of")} ${block.title}`}
      change={(duration) => editBlock(block.id, { duration })}
      blockId={block.id}
    />
  );
  const dayDuration = day.blocks.reduce((sum, b) => sum + blockDuration(b), 0);
  const saveText =
    status === "saved"
      ? t("Tout est enregistré", "All changes saved")
      : status === "saving"
        ? t("Enregistrement…", "Saving…")
        : status === "conflict"
          ? t("Conflit à résoudre", "Conflict to resolve")
          : t("Modifications en cours", "Unsaved changes");
  const roleLabel = {
    owner: t("Propriétaire", "Owner"),
    editor: t("Éditeur", "Editor"),
    facilitator: t("Animateur", "Facilitator"),
    viewer: t("Lecteur", "Viewer"),
  }[role];
  const drop = (e: DragEvent, blockId: string, listId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragId.current)
      outlineActions.relocate(dragId.current, { listId, beforeId: blockId });
    dragId.current = null;
  };
  // Every block renders the same way, at the top level or inside a group:
  // a group is only a container around its blocks.
  const actualChip = (block: Block) => {
    const actual =
      session.run.status === "idle"
        ? undefined
        : session.run.actualDurations?.[block.id];
    return actual === undefined ? null : (
      <span
        className="actual-duration"
        title={t("Durée réelle", "Actual duration")}
      >
        {actualDurationLabel(actual)}
      </span>
    );
  };
  // Groups and parallel activities are logical containers: their header
  // only carries the time, the duration computed from their activities and
  // a title, like SessionLab.
  const containerHeader = (
    block: Block,
    startMinute: number,
    dayAnchor: boolean,
    listId: string | null,
  ): ReactNode => (
    <div
      className={`container-header ${containsActive(block) ? "current-block" : ""} ${detail === block.id ? "inspected-row" : ""}`}
      onDragOver={
        editable
          ? (e) => {
              if (!dragId.current) return;
              e.preventDefault();
              e.currentTarget.classList.add("drop-before");
            }
          : undefined
      }
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          e.currentTarget.classList.remove("drop-before");
      }}
      onDrop={
        editable
          ? (e) => {
              e.currentTarget.classList.remove("drop-before");
              drop(e, block.id, listId);
            }
          : undefined
      }
    >
      {editable && (
        <button
          className="drag-handle"
          draggable={!containsActive(block)}
          onDragStart={(e) => {
            dragId.current = block.id;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", block.id);
          }}
          onDragEnd={() => {
            dragId.current = null;
          }}
          aria-label={t("Déplacer le bloc", "Move block")}
        >
          <GripVertical size={17} />
        </button>
      )}
      <div className="container-meta">
        {startTimeCell(block, startMinute, dayAnchor)}
        <span
          className="container-duration"
          title={t(
            "Durée calculée à partir des activités",
            "Duration computed from the activities",
          )}
        >
          ({durationLabel(blockDuration(block))})
        </span>
        {actualChip(block)}
      </div>
      <div className="container-title-row">
        <button
          className="collapse-block"
          aria-expanded={!collapsedBlocks.has(block.id)}
          aria-label={t(
            "Développer ou replier le bloc",
            "Expand or collapse block",
          )}
          onClick={() =>
            setCollapsedBlocks((current) => {
              const next = new Set(current);
              if (next.has(block.id)) next.delete(block.id);
              else next.add(block.id);
              return next;
            })
          }
        >
          {collapsedBlocks.has(block.id) ? (
            <ChevronRight size={18} />
          ) : (
            <ChevronDown size={18} />
          )}
        </button>
        <input
          className="container-title"
          ref={(el) => {
            // Registered like block titles so the minimap can jump here.
            if (el) titleInputs.current.set(block.id, el);
            else titleInputs.current.delete(block.id);
          }}
          value={block.title}
          maxLength={240}
          readOnly={!editable}
          aria-label={
            block.kind === "group"
              ? t("Titre du groupe", "Group title")
              : t(
                  "Titre des activités en parallèle",
                  "Parallel activities title",
                )
          }
          onChange={(e) => editBlock(block.id, { title: e.target.value })}
        />
      </div>
      {editable && (
        <button
          className="icon-button row-delete"
          title={`${t("Supprimer", "Delete")} ${block.title}`}
          aria-label={`${t("Supprimer", "Delete")} ${block.title}`}
          disabled={containsActive(block)}
          onClick={() => removeBlock(block.id)}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
  // Parallel rooms are tabs: an overview side by side, then each room's
  // activities as ordinary rows. Rooms are added and renamed in place.
  const roomsArea = (block: Block): ReactNode => {
    const rooms = block.rooms ?? [];
    const selected =
      roomTabs[block.id] === "overview"
        ? "overview"
        : (rooms.find((room) => room.id === roomTabs[block.id]) ?? rooms[0])
            ?.id;
    const room = rooms.find((candidate) => candidate.id === selected);
    const actual = actualChip(block);
    const updateRooms = (next: NonNullable<Block["rooms"]>) =>
      editBlock(block.id, { rooms: next });
    return (
      <div className="rooms-area">
        <div className="room-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={selected === "overview"}
            className={selected === "overview" ? "active" : ""}
            onClick={() =>
              setRoomTabs((tabs) => ({ ...tabs, [block.id]: "overview" }))
            }
          >
            <Columns3 size={14} />
            {t("Vue d’ensemble", "Overview")}
          </button>
          {rooms.map((candidate) => (
            <button
              key={candidate.id}
              role="tab"
              aria-selected={selected === candidate.id}
              className={selected === candidate.id ? "active" : ""}
              onClick={() =>
                setRoomTabs((tabs) => ({ ...tabs, [block.id]: candidate.id }))
              }
            >
              {candidate.title}
              <small>
                (
                {durationLabel(
                  candidate.blocks.reduce((n, b) => n + blockDuration(b), 0),
                )}
                )
              </small>
              {actual}
            </button>
          ))}
          {editable && (
            <button
              className="room-add"
              onClick={() => {
                const added = {
                  id: crypto.randomUUID(),
                  title: t(
                    `Salle ${rooms.length + 1}`,
                    `Room ${rooms.length + 1}`,
                  ),
                  blocks: [],
                };
                updateRooms([...rooms, added]);
                setRoomTabs((tabs) => ({ ...tabs, [block.id]: added.id }));
              }}
            >
              <Plus size={14} />
              {t("Ajouter une salle", "Add room")}
            </button>
          )}
        </div>
        {selected === "overview" || !room ? (
          <GroupOutline
            block={block}
            editable={editable}
            actions={outlineActions}
          />
        ) : (
          <div className="room-panel" role="tabpanel">
            {editable && (
              <div className="room-toolbar">
                <input
                  value={room.title}
                  maxLength={120}
                  aria-label={t("Nom de la salle", "Room name")}
                  onChange={(e) =>
                    updateRooms(
                      rooms.map((candidate) =>
                        candidate.id === room.id
                          ? { ...candidate, title: e.target.value }
                          : candidate,
                      ),
                    )
                  }
                />
                {rooms.length > 1 && (
                  <button
                    className="icon-button"
                    title={t("Supprimer cette salle", "Delete this room")}
                    aria-label={t("Supprimer cette salle", "Delete this room")}
                    disabled={containsActive(block)}
                    onClick={() =>
                      updateRooms(
                        rooms.filter((candidate) => candidate.id !== room.id),
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            )}
            {room.blocks.map((child, childIndex) => {
              const row = treeRows.get(child.id);
              return row
                ? renderRow(row, childIndex, room.blocks, room.id)
                : null;
            })}
            {editable && (
              <button
                className="outline-add group-drop"
                onClick={() =>
                  insertAt(createBlock("activity"), { listId: room.id })
                }
                onDragOver={(e) => {
                  if (!dragId.current) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.classList.add("drop-here");
                }}
                onDragLeave={(e) =>
                  e.currentTarget.classList.remove("drop-here")
                }
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.classList.remove("drop-here");
                  if (dragId.current)
                    outlineActions.relocate(dragId.current, {
                      listId: room.id,
                    });
                  dragId.current = null;
                }}
              >
                <Plus size={14} />
                {t(
                  "Ajouter une activité à la salle",
                  "Add an activity to the room",
                )}
                <span>
                  {t("ou glissez un bloc ici", "or drag a block here")}
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  };
  const startTimeCell = (
    block: Block,
    startMinute: number,
    dayAnchor: boolean,
  ): ReactNode => (
    <div
      className={`start-time ${block.lockedStart || dayAnchor ? "is-locked" : ""}`}
    >
      <ClockField
        value={formatTime(startMinute)}
        label={`${t("Heure de", "Start time of")} ${block.title}`}
        readOnly={!editable}
        change={(value) =>
          dayAnchor
            ? setDayStart(value)
            : editBlock(block.id, { lockedStart: value })
        }
      />
      <LocalClock
        minute={startMinute}
        date={day.date}
        timezone={session.timezone}
      />
      {dayAnchor ? (
        <span
          className="lock-toggle day-anchor"
          title={t(
            "Premier bloc : il commence toujours à l’heure de début de la journée",
            "First block: it always starts at the day's start time",
          )}
        >
          <LockKeyhole size={12} />
        </span>
      ) : (
        (editable || block.lockedStart) && (
          <button
            className={`lock-toggle ${block.lockedStart ? "" : "unlocked"}`}
            disabled={!editable}
            aria-pressed={!!block.lockedStart}
            title={
              block.lockedStart
                ? t("Déverrouiller cet horaire", "Unlock this time")
                : t("Verrouiller cet horaire", "Lock this time")
            }
            aria-label={
              block.lockedStart
                ? t("Déverrouiller cet horaire", "Unlock this time")
                : t("Verrouiller cet horaire", "Lock this time")
            }
            onClick={(e) => {
              editBlock(block.id, {
                lockedStart: block.lockedStart
                  ? undefined
                  : formatTime(startMinute),
              });
              // A mouse click must not keep an unlocked padlock shown.
              if (e.detail > 0) e.currentTarget.blur();
            }}
          >
            {block.lockedStart ? (
              <LockKeyhole size={12} />
            ) : (
              <LockKeyholeOpen size={12} />
            )}
          </button>
        )
      )}
    </div>
  );
  const renderRow = (
    {
      block,
      startMinute,
      endMinute,
      conflict,
      gapMinutes,
    }: Pick<
      ScheduledBlock<Block>,
      "block" | "startMinute" | "endMinute" | "conflict" | "gapMinutes"
    >,
    index: number,
    siblings: Block[],
    listId: string | null,
  ): ReactNode => {
    // The day's first block is anchored to the day's start time.
    const dayAnchor = listId === null && index === 0;
    const isContainer = block.kind === "group" || block.kind === "parallel";
    return (
      <div
        key={block.id}
        className={`block-group ${block.kind === "group" || block.kind === "parallel" ? `container-block container-${block.kind}` : ""}`}
      >
        {editable && (
          <InsertMenu
            pick={(kind) =>
              insertAt(createBlock(kind), {
                listId,
                beforeId: block.id,
              })
            }
          />
        )}
        {block.section &&
          listId === null &&
          (index === 0 || siblings[index - 1].section !== block.section) && (
            <div className="section-label">
              <button
                className="section-toggle"
                aria-expanded={
                  !collapsedSections.has(`${day.id}:${block.section}`)
                }
                onClick={() =>
                  setCollapsedSections((current) => {
                    const next = new Set(current);
                    const key = `${day.id}:${block.section}`;
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                {collapsedSections.has(`${day.id}:${block.section}`) ? (
                  <ChevronRight size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
                {block.section}
              </button>
              <div />
            </div>
          )}
        {gapMinutes < 0 && (
          <div className="schedule-overlap" role="alert">
            <XCircle size={18} />
            <span>
              <strong>{durationLabel(Math.ceil(-gapMinutes - 1e-9))}</strong>{" "}
              {t("de chevauchement entre", "overlap between")}{" "}
              <strong>
                {siblings[index - 1]?.title ||
                  t("le bloc précédent", "the previous block")}
              </strong>{" "}
              {t("et", "and")} <strong>{block.title}</strong>
            </span>
          </div>
        )}
        {gapMinutes > 0 && (
          <div className="schedule-gap">
            {durationLabel(gapMinutes)}{" "}
            {t("de marge avant ce bloc", "buffer before this block")}
          </div>
        )}
        {isContainer ? (
          containerHeader(block, startMinute, dayAnchor, listId)
        ) : (
          <div
            className={`agenda-row category-${block.category} ${detail === block.id ? "inspected-row" : ""} ${selection.has(block.id) ? "selected-row" : ""} ${containsActive(block) ? "current-block" : ""} ${conflict ? "schedule-conflict" : ""}`}
            style={{
              gridTemplateColumns: gridTemplate,
              ...({
                "--category-color": categoryColor(
                  block.category,
                  session.categories,
                ),
              } as CSSProperties),
              display: collapsedSections.has(`${day.id}:${block.section}`)
                ? "none"
                : undefined,
            }}
            onDragOver={
              editable
                ? (e) => {
                    if (!dragId.current) return;
                    e.preventDefault();
                    e.currentTarget.classList.add("drop-before");
                  }
                : undefined
            }
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                e.currentTarget.classList.remove("drop-before");
            }}
            onDrop={
              editable
                ? (e) => {
                    e.currentTarget.classList.remove("drop-before");
                    drop(e, block.id, listId);
                  }
                : undefined
            }
          >
            <div className="block-time">
              {editable && (
                <input
                  className="block-select"
                  type="checkbox"
                  aria-label={`${t("Sélectionner", "Select")} ${block.title}`}
                  checked={selection.has(block.id)}
                  onChange={(e) => selectBlock(block.id, e.target.checked)}
                />
              )}
              <button
                className="drag-handle"
                draggable={editable && !containsActive(block)}
                onDragStart={(e) => {
                  dragId.current = block.id;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", block.id);
                }}
                onDragEnd={() => {
                  dragId.current = null;
                }}
                title={t(
                  "Glisser pour déplacer · flèches dans les détails",
                  "Drag to reorder · arrow controls in details",
                )}
                aria-label={t("Déplacer le bloc", "Move block")}
              >
                <GripVertical size={17} />
              </button>
              {startTimeCell(block, startMinute, dayAnchor)}
              {!separateTime && durationControl(block)}
              <span className="end-time">{formatTime(endMinute)}</span>
              {conflict && (
                <span
                  className="conflict-icon"
                  title={t(
                    "L’horaire verrouillé chevauche le bloc précédent",
                    "Locked start overlaps the previous block",
                  )}
                >
                  <AlertCircle size={14} />
                </span>
              )}
            </div>
            {separateTime && (
              <div className="block-duration-column">
                {durationControl(block)}
              </div>
            )}
            <div className="block-main">
              <div className="block-title-row">
                <button
                  className="collapse-block"
                  aria-expanded={!compact && !collapsedBlocks.has(block.id)}
                  aria-label={t(
                    "Développer ou replier le bloc",
                    "Expand or collapse block",
                  )}
                  onClick={() =>
                    setCollapsedBlocks((current) => {
                      const next = new Set(current);
                      if (next.has(block.id)) next.delete(block.id);
                      else next.add(block.id);
                      return next;
                    })
                  }
                >
                  {collapsedBlocks.has(block.id) || compact ? (
                    <ChevronRight size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </button>
                <input
                  className="block-title-input"
                  ref={(el) => {
                    if (el) titleInputs.current.set(block.id, el);
                    else titleInputs.current.delete(block.id);
                  }}
                  value={block.title}
                  aria-label={t("Titre du bloc", "Block title")}
                  maxLength={240}
                  readOnly={!editable}
                  onKeyDown={(e) => titleKey(e, block, index, siblings, listId)}
                  title={t(
                    "Entrée : nouveau bloc · Alt + ↑↓ : déplacer · Ctrl/⌘ + D : dupliquer",
                    "Enter: new block · Alt + ↑↓: move · Ctrl/⌘ + D: duplicate",
                  )}
                  onChange={(e) =>
                    editBlock(block.id, {
                      title: e.target.value,
                    })
                  }
                />
                <button
                  className="expand-block"
                  title={t("Détails du bloc", "Block details")}
                  onClick={() => showDetail(block.id)}
                >
                  <ArrowRight size={15} />
                </button>
                <button
                  className="block-comment-button"
                  title={t("Commenter ce bloc", "Comment on this block")}
                  onClick={() => {
                    setCommentTarget({ blockId: block.id });
                    setPanel("comments");
                  }}
                >
                  <MessageSquare size={14} />
                  {commentCounts.blocks[block.id] > 0 && (
                    <small>{commentCounts.blocks[block.id]}</small>
                  )}
                </button>
              </div>
              {block.kind && block.kind !== "activity" && (
                <button
                  className="block-kind"
                  onClick={() => showDetail(block.id)}
                >
                  {block.kind === "group"
                    ? `${t("Groupe", "Group")} · ${block.children?.length ?? 0} ${t("blocs", "blocks")}`
                    : block.kind === "parallel"
                      ? `${t("En parallèle", "Parallel")} · ${block.rooms?.length ?? 0} ${t("salles", "rooms")}`
                      : t("Note sans durée", "Untimed note")}
                </button>
              )}
              {showDescription &&
                !compact &&
                !collapsedBlocks.has(block.id) && (
                  <RichTextEditor
                    className="block-description"
                    ariaLabel={`${t("Description de", "Description of")} ${block.title}`}
                    placeholder={t(
                      "Ajouter une description…",
                      "Add a description…",
                    )}
                    value={block.description}
                    maxLength={30000}
                    disabled={!editable}
                    onChange={(value) =>
                      editBlock(block.id, {
                        description: value,
                      })
                    }
                  />
                )}
              <select
                className={`category-select category-text-${block.category}`}
                style={{
                  backgroundColor: `${categoryColor(block.category, session.categories)}28`,
                  color: "#344d4c",
                }}
                value={block.category}
                disabled={!editable}
                aria-label={t("Catégorie", "Category")}
                onChange={(e) =>
                  e.target.value === "__categories"
                    ? setPanel("categories")
                    : editBlock(block.id, {
                        category: e.target.value as Category,
                      })
                }
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
                <option value="__categories">
                  {t("Gérer les catégories…", "Manage categories…")}
                </option>
              </select>
            </div>
            {customColumns.map((c) => (
              <div
                key={c.id}
                className={`block-column ${c.visibility === "team" ? "private-column" : ""}`}
              >
                {c.id === "facilitator" ? (
                  <AssigneePicker
                    block={block}
                    disabled={!editable}
                    change={(patch) => editBlock(block.id, patch)}
                  />
                ) : (
                  !collapsedBlocks.has(block.id) && (
                    <RichTextEditor
                      compact={compact}
                      ariaLabel={`${c.label} · ${block.title}`}
                      placeholder={
                        c.visibility === "team"
                          ? t(
                              "Visible par l’équipe uniquement…",
                              "Only visible to your team…",
                            )
                          : t("Ajouter du texte…", "Add text…")
                      }
                      value={
                        c.id === "description"
                          ? block.description
                          : (block.fields[c.id] ?? "")
                      }
                      maxLength={30000}
                      disabled={!editable}
                      onChange={(value) =>
                        editBlock(
                          block.id,
                          c.id === "description"
                            ? { description: value }
                            : {
                                fields: {
                                  ...block.fields,
                                  [c.id]: value,
                                },
                              },
                        )
                      }
                    />
                  )
                )}
              </div>
            ))}
            <div className="row-actions">
              {editable && (
                <button
                  className="icon-button row-delete"
                  title={`${t("Supprimer", "Delete")} ${block.title}`}
                  aria-label={`${t("Supprimer", "Delete")} ${block.title}`}
                  disabled={containsActive(block)}
                  onClick={() => removeBlock(block.id)}
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                className="icon-button"
                title={t("Détails et actions", "Details and actions")}
                onClick={() => showDetail(block.id)}
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>
        )}
        {block.kind === "group" &&
          !collapsedBlocks.has(block.id) &&
          !collapsedSections.has(`${day.id}:${block.section}`) && (
            <div className="group-children">
              {(block.children ?? []).map((child, childIndex) => {
                const row = treeRows.get(child.id);
                return row
                  ? renderRow(row, childIndex, block.children ?? [], block.id)
                  : null;
              })}
              {editable && (
                <button
                  className="outline-add group-drop"
                  onClick={() =>
                    insertAt(createBlock("activity"), { listId: block.id })
                  }
                  onDragOver={(e) => {
                    if (!dragId.current) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.add("drop-here");
                  }}
                  onDragLeave={(e) =>
                    e.currentTarget.classList.remove("drop-here")
                  }
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.remove("drop-here");
                    if (dragId.current)
                      outlineActions.relocate(dragId.current, {
                        listId: block.id,
                      });
                    dragId.current = null;
                  }}
                >
                  <Plus size={14} />
                  {t(
                    "Ajouter une activité au groupe",
                    "Add an activity to the group",
                  )}
                  <span>
                    {t("ou glissez un bloc ici", "or drag a block here")}
                  </span>
                </button>
              )}
            </div>
          )}
        {block.kind === "parallel" &&
          !collapsedBlocks.has(block.id) &&
          !collapsedSections.has(`${day.id}:${block.section}`) &&
          roomsArea(block)}
      </div>
    );
  };
  return (
    <DisplayTimeProvider userId={user.id}>
      <MentionProvider sessionId={session.id}>
        <ActualDurationsContext.Provider
          value={
            session.run.status === "idle"
              ? undefined
              : session.run.actualDurations
          }
        >
          <div
            className="app-shell editor-shell"
            onKeyDown={(e) => {
              const target = e.target as HTMLElement;
              if (
                editable &&
                (e.ctrlKey || e.metaKey) &&
                e.key.toLowerCase() === "z" &&
                !target.closest('input,textarea,[contenteditable="true"]')
              ) {
                e.preventDefault();
                changeHistory(!e.shiftKey);
              }
            }}
          >
            <aside className="sidebar editor-sidebar">
              <button className="brand-link plain-button" onClick={leave}>
                <Brand />
              </button>
              <button className="back-button" onClick={leave}>
                <ArrowLeft size={16} />
                {t("Toutes les séances", "All sessions")}
              </button>
              <div className="sidebar-session-title">{session.title}</div>
              <button
                className={`nav-item ${panel === "overview" ? "active" : ""}`}
                onClick={() => {
                  setPanel("overview");
                  setSelectedContent(null);
                  setDetail(null);
                }}
              >
                <BarChart3 size={18} />
                {t("Vue d’ensemble", "Overview")}
              </button>
              <div className="sidebar-section-heading">
                <button
                  className="icon-button"
                  title={t(
                    "Deux agendas côte à côte",
                    "Two agendas side by side",
                  )}
                  onClick={() => {
                    setSelectedContent(null);
                    setDetail(null);
                    setPanel("multi-plan");
                  }}
                >
                  <Copy size={17} />
                </button>
                <span className="nav-caption">
                  {t("VOTRE AGENDA", "YOUR AGENDA")}
                </span>
                {editable && (
                  <button
                    className="icon-button"
                    title={t("Ajouter un jour", "Add day")}
                    onClick={() => {
                      const added = {
                        id: crypto.randomUUID(),
                        title: t(
                          `Jour ${session.days.length + 1}`,
                          `Day ${session.days.length + 1}`,
                        ),
                        date: new Date(
                          new Date(`${day.date}T12:00:00Z`).getTime() +
                            86400000,
                        )
                          .toISOString()
                          .slice(0, 10),
                        startTime: "09:00",
                        blocks: [],
                      };
                      mutate((s) => ({ ...s, days: [...s.days, added] }));
                      setSelectedDay(added.id);
                      setSelectedContent(null);
                      setPanel(null);
                    }}
                  >
                    <Plus size={17} />
                  </button>
                )}
              </div>
              <SessionNavigation
                session={session}
                editable={editable}
                selected={
                  panel === "overview"
                    ? null
                    : (selectedContent ?? { kind: "day", id: day.id })
                }
                update={mutate}
                onSelect={(item) => {
                  setSelectedContent(item.kind === "day" ? null : item);
                  if (item.kind === "day") setSelectedDay(item.id);
                  setDetail(null);
                  setPanel(null);
                  clearSelection();
                }}
              />
              <div className="sidebar-bottom">
                <div
                  className="agenda-minimap"
                  aria-label={t(
                    "Navigation dans l’agenda",
                    "Agenda navigation",
                  )}
                >
                  {scheduled.map(({ block, startMinute }) => (
                    <button
                      key={block.id}
                      className={`category-bg-${block.category} ${containsActive(block) ? "minimap-current" : ""}`}
                      style={{
                        flex: Math.max(blockDuration(block), 1),
                        backgroundColor: categoryColor(
                          block.category,
                          session.categories,
                        ),
                      }}
                      title={`${formatTime(startMinute)} · ${block.title} · ${durationLabel(blockDuration(block))}`}
                      aria-label={`${t("Aller à", "Jump to")} ${block.title}`}
                      onClick={() => {
                        setSelectedContent(null);
                        setPanel(null);
                        setCollapsedSections(new Set());
                        requestAnimationFrame(() => {
                          const input = titleInputs.current.get(block.id);
                          input?.scrollIntoView({
                            block: "center",
                            behavior: "smooth",
                          });
                          input?.focus({ preventScroll: true });
                        });
                      }}
                    >
                      {containsActive(block) && (
                        <TimerMinimapProgress session={session} block={block} />
                      )}
                      <span>{block.title}</span>
                    </button>
                  ))}
                </div>
                <div className="agenda-summary">
                  <span>{t("DURÉE TOTALE", "TOTAL DURATION")}</span>
                  <strong>{durationLabel(totalDuration(session))}</strong>
                  <div className="category-bar">
                    {categories.map((category) => {
                      const n = session.days
                        .flatMap((d) => d.blocks)
                        .filter((b) => b.category === category)
                        .reduce((a, b) => a + b.duration, 0);
                      return (
                        n > 0 && (
                          <span
                            key={category}
                            className={`category-bg-${category}`}
                            style={{
                              flex: n,
                              backgroundColor: categoryColor(
                                category,
                                session.categories,
                              ),
                            }}
                            title={`${categoryLabel(category)} · ${durationLabel(n)}`}
                          />
                        )
                      );
                    })}
                  </div>
                  <small>
                    {session.days.flatMap((d) => d.blocks).length}{" "}
                    {t("blocs", "blocks")} · {session.days.length}{" "}
                    {t("jour(s)", "day(s)")}
                  </small>
                </div>
                <div className="sidebar-user">
                  <Avatar name={user.name} src={user.avatar} />
                  <div>
                    <strong>{user.name}</strong>
                    <small>{roleLabel}</small>
                  </div>
                </div>
              </div>
            </aside>
            <main className="editor-main">
              <header className="topbar">
                <div className="breadcrumb">
                  <button onClick={leave}>
                    {t("Mes séances", "My sessions")}
                  </button>
                  <span>/</span>
                  <strong>{session.title}</strong>
                </div>
                <div className="topbar-actions">
                  <NotificationBell
                    onNavigate={(sessionId, blockId, commentId) => {
                      if (sessionId !== session.id)
                        navigate(
                          `/session/${sessionId}?${new URLSearchParams({ ...(blockId ? { block: blockId } : {}), ...(commentId ? { comment: commentId } : {}) })}`,
                        );
                      else {
                        setSelectedContent(null);
                        setCommentTarget({ blockId, commentId });
                        if (blockId) {
                          const target = session.days.find((day) =>
                            allBlocks(day.blocks).some(
                              (block) => block.id === blockId,
                            ),
                          );
                          if (target) setSelectedDay(target.id);
                          setDetail(null);
                        }
                        setPanel("comments");
                      }
                    }}
                  />
                  <PresenceBar
                    sessionId={session.id}
                    userId={user.id}
                    blockId={detail}
                    editing={editable && !!detail}
                  />
                  <span className={`save-status ${status}`} title={saveText}>
                    {status === "saved" ? (
                      <Check size={15} />
                    ) : status === "conflict" ? (
                      <AlertCircle size={15} />
                    ) : (
                      <Cloud size={16} />
                    )}
                    <span>{saveText}</span>
                  </span>
                  <LanguageSwitch />
                  <Avatar name={user.name} src={user.avatar} small />
                  <button
                    className="button primary small"
                    onClick={async () => {
                      if (await data.save()) setPanel("share");
                    }}
                  >
                    <Share2 size={15} />
                    {t("Partager", "Share")}
                  </button>
                </div>
              </header>
              {session.lifecycle?.closedAt && (
                <div className="lifecycle-banner" role="status">
                  <LockKeyhole size={17} />
                  <span>
                    {t(
                      "Séance clôturée · agenda en lecture seule",
                      "Closed session · read-only agenda",
                    )}
                  </span>
                  <button
                    className="toolbar-button"
                    onClick={() => setPanel("lifecycle")}
                  >
                    {t("Voir son état", "View status")}
                  </button>
                </div>
              )}
              {data.error && (
                <ErrorBanner message={data.error} retry={data.retry} />
              )}{" "}
              {status === "conflict" && (
                <div className="conflict-banner">
                  <p>
                    {t(
                      "Une autre personne a modifié la séance. Vos modifications locales sont conservées ici. Exportez-les avant de charger la dernière version.",
                      "Someone else changed this session. Your local changes are preserved here. Export them before loading the latest version.",
                    )}
                  </p>
                  <button
                    className="button secondary small"
                    onClick={() =>
                      download(
                        "meetloom-local.json",
                        JSON.stringify(session, null, 2),
                      )
                    }
                  >
                    {t("Exporter ma copie", "Export my copy")}
                  </button>
                  <button
                    className="button secondary small"
                    onClick={data.load}
                  >
                    {t("Charger la dernière version", "Load latest version")}
                  </button>
                </div>
              )}
              <div
                className="editor-content"
                hidden={
                  panel === "overview" ||
                  panel === "multi-plan" ||
                  !!selectedPage ||
                  !!selectedForm
                }
              >
                <div className="session-heading">
                  <div className="session-heading-meta">
                    <span className="session-tag">
                      <span className="mini-dot green" />
                      {t("ESPACE DE PRÉPARATION", "PLANNING SPACE")}
                    </span>
                    <span className="session-private">
                      <LockKeyhole size={13} />
                      {t(
                        "Privée · partage maîtrisé",
                        "Private · controlled sharing",
                      )}
                    </span>
                  </div>
                  <input
                    className="session-title-input"
                    aria-label={t("Titre de la séance", "Session title")}
                    value={session.title}
                    readOnly={!editable}
                    maxLength={240}
                    onChange={(e) =>
                      mutate((s) => ({ ...s, title: e.target.value }))
                    }
                  />
                  <textarea
                    className="session-description-input"
                    rows={2}
                    aria-label={t(
                      "Description de la séance",
                      "Session description",
                    )}
                    placeholder={t(
                      "Quel est l’objectif de cette séance ?",
                      "What is the goal of this session?",
                    )}
                    value={session.description}
                    readOnly={!editable}
                    maxLength={30000}
                    onChange={(e) =>
                      mutate((s) => ({ ...s, description: e.target.value }))
                    }
                  />
                </div>
                <SessionMetadata
                  session={session}
                  editable={editable}
                  update={mutate}
                />
                <DisplayTimeControl timezone={session.timezone} />
                <div className="day-heading">
                  <div className="day-settings">
                    <input
                      className="day-title"
                      aria-label={t("Nom du jour", "Day name")}
                      value={day.title}
                      readOnly={!editable}
                      maxLength={120}
                      onChange={(e) => updateDay({ title: e.target.value })}
                    />
                    <label className="inline-field">
                      <CalendarDays size={16} />
                      <input
                        type="date"
                        aria-label={t("Date", "Date")}
                        value={day.date}
                        readOnly={!editable}
                        onChange={(e) => {
                          if (e.target.value)
                            updateDay({ date: e.target.value });
                        }}
                      />
                    </label>
                    <span className="inline-field">
                      <Clock3 size={16} />
                      <ClockField
                        label={t("Heure de début", "Start time")}
                        value={day.startTime}
                        readOnly={!editable}
                        change={setDayStart}
                      />
                      <span>
                        —{" "}
                        {formatTime(
                          scheduled.at(-1)?.endMinute ??
                            Number(day.startTime.slice(0, 2)) * 60 +
                              Number(day.startTime.slice(3)),
                        )}
                      </span>
                    </span>
                    <span className="duration-pill">
                      {durationLabel(dayDuration)}
                    </span>
                  </div>
                  <Timer
                    session={session}
                    dayId={day.id}
                    canRun={runnable}
                    action={data.action}
                  />
                </div>
                <div className="agenda-toolbar">
                  <div className="toolbar-group">
                    <select
                      className="agenda-zoom"
                      aria-label={t("Zoom de l’agenda", "Agenda zoom")}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                    >
                      {[75, 90, 100, 110, 125, 150].map((n) => (
                        <option key={n} value={n}>
                          {n}%
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-button"
                      title={t(
                        "Adapter les colonnes à la fenêtre",
                        "Fit columns to window",
                      )}
                      onClick={() => {
                        setWidths({});
                        setZoom(100);
                      }}
                    >
                      <Maximize2 size={15} />
                    </button>
                    <span className="agenda-label">
                      {t("Déroulé de la séance", "Session agenda")}
                    </span>
                    <span className="count-badge">{day.blocks.length}</span>
                    <div className="toolbar-divider" />
                    <button
                      className="icon-button"
                      disabled={!editable || !undo.length}
                      title={t("Annuler", "Undo")}
                      onClick={() => changeHistory(true)}
                    >
                      <Undo2 size={17} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={!editable || !redo.length}
                      title={t("Rétablir", "Redo")}
                      onClick={() => changeHistory(false)}
                    >
                      <Redo2 size={17} />
                    </button>
                  </div>
                  <div className="toolbar-group">
                    <button
                      className="toolbar-button"
                      onClick={() => setPanel("export")}
                    >
                      <Download size={16} />
                      {t("Exporter", "Export")}
                    </button>
                    <button
                      className="toolbar-button"
                      onClick={() => setPanel("preparation")}
                    >
                      <Check size={16} />
                      {t("Préparation", "Preparation")}
                    </button>
                    <button
                      className="icon-button comment-count-button"
                      title={t("Commentaires", "Comments")}
                      onClick={() => {
                        setCommentTarget({});
                        setPanel("comments");
                      }}
                    >
                      <MessageSquare size={17} />
                      {commentCounts.total > 0 && (
                        <small>{commentCounts.total}</small>
                      )}
                    </button>
                    <button
                      className="toolbar-button"
                      onClick={() => setPanel("columns")}
                    >
                      <Columns3 size={16} />
                      {t("Colonnes", "Columns")}
                    </button>
                    <button
                      className="toolbar-button"
                      onClick={() => setCompact(!compact)}
                    >
                      <Maximize2 size={15} />
                      {compact
                        ? t("Développer", "Expand")
                        : t("Réduire", "Compact")}
                    </button>
                    <button
                      className="toolbar-button ai-button"
                      disabled={!editable}
                      onClick={() => {
                        setAiTarget(undefined);
                        setPanel("ai");
                      }}
                    >
                      <Sparkles size={16} />
                      {t("Assistant IA", "AI assistant")}
                    </button>
                    <div className="menu-anchor">
                      <button
                        ref={menuButton}
                        className="icon-button"
                        onClick={() => setMenu(!menu)}
                        aria-expanded={menu}
                        aria-label={t("Autres actions", "More actions")}
                      >
                        <MoreHorizontal size={21} />
                      </button>
                      {menu && (
                        <>
                          <button
                            className="menu-backdrop"
                            aria-label={t("Fermer le menu", "Close menu")}
                            onClick={() => setMenu(false)}
                          />
                          <div className="dropdown-menu">
                            <button
                              onClick={() => {
                                void data.save().then((saved) => {
                                  if (saved) setPanel("lifecycle");
                                });
                                setMenu(false);
                              }}
                            >
                              <Check size={16} />
                              {t(
                                "Clôture et suppression",
                                "Close or delete session",
                              )}
                            </button>
                            <button
                              onClick={() => {
                                setPanel("settings");
                                setMenu(false);
                              }}
                            >
                              <Settings2 size={16} />
                              {t("Paramètres & sons", "Settings & sounds")}
                            </button>
                            <button
                              onClick={() => {
                                setPanel("comments");
                                setMenu(false);
                              }}
                            >
                              <MessageSquare size={16} />
                              {t("Commentaires", "Comments")}
                            </button>
                            <button
                              onClick={() => {
                                void data.save().then((saved) => {
                                  if (saved) setPanel("history");
                                });
                                setMenu(false);
                              }}
                            >
                              <History size={16} />
                              {t("Historique", "Version history")}
                            </button>
                            <hr />
                            <button
                              onClick={() => {
                                download(
                                  "meetloom-agenda.json",
                                  JSON.stringify(session, null, 2),
                                );
                                setMenu(false);
                              }}
                            >
                              <Download size={16} />
                              {t("Exporter en JSON", "Export JSON")}
                            </button>
                            <button
                              onClick={() => {
                                download(
                                  "meetloom-agenda.csv",
                                  exportSessionCsv(session, locale),
                                  "text/csv;charset=utf-8",
                                );
                                setMenu(false);
                              }}
                            >
                              <Download size={16} />
                              {t("Exporter en CSV", "Export CSV")}
                            </button>
                            <button
                              onClick={() => {
                                window.print();
                                setMenu(false);
                              }}
                            >
                              <Download size={16} />
                              {t("Imprimer / PDF", "Print / PDF")}
                            </button>
                            {editable && (
                              <>
                                <button
                                  onClick={() => {
                                    setPanel("import");
                                    setMenu(false);
                                  }}
                                >
                                  <FileUp size={16} />
                                  {t("Importer un agenda", "Import agenda")}
                                </button>
                                <button
                                  onClick={() => {
                                    const cloned = {
                                      ...structuredClone(day),
                                      id: crypto.randomUUID(),
                                      title: t(
                                        `${day.title} (copie)`,
                                        `${day.title} (copy)`,
                                      ).slice(0, 120),
                                      blocks: day.blocks.map(cloneBlockTree),
                                    };
                                    mutate((s) => ({
                                      ...s,
                                      days: [...s.days, cloned],
                                    }));
                                    setSelectedDay(cloned.id);
                                    setMenu(false);
                                  }}
                                  disabled={session.days.length >= 30}
                                >
                                  <Copy size={16} />
                                  {t("Dupliquer ce jour", "Duplicate this day")}
                                </button>
                                <button
                                  onClick={() => {
                                    mutate((s) => ({
                                      ...s,
                                      days: s.days.filter(
                                        (d) => d.id !== day.id,
                                      ),
                                    }));
                                    setSelectedDay("");
                                    setMenu(false);
                                  }}
                                  disabled={
                                    session.days.length === 1 ||
                                    (session.run.dayId === day.id &&
                                      ["running", "paused"].includes(
                                        session.run.status,
                                      ))
                                  }
                                >
                                  <Trash2 size={16} />
                                  {t(
                                    "Supprimer ce jour (annulable)",
                                    "Delete this day (undo available)",
                                  )}
                                </button>
                                <hr />
                                <button
                                  onClick={() => {
                                    mutate((s) => ({
                                      ...s,
                                      archived: !s.archived,
                                    }));
                                    setMenu(false);
                                  }}
                                >
                                  <Archive size={16} />
                                  {session.archived
                                    ? t("Désarchiver", "Unarchive")
                                    : t(
                                        "Archiver la séance",
                                        "Archive session",
                                      )}
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="agenda-scroll" style={{ zoom: zoom / 100 }}>
                  {editable && selectedBlocks.length > 0 && (
                    <div className="selection-toolbar">
                      <strong>
                        {selectedBlocks.length}{" "}
                        {t("sélectionné(s)", "selected")}
                      </strong>
                      <select
                        aria-label={t(
                          "Catégorie des blocs sélectionnés",
                          "Category for selected blocks",
                        )}
                        value=""
                        onChange={(event) => {
                          const category = event.target.value;
                          updateDay({
                            blocks: day.blocks.map((block) =>
                              selection.has(block.id)
                                ? { ...block, category }
                                : block,
                            ),
                          });
                        }}
                      >
                        <option value="">
                          {t("Changer de catégorie…", "Change category…")}
                        </option>
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {categoryLabel(category)}
                          </option>
                        ))}
                      </select>
                      <AssigneePicker
                        block={selectedBlocks[0]}
                        change={(patch) =>
                          updateDay({
                            blocks: day.blocks.map((block) =>
                              selection.has(block.id)
                                ? { ...block, ...patch }
                                : block,
                            ),
                          })
                        }
                      />
                      <button
                        className="toolbar-button"
                        onClick={copySelection}
                      >
                        <Copy size={15} />
                        {t("Dupliquer", "Duplicate")}
                      </button>
                      <button
                        className="toolbar-button"
                        disabled={selectedBlocks.some(containsActive)}
                        onClick={() => {
                          updateDay({
                            blocks: day.blocks.filter(
                              (b) => !selection.has(b.id),
                            ),
                          });
                          clearSelection();
                        }}
                      >
                        <Trash2 size={15} />
                        {t("Supprimer", "Delete")}
                      </button>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!groupName.trim()) return;
                          const group = newBlock(locale, {
                            kind: "group",
                            title: groupName.trim(),
                            children: selectedBlocks,
                          });
                          const blocks = day.blocks.filter(
                            (b) => !selection.has(b.id),
                          );
                          blocks.splice(
                            day.blocks.findIndex((b) => selection.has(b.id)),
                            0,
                            group,
                          );
                          updateDay({ blocks });
                          setGroupName("");
                          clearSelection();
                        }}
                      >
                        <input
                          value={groupName}
                          maxLength={240}
                          onChange={(e) => setGroupName(e.target.value)}
                          aria-label={t("Nom du groupe", "Group name")}
                          placeholder={t(
                            "Réunir dans un groupe…",
                            "Collect in a group…",
                          )}
                        />
                        <button
                          className="button secondary small"
                          disabled={!groupName.trim()}
                        >
                          {t("Regrouper", "Group")}
                        </button>
                      </form>
                      {session.days.length > 1 && (
                        <>
                          <select
                            aria-label={t(
                              "Déplacer vers un jour",
                              "Move to day",
                            )}
                            value={moveToDay}
                            onChange={(e) => setMoveToDay(e.target.value)}
                          >
                            <option value="">
                              {t("Déplacer vers…", "Move to…")}
                            </option>
                            {session.days
                              .filter((d) => d.id !== day.id)
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.title}
                                </option>
                              ))}
                          </select>
                          <button
                            className="icon-button"
                            title={t("Déplacer", "Move")}
                            disabled={
                              !moveToDay || selectedBlocks.some(containsActive)
                            }
                            onClick={moveSelection}
                          >
                            <ArrowRight size={17} />
                          </button>
                        </>
                      )}
                      <button
                        className="icon-button"
                        aria-label={t(
                          "Annuler la sélection",
                          "Clear selection",
                        )}
                        onClick={clearSelection}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  <div
                    className={`agenda-table ${compact ? "is-compact" : ""}`}
                    style={{
                      minWidth: Math.max(
                        690,
                        550 +
                          (separateTime ? 82 : 0) +
                          customColumns.length * 220,
                      ),
                    }}
                  >
                    <div
                      className="agenda-table-header"
                      style={{ gridTemplateColumns: gridTemplate }}
                    >
                      <span>
                        {editable ? (
                          <input
                            type="checkbox"
                            aria-label={t(
                              "Sélectionner tous les blocs",
                              "Select all blocks",
                            )}
                            checked={
                              day.blocks.length > 0 &&
                              selectedBlocks.length === day.blocks.length
                            }
                            onChange={(e) =>
                              setSelection(
                                e.target.checked
                                  ? new Set(day.blocks.map((b) => b.id))
                                  : new Set(),
                              )
                            }
                          />
                        ) : (
                          <Clock3 size={13} />
                        )}
                        {t("HORAIRE", "TIME")}
                      </span>
                      {separateTime && <span>{t("DURÉE", "DURATION")}</span>}
                      <span className="resizable-heading">
                        {showDescription
                          ? t("BLOC & DESCRIPTION", "BLOCK & DESCRIPTION")
                          : t("BLOC", "BLOCK")}
                        <ColumnResizer
                          label={t(
                            "Titre et description",
                            "Title and description",
                          )}
                          width={widths.title ?? 360}
                          change={(width) =>
                            setWidths((w) => ({ ...w, title: width }))
                          }
                        />
                      </span>
                      {customColumns.map((c) => (
                        <span key={c.id} className="resizable-heading">
                          {c.visibility === "team" ? (
                            <LockKeyhole size={12} />
                          ) : (
                            <Eye size={12} />
                          )}{" "}
                          {c.label.toUpperCase()}
                          <ColumnResizer
                            label={c.label}
                            width={widths[c.id] ?? 240}
                            change={(width) =>
                              setWidths((w) => ({ ...w, [c.id]: width }))
                            }
                          />
                        </span>
                      ))}
                      <span />
                    </div>
                    {scheduled.map((row, index) =>
                      renderRow(row, index, day.blocks, null),
                    )}
                    {!day.blocks.length && (
                      <div className="agenda-empty">
                        <span className="empty-icon">
                          <CalendarDays size={28} />
                        </span>
                        <h3>
                          {t(
                            "Faisons de la place aux bonnes idées.",
                            "Make room for good ideas.",
                          )}
                        </h3>
                        <p>
                          {t(
                            "Commencez par un premier bloc, puis donnez un rythme à votre séance.",
                            "Start with a first block, then give your session a rhythm.",
                          )}
                        </p>
                        {editable && (
                          <button
                            className="button primary"
                            onClick={() => addBlock()}
                          >
                            <Plus size={17} />
                            {t(
                              "Ajouter le premier bloc",
                              "Add the first block",
                            )}
                          </button>
                        )}
                      </div>
                    )}
                    {editable && day.blocks.length > 0 && (
                      <button
                        className="add-block-button"
                        onClick={() => addBlock()}
                        onDragOver={(e) => {
                          if (dragId.current) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragId.current)
                            outlineActions.relocate(dragId.current, {
                              listId: null,
                            });
                          dragId.current = null;
                        }}
                      >
                        <Plus size={18} />
                        {t("Ajouter un bloc", "Add a block")}
                        <span>
                          {t(
                            "ou Entrée depuis le titre d’un bloc",
                            "or press Enter in a block title",
                          )}
                        </span>
                      </button>
                    )}
                    {editable && (
                      <div className="add-special-blocks">
                        <button
                          className="toolbar-button"
                          onClick={() => addContainer("group")}
                        >
                          <Plus size={14} />
                          {t("Groupe", "Group")}
                        </button>
                        <button
                          className="toolbar-button"
                          onClick={() => addContainer("parallel")}
                        >
                          <Plus size={14} />
                          {t("Salles parallèles", "Parallel rooms")}
                        </button>
                        <button
                          className="toolbar-button"
                          onClick={() => addContainer("note")}
                        >
                          <Plus size={14} />
                          {t("Note", "Note")}
                        </button>
                      </div>
                    )}
                    {day.blocks.length > 0 && (
                      <div className="agenda-end">
                        <span className="end-marker" />
                        <strong>
                          {formatTime(scheduled.at(-1)!.endMinute)}
                        </strong>
                        <span>{t("Fin de la séance", "End of session")}</span>
                        <span>
                          {durationLabel(dayDuration)} · {day.blocks.length}{" "}
                          {t("blocs", "blocks")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="editor-footer">
                  <span>
                    <LockKeyhole size={13} />
                    {t(
                      "Les colonnes privées restent au sein de votre équipe.",
                      "Private columns stay within your team.",
                    )}
                  </span>
                  <button onClick={() => setPanel("settings")}>
                    <Settings2 size={14} />
                    {t(
                      "Alertes sonores & paramètres",
                      "Sound alerts & settings",
                    )}
                  </button>
                </div>
              </div>
              {panel === "overview" && (
                <SessionOverview
                  session={session}
                  editable={editable}
                  update={mutate}
                  openDay={(dayId, blockId) => {
                    setSelectedDay(dayId);
                    setPanel(null);
                    setDetail(blockId ?? null);
                    clearSelection();
                  }}
                />
              )}
              {panel === "multi-plan" && (
                <MultiPlanView
                  session={session}
                  editable={editable}
                  dayId={day.id}
                  update={mutate}
                  flush={flush}
                  reload={data.load}
                  beforeLeave={multiLeave}
                  close={() => setPanelState(null)}
                />
              )}
              {selectedPage && (
                <>
                  <div className="page-alongside-toolbar">
                    <button
                      className="button secondary small"
                      onClick={() => {
                        setPinnedPageId(selectedPage.id);
                        setSelectedContent(null);
                        setPanel(null);
                        setDetail(null);
                      }}
                    >
                      <Columns3 size={16} />
                      {t(
                        "Afficher à côté de l’agenda",
                        "Show beside the agenda",
                      )}
                    </button>
                  </div>
                  <PageEditor
                    page={selectedPage}
                    editable={editable}
                    onChange={(page) =>
                      mutate((current) => ({
                        ...current,
                        pages: current.pages?.map((value) =>
                          value.id === page.id ? page : value,
                        ),
                      }))
                    }
                  />
                </>
              )}
              {selectedForm && (
                <FormEditor
                  aiEnabled={aiEnabled}
                  session={session}
                  formId={selectedForm.id}
                  editable={editable}
                  update={mutate}
                  flush={flush}
                />
              )}
            </main>
            {pinnedPage && (
              <Inspector
                title={pinnedPage.title}
                close={() => setPinnedPageId("")}
              >
                <button
                  className="toolbar-button"
                  onClick={() => {
                    setSelectedContent({ kind: "page", id: pinnedPage.id });
                    setPinnedPageId("");
                  }}
                >
                  <Maximize2 size={15} />
                  {t("Ouvrir en pleine largeur", "Open full width")}
                </button>
                <PageEditor
                  page={pinnedPage}
                  editable={editable}
                  onChange={(page) =>
                    mutate((current) => ({
                      ...current,
                      pages: current.pages?.map((value) =>
                        value.id === page.id ? page : value,
                      ),
                    }))
                  }
                />
              </Inspector>
            )}
            {currentBlock && (
              <Inspector
                title={t("Détails du bloc", "Block details")}
                close={() => setDetail(null)}
              >
                <div
                  className="block-detail-form detail-switch"
                  key={currentBlock.id}
                >
                  <p
                    className="detail-current"
                    style={
                      {
                        "--category-color": categoryColor(
                          currentBlock.category,
                          session.categories,
                        ),
                      } as CSSProperties
                    }
                  >
                    <span>{t("Bloc affiché", "Showing block")}</span>
                    <strong>
                      {currentBlock.title || t("Sans titre", "Untitled")}
                    </strong>
                  </p>
                  {editable && (
                    <button
                      className="toolbar-button"
                      onClick={() => {
                        setAiTarget(currentBlock.id);
                        setPanel("ai");
                      }}
                    >
                      <Sparkles size={15} />
                      {t("Aide IA pour ce bloc", "AI help for this block")}
                    </button>
                  )}
                  <label>
                    {t("Titre", "Title")}
                    <input
                      value={currentBlock.title}
                      maxLength={240}
                      readOnly={!editable}
                      onChange={(e) =>
                        editBlock(currentBlock.id, { title: e.target.value })
                      }
                    />
                  </label>
                  {(currentBlock.kind === "group" ||
                    currentBlock.kind === "parallel") && (
                    <GroupEditor
                      block={currentBlock}
                      onChange={(block) => editBlock(block.id, block)}
                      disabled={!editable}
                      columns={session.columns}
                      categories={session.categories}
                      activeBlockId={
                        ["running", "paused"].includes(session.run.status)
                          ? (session.run.blockId ?? undefined)
                          : undefined
                      }
                    />
                  )}
                  <div className="form-grid">
                    <label>
                      {t("Durée (minutes)", "Duration (minutes)")}
                      <DurationField
                        label={t("Durée du bloc", "Block duration")}
                        value={blockDuration(currentBlock)}
                        readOnly={
                          !editable ||
                          ["note", "group", "parallel"].includes(
                            currentBlock.kind ?? "",
                          )
                        }
                        change={(value) =>
                          editBlock(currentBlock.id, { duration: value })
                        }
                      />
                    </label>
                    <label>
                      {t("Catégorie", "Category")}
                      <select
                        value={currentBlock.category}
                        disabled={!editable}
                        onChange={(e) =>
                          editBlock(currentBlock.id, {
                            category: e.target.value as Category,
                          })
                        }
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {categoryLabel(c)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="field-label">
                      <span>{t("Intervenant", "Facilitator")}</span>
                      <AssigneePicker
                        block={currentBlock}
                        disabled={!editable}
                        change={(patch) => editBlock(currentBlock.id, patch)}
                      />
                    </div>
                    <label>
                      {t("Section", "Section")}
                      <input
                        value={currentBlock.section}
                        maxLength={240}
                        placeholder={t(
                          "Ex. Construire ensemble",
                          "e.g. Create together",
                        )}
                        readOnly={!editable}
                        onChange={(e) =>
                          editBlock(currentBlock.id, {
                            section: e.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    {t("Description", "Description")}
                    <RichTextEditor
                      ariaLabel={t("Description du bloc", "Block description")}
                      maxLength={30000}
                      value={currentBlock.description}
                      disabled={!editable}
                      onChange={(value) =>
                        editBlock(currentBlock.id, { description: value })
                      }
                    />
                  </label>
                  {session.columns
                    .filter(
                      (c) => !["description", "facilitator"].includes(c.id),
                    )
                    .map((c) => (
                      <label key={c.id}>
                        <span>
                          {c.visibility === "team" && <LockKeyhole size={13} />}{" "}
                          {c.label}
                        </span>
                        <RichTextEditor
                          ariaLabel={c.label}
                          maxLength={30000}
                          value={currentBlock.fields[c.id] ?? ""}
                          disabled={!editable}
                          onChange={(value) =>
                            editBlock(currentBlock.id, {
                              fields: {
                                ...currentBlock.fields,
                                [c.id]: value,
                              },
                            })
                          }
                        />
                        <small>
                          {c.visibility === "team"
                            ? t(
                                "Réservé à l’équipe, absent des liens visiteurs.",
                                "Team only, excluded from visitor links.",
                              )
                            : t(
                                "Visible dans les liens visiteurs.",
                                "Visible through visitor links.",
                              )}
                        </small>
                      </label>
                    ))}
                  <label>
                    {t(
                      "Verrouiller l’heure de début (facultatif)",
                      "Lock start time (optional)",
                    )}
                    <div className="button-row">
                      <input
                        type="time"
                        value={currentBlock.lockedStart ?? ""}
                        readOnly={!editable}
                        onChange={(e) =>
                          editBlock(currentBlock.id, {
                            lockedStart: e.target.value || undefined,
                          })
                        }
                      />
                      {currentBlock.lockedStart && editable && (
                        <button
                          className="button secondary small"
                          onClick={() =>
                            editBlock(currentBlock.id, {
                              lockedStart: undefined,
                            })
                          }
                        >
                          {t("Déverrouiller", "Unlock")}
                        </button>
                      )}
                    </div>
                  </label>
                  <div className="modal-actions spread">
                    <div className="button-row">
                      {editable && (
                        <>
                          <button
                            className="icon-button"
                            disabled={
                              day.blocks.indexOf(currentBlock) <= 0 ||
                              containsActive(currentBlock)
                            }
                            title={t("Monter", "Move up")}
                            onClick={() =>
                              moveBlock(
                                currentBlock.id,
                                day.blocks[day.blocks.indexOf(currentBlock) - 1]
                                  .id,
                              )
                            }
                          >
                            <ArrowUp size={18} />
                          </button>
                          <button
                            className="icon-button"
                            disabled={
                              day.blocks.indexOf(currentBlock) < 0 ||
                              day.blocks.at(-1)!.id === currentBlock.id ||
                              containsActive(currentBlock)
                            }
                            title={t("Descendre", "Move down")}
                            onClick={() =>
                              moveBlock(
                                currentBlock.id,
                                day.blocks[day.blocks.indexOf(currentBlock) + 1]
                                  .id,
                              )
                            }
                          >
                            <ArrowDown size={18} />
                          </button>
                          <button
                            className="button secondary small"
                            onClick={() => duplicateBlock(currentBlock)}
                          >
                            <Copy size={15} />
                            {t("Dupliquer", "Duplicate")}
                          </button>
                          <button
                            className="icon-button danger"
                            disabled={containsActive(currentBlock)}
                            title={t(
                              "Supprimer (annulable)",
                              "Delete (undo available)",
                            )}
                            onClick={() => removeBlock(currentBlock.id)}
                          >
                            <Trash2 size={17} />
                          </button>
                        </>
                      )}
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setDetail(null)}
                    >
                      {t("Terminé", "Done")}
                    </button>
                  </div>
                </div>
              </Inspector>
            )}
            {panel === "columns" && (
              <ColumnsPanel
                session={session}
                editable={editable}
                update={mutate}
                close={() => setPanel(null)}
              />
            )}
            {panel === "share" && (
              <SharePanel
                session={session}
                role={role}
                close={() => setPanel(null)}
              />
            )}
            {panel === "settings" && (
              <SettingsPanel
                session={session}
                editable={editable}
                isAdmin={!!user.isAdmin}
                update={mutate}
                close={() => setPanel(null)}
              />
            )}
            {panel === "lifecycle" && (
              <LifecyclePanel
                session={session}
                role={role}
                user={user}
                close={() => setPanel(null)}
                reload={data.load}
                onDeleted={() => navigate("/")}
              />
            )}
            {panel === "ai" && (
              <AiPanel
                session={session}
                initialBlockId={aiTarget}
                editable={editable}
                isAdmin={user.isAdmin}
                flush={flush}
                reload={data.load}
                dayId={day.id}
                enabled={aiEnabled}
                update={mutate}
                close={() => setPanel(null)}
              />
            )}
            {panel === "history" && (
              <HistoryPanel
                session={session}
                editable={editable}
                reload={data.load}
                close={() => setPanel(null)}
              />
            )}
            {panel === "comments" && (
              <CommentsPanel
                session={session}
                initialBlockId={commentTarget.blockId}
                initialCommentId={commentTarget.commentId}
                close={() => {
                  setPanel(null);
                  setCommentTarget({});
                }}
                onSelectBlock={(blockId) => {
                  const target = session.days.find((day) =>
                    allBlocks(day.blocks).some((block) => block.id === blockId),
                  );
                  if (target) setSelectedDay(target.id);
                  showDetail(blockId);
                }}
              >
                <PublicDiscussion
                  session={session}
                  role={role}
                  readOnly={!!session.lifecycle?.closedAt}
                />
              </CommentsPanel>
            )}
            {panel === "import" && (
              <ImportPanel
                session={session}
                enabled={aiEnabled}
                dayId={day.id}
                update={mutate}
                close={() => setPanel(null)}
              />
            )}
            {panel === "export" && (
              <ExportPanel
                session={session}
                aiEnabled={aiEnabled}
                flush={flush}
                close={() => setPanel(null)}
                print={(agenda, privateAudience, options) => {
                  setPanel(null);
                  setPrintAgenda({ session: agenda, privateAudience, options });
                }}
              />
            )}
            {panel === "preparation" && (
              <TasksMaterialsPanel
                session={session}
                dayId={day.id}
                editable={editable}
                update={mutate}
                close={() => setPanel(null)}
                onSelectBlock={showDetail}
              />
            )}
            {panel === "categories" && (
              <CategoryPanel
                session={session}
                editable={editable}
                update={mutate}
                close={() => setPanel(null)}
              />
            )}
            <PrintableAgenda
              session={printAgenda?.session ?? session}
              privateAudience={printAgenda?.privateAudience ?? true}
              options={printAgenda?.options}
            />
          </div>
        </ActualDurationsContext.Provider>
      </MentionProvider>
    </DisplayTimeProvider>
  );
}
