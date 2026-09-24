import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  CornerDownRight,
  MessageSquare,
  RotateCcw,
  Send,
} from "lucide-react";
import type { Session } from "../shared/model";
import type {
  Collaborator,
  CommentsResponse,
  CommentThread,
} from "../shared/comments";
import { allBlocks } from "../shared/domain";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { Avatar, ErrorBanner, Inspector } from "./ui";
import "./comments.css";

export function CommentComposer({
  collaborators,
  busy,
  onSend,
  placeholder,
}: {
  collaborators: Collaborator[];
  busy: boolean;
  onSend: (text: string, mentions: string[]) => Promise<void>;
  placeholder?: string;
}) {
  const { t } = useI18n(),
    [text, setText] = useState(""),
    [mentions, setMentions] = useState<Collaborator[]>([]),
    [query, setQuery] = useState<string | null>(null),
    [selection, setSelection] = useState(0),
    input = useRef<HTMLTextAreaElement>(null);
  const options =
    query === null
      ? []
      : collaborators
          .filter((member) =>
            member.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          )
          .slice(0, 8);
  const choose = (member: Collaborator) => {
    const element = input.current,
      caret = element?.selectionStart ?? text.length,
      before = text.slice(0, caret),
      start = before.search(/@[\p{L}\p{N}_. -]*$/u),
      label = `@${member.name} `;
    const next =
      text.slice(0, start < 0 ? caret : start) + label + text.slice(caret);
    if (next.length > 4000) return;
    setText(next);
    setMentions((previous) => [
      ...previous.filter((value) => value.id !== member.id),
      member,
    ]);
    setQuery(null);
    requestAnimationFrame(() => {
      element?.focus();
      const position = (start < 0 ? caret : start) + label.length;
      element?.setSelectionRange(position, position);
    });
  };
  return (
    <form
      className="comment-composer"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !text.trim()) return;
        try {
          await onSend(
            text,
            mentions
              .filter((member) => text.includes(`@${member.name}`))
              .map((member) => member.id),
          );
          setText("");
          setMentions([]);
          setQuery(null);
        } catch {
          /* The parent displays the error; preserve this draft. */
        }
      }}
    >
      <textarea
        ref={input}
        aria-label={t("Votre commentaire", "Your comment")}
        value={text}
        maxLength={4000}
        rows={3}
        placeholder={
          placeholder ??
          t(
            "Écrivez un commentaire… @ pour mentionner",
            "Write a comment… @ to mention",
          )
        }
        disabled={busy}
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          const before = value.slice(0, event.target.selectionStart),
            match = before.match(/(?:^|\s)@([\p{L}\p{N}_. -]*)$/u);
          setQuery(match?.[1] ?? null);
          setSelection(0);
        }}
        onKeyDown={(event) => {
          if (query === null) return;
          if (event.key === "Escape") {
            event.stopPropagation();
            setQuery(null);
          }
          if (event.key === "ArrowDown" && options.length) {
            event.preventDefault();
            setSelection((value) => (value + 1) % options.length);
          }
          if (event.key === "ArrowUp" && options.length) {
            event.preventDefault();
            setSelection(
              (value) => (value + options.length - 1) % options.length,
            );
          }
          if (event.key === "Enter" && options.length) {
            event.preventDefault();
            choose(options[selection % options.length]);
          }
        }}
      />
      {query !== null && (
        <div
          className="mention-options"
          role="listbox"
          aria-label={t("Collaborateurs", "Collaborators")}
        >
          {options.length ? (
            options.map((member, index) => (
              <button
                key={member.id}
                type="button"
                role="option"
                aria-selected={index === selection}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(member)}
              >
                <Avatar small name={member.name} />
                {member.name}
              </button>
            ))
          ) : (
            <p>
              {t(
                "Aucun collaborateur correspondant",
                "No matching collaborator",
              )}
            </p>
          )}
        </div>
      )}
      <div className="comment-composer-actions">
        <span>{text.length}/4000</span>
        <button
          type="submit"
          className="button primary small"
          disabled={busy || !text.trim()}
        >
          <Send size={14} />
          {t("Envoyer", "Send")}
        </button>
      </div>
    </form>
  );
}

export function CommentsPanel({
  session,
  close,
  children,
  onSelectBlock,
  initialBlockId,
  initialCommentId,
}: {
  session: Session;
  close: () => void;
  children?: ReactNode;
  onSelectBlock?: (blockId: string) => void;
  initialBlockId?: string;
  initialCommentId?: string;
}) {
  const { t, locale } = useI18n(),
    [threads, setThreads] = useState<CommentThread[]>([]),
    [collaborators, setCollaborators] = useState<Collaborator[]>([]),
    [sort, setSort] = useState<"updated" | "agenda">("updated"),
    [status, setStatus] = useState<"open" | "resolved" | "all">("open"),
    [blockId, setBlockId] = useState(initialBlockId ?? ""),
    [reply, setReply] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [pages, setPages] = useState(1);
  const generation = useRef(0),
    working = useRef(false),
    readOnly = !!session.lifecycle?.closedAt,
    blocks = session.days.flatMap((day) => allBlocks(day.blocks));
  const [expanded, setExpanded] = useState<string[]>([]);
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const results: CommentThread[] = [];
      let more = false;
      for (let page = 0; page < pages; page++) {
        const result = await api<CommentsResponse>(
          `/sessions/${session.id}/comments?status=${status}&sort=${sort}&offset=${page * 20}`,
          { signal },
        );
        results.push(...result.threads);
        more = result.hasMore;
        if (!more) break;
      }
      for (const threadId of expanded) {
        const index = results.findIndex((thread) => thread.id === threadId);
        if (index >= 0) {
          const detail = await api<{ thread: CommentThread }>(
            `/sessions/${session.id}/comments/${threadId}`,
            { signal },
          );
          results[index] = detail.thread;
        }
      }
      if (
        initialCommentId &&
        !results.some((thread) =>
          thread.comments.some((comment) => comment.id === initialCommentId),
        )
      ) {
        const focused = await api<{ thread: CommentThread }>(
          `/sessions/${session.id}/comments/${encodeURIComponent(initialCommentId)}`,
          { signal },
        );
        results.unshift(focused.thread);
      }
      if (!signal?.aborted) {
        setThreads([
          ...new Map(results.map((thread) => [thread.id, thread])).values(),
        ]);
        setHasMore(more);
        setError("");
      }
    },
    [session.id, status, sort, pages, initialCommentId, expanded],
  );
  useEffect(() => {
    const lifecycle = ++generation.current,
      controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        await reload(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted && generation.current === lifecycle)
          setError((cause as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void load();
    void api<{ collaborators: Collaborator[] }>(
      `/sessions/${session.id}/collaborators`,
      { signal: controller.signal },
    )
      .then((result) => setCollaborators(result.collaborators))
      .catch(() => {});
    const interval = setInterval(() => void load(), 5000);
    return () => {
      generation.current++;
      controller.abort();
      clearInterval(interval);
    };
  }, [reload, session.id]);
  useEffect(() => {
    if (initialCommentId) {
      setStatus("all");
      requestAnimationFrame(() =>
        document
          .getElementById(`comment-${initialCommentId}`)
          ?.scrollIntoView({ block: "center" }),
      );
    }
  }, [initialCommentId, threads.length]);
  const action = async (work: () => Promise<unknown>) => {
    if (readOnly)
      throw new Error(
        t("Cette séance est clôturée.", "This session is closed."),
      );
    if (working.current) throw new Error("Busy");
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
      await reload().catch((cause) => setError(cause.message));
      window.dispatchEvent(new Event("meetloom:notifications"));
    } catch (cause) {
      setError((cause as Error).message);
      throw cause;
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return (
    <Inspector
      title={t("La conversation de l’équipe", "Team conversation")}
      subtitle={t(
        "Commentaires privés aux collaborateurs de cette séance.",
        "Comments are private to this session’s collaborators.",
      )}
      close={close}
    >
      {readOnly && (
        <p className="muted" role="status">
          {t(
            "Cette séance est clôturée. Les discussions restent consultables en lecture seule.",
            "This session is closed. Discussions remain available as read-only.",
          )}
        </p>
      )}
      {error && (
        <ErrorBanner
          message={error}
          retry={() => void reload().catch((cause) => setError(cause.message))}
        />
      )}
      <div className="comment-filters">
        <label>
          {t("Afficher", "Show")}
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPages(1);
            }}
          >
            <option value="open">{t("En cours", "Open")}</option>
            <option value="resolved">{t("Résolus", "Resolved")}</option>
            <option value="all">{t("Tous", "All")}</option>
          </select>
        </label>
        <label>
          {t("Trier", "Sort")}
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as typeof sort);
              setPages(1);
            }}
          >
            <option value="updated">
              {t("Activité récente", "Recent activity")}
            </option>
            <option value="agenda">
              {t("Ordre de l’agenda", "Agenda order")}
            </option>
          </select>
        </label>
      </div>
      <div className="team-comment-threads">
        {threads.map((thread) => (
          <article
            key={thread.id}
            className={`team-comment-thread ${thread.resolvedAt ? "is-resolved" : ""}`}
          >
            <header>
              <button
                className="text-button"
                disabled={!thread.blockId || !onSelectBlock}
                onClick={() =>
                  thread.blockId && onSelectBlock?.(thread.blockId)
                }
              >
                {thread.blockId
                  ? (blocks.find((block) => block.id === thread.blockId)
                      ?.title ?? t("Bloc supprimé", "Deleted block"))
                  : t("Séance entière", "Whole session")}
              </button>
              <button
                className="icon-button"
                disabled={busy || readOnly}
                title={
                  thread.resolvedAt
                    ? t("Rouvrir la discussion", "Reopen thread")
                    : t("Résoudre la discussion", "Resolve thread")
                }
                aria-label={
                  thread.resolvedAt
                    ? t("Rouvrir la discussion", "Reopen thread")
                    : t("Résoudre la discussion", "Resolve thread")
                }
                onClick={() =>
                  void action(() =>
                    api(`/sessions/${session.id}/comments/${thread.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        resolved: !thread.resolvedAt,
                        revision: thread.revision,
                      }),
                    }),
                  ).catch(() => {})
                }
              >
                {thread.resolvedAt ? (
                  <RotateCcw size={16} />
                ) : (
                  <Check size={16} />
                )}
              </button>
            </header>
            {thread.resolvedAt && (
              <small className="resolved-label">
                <Check size={12} />
                {t("Résolu", "Resolved")}
              </small>
            )}
            {thread.hasMore && (
              <button
                className="text-button"
                onClick={() =>
                  setExpanded((values) => [...new Set([...values, thread.id])])
                }
              >
                {t("Voir toutes les réponses", "Show all replies")} (
                {thread.totalComments})
              </button>
            )}
            {thread.comments.map((comment) => (
              <div
                className={`comment ${comment.parentId ? "comment-reply" : ""}`}
                key={comment.id}
                id={`comment-${comment.id}`}
              >
                <Avatar name={comment.author} small />
                <div>
                  <div className="comment-meta">
                    <strong>{comment.author}</strong>
                    <time dateTime={comment.createdAt}>
                      {new Date(comment.createdAt).toLocaleString(locale, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{comment.text}</p>
                  {comment.mentions.length > 0 && (
                    <div className="comment-mentions">
                      {comment.mentions.map((member) => (
                        <span key={member.id}>@{member.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!thread.resolvedAt &&
              (reply === thread.id ? (
                <div hidden={readOnly}>
                  <CommentComposer
                    collaborators={collaborators}
                    busy={busy || readOnly}
                    onSend={async (text, mentions) => {
                      await action(() =>
                        post(`/sessions/${session.id}/comments`, {
                          text,
                          mentions,
                          parentId: thread.id,
                        }),
                      );
                      setReply(null);
                    }}
                  />
                </div>
              ) : (
                <button
                  className="text-button"
                  disabled={readOnly}
                  onClick={() => setReply(thread.id)}
                >
                  <CornerDownRight size={14} />
                  {t("Répondre", "Reply")}
                </button>
              ))}
          </article>
        ))}
      </div>
      {!threads.length && (
        <div className="empty-comments">
          <MessageSquare size={24} />
          <p>
            {t("Aucune discussion dans cette vue.", "No threads in this view.")}
          </p>
        </div>
      )}
      {hasMore && (
        <button
          className="button secondary small"
          onClick={() => setPages((value) => value + 1)}
        >
          {t("Charger plus de discussions", "Load more threads")}
        </button>
      )}
      <section className="new-comment-thread" hidden={readOnly}>
        <h3>{t("Nouvelle discussion", "New thread")}</h3>
        <label>
          {t("À propos de", "About")}
          <select
            value={blockId}
            onChange={(event) => setBlockId(event.target.value)}
          >
            <option value="">{t("Séance entière", "Whole session")}</option>
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>
                {block.title}
              </option>
            ))}
          </select>
        </label>
        <CommentComposer
          collaborators={collaborators}
          busy={busy || readOnly}
          onSend={async (text, mentions) => {
            await action(() =>
              post(`/sessions/${session.id}/comments`, {
                text,
                mentions,
                blockId: blockId || null,
              }),
            );
          }}
        />
      </section>
      {children}
    </Inspector>
  );
}
export default CommentsPanel;
