import { useCallback, useEffect, useRef, useState } from "react";
import { LockKeyhole, MessageSquare, Reply, Users, X } from "lucide-react";
import type { Session } from "../shared/model";
import type {
  Collaborator,
  CommentsResponse,
  CommentThread,
} from "../shared/comments";
import type { VisitorComment } from "../shared/sharing";
import { allBlocks } from "../shared/domain";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner, Inspector } from "./ui";
import { ChatComposer, ChatMessage, ChatThread } from "./Chat";
import "./comments.css";

type Audience = "participants" | "team";
interface Link {
  id: string;
  label: string;
}
/** A conversation of either audience, in one list. */
type Conversation =
  | {
      key: string;
      audience: "team";
      blockId: string | null;
      resolved: boolean;
      last: string;
      thread: CommentThread;
    }
  | {
      key: string;
      audience: "participants";
      blockId: string | null;
      resolved: boolean;
      last: string;
      root: VisitorComment;
      replies: VisitorComment[];
    };

/**
 * One discussion per session: conversations with the participants of visitor
 * links (visible to them) and private ones within the team, in a single
 * chat-like list. Each conversation says who can read it; the composer
 * chooses the audience of a new one.
 */
function CommentsPanel({
  session,
  role,
  close,
  onSelectBlock,
  initialBlockId,
  initialCommentId,
}: {
  session: Session;
  role?: string;
  close: () => void;
  onSelectBlock?: (blockId: string) => void;
  initialBlockId?: string;
  initialCommentId?: string;
}) {
  const { t } = useI18n(),
    [threads, setThreads] = useState<CommentThread[]>([]),
    [visitor, setVisitor] = useState<VisitorComment[]>([]),
    [links, setLinks] = useState<Link[]>([]),
    [collaborators, setCollaborators] = useState<Collaborator[]>([]),
    [filter, setFilter] = useState<"all" | Audience>("all"),
    [blockFilter, setBlockFilter] = useState(initialBlockId ?? ""),
    [audience, setAudience] = useState<Audience | null>(null),
    [linkId, setLinkId] = useState(""),
    [blockId, setBlockId] = useState(initialBlockId ?? ""),
    [reply, setReply] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [pages, setPages] = useState(1),
    // Long team threads whose every message was asked for.
    [expanded, setExpanded] = useState<string[]>([]);
  const generation = useRef(0),
    working = useRef(false),
    list = useRef<HTMLDivElement>(null),
    scrolled = useRef(false),
    readOnly = !!session.lifecycle?.closedAt,
    organizer = role !== "viewer",
    blocks = session.days.flatMap((day) => allBlocks(day.blocks));
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const results: CommentThread[] = [];
      let more = false;
      for (let page = 0; page < pages; page++) {
        const result = await api<CommentsResponse>(
          `/sessions/${session.id}/comments?status=all&sort=updated&offset=${page * 20}`,
          { signal },
        );
        results.push(...result.threads);
        more = result.hasMore;
        if (!more) break;
      }
      for (const threadId of expanded) {
        const index = results.findIndex((thread) => thread.id === threadId);
        if (index >= 0)
          results[index] = (
            await api<{ thread: CommentThread }>(
              `/sessions/${session.id}/comments/${threadId}`,
              { signal },
            )
          ).thread;
      }
      const participants = await api<{
        comments: VisitorComment[];
        links: Link[];
      }>(`/sessions/${session.id}/visitor-comments`, { signal });
      if (!signal?.aborted) {
        setThreads([
          ...new Map(results.map((thread) => [thread.id, thread])).values(),
        ]);
        setHasMore(more);
        setVisitor(participants.comments);
        setLinks(participants.links);
        setError("");
      }
    },
    [session.id, pages, expanded],
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

  const conversations: Conversation[] = [
    ...threads.map((thread): Conversation => ({
      key: `team-${thread.id}`,
      audience: "team",
      blockId: thread.blockId,
      resolved: !!thread.resolvedAt,
      last: thread.updatedAt,
      thread,
    })),
    ...visitor
      .filter((comment) => !comment.parentId)
      .map((root): Conversation => {
        const replies = visitor.filter(
          (comment) => comment.parentId === root.id,
        );
        return {
          key: `participants-${root.id}`,
          audience: "participants",
          blockId: root.blockId,
          resolved: root.resolved,
          last: [root, ...replies].at(-1)!.createdAt,
          root,
          replies,
        };
      }),
  ]
    // Oldest first, like a chat: the latest activity sits by the composer.
    .sort((a, b) => a.last.localeCompare(b.last));
  const shown = conversations.filter(
    (conversation) =>
      (filter === "all" || conversation.audience === filter) &&
      (!blockFilter || conversation.blockId === blockFilter),
  );
  const count = (value: Audience) =>
    conversations.filter((conversation) => conversation.audience === value)
      .length;
  // Participants by default when a link accepts comments.
  const target: Audience =
    audience ?? (links.length && organizer ? "participants" : "team");
  const link = links.find((value) => value.id === linkId) ?? links[0];

  // Open on the latest messages, or on the comment a notification points to.
  useEffect(() => {
    if (scrolled.current || (!threads.length && !visitor.length)) return;
    scrolled.current = true;
    requestAnimationFrame(() => {
      const focused = initialCommentId
        ? document.getElementById(`comment-${initialCommentId}`)
        : null;
      if (focused) focused.scrollIntoView({ block: "center" });
      else if (list.current) list.current.scrollTop = list.current.scrollHeight;
    });
  }, [threads.length, visitor.length, initialCommentId]);

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
  const blockTitle = (id: string | null) =>
    id
      ? (blocks.find((block) => block.id === id)?.title ??
        t("Bloc supprimé", "Deleted block"))
      : null;
  const blockTag = (id: string | null) =>
    id && (
      <button
        type="button"
        className="chat-tag"
        title={t("Afficher ce bloc", "Show this block")}
        onClick={() => onSelectBlock?.(id)}
      >
        {blockTitle(id)}
      </button>
    );

  return (
    <Inspector
      title={t("Discussion", "Discussion")}
      subtitle={t(
        "Avec les participants de vos liens, et en privé avec votre équipe.",
        "With your links’ participants, and privately within your team.",
      )}
      close={close}
    >
      <div className="discussion">
        <div className="discussion-filters" role="group">
          {(
            [
              ["all", t("Tout", "All"), conversations.length],
              [
                "participants",
                t("Participants", "Participants"),
                count("participants"),
              ],
              ["team", t("Équipe", "Team"), count("team")],
            ] as const
          ).map(([value, label, total]) => (
            <button
              key={value}
              type="button"
              className={`discussion-filter ${filter === value ? "active" : ""}`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
              <span>{total}</span>
            </button>
          ))}
          {blockFilter && (
            <button
              type="button"
              className="chat-tag discussion-block-filter"
              title={t("Afficher tous les blocs", "Show all blocks")}
              onClick={() => setBlockFilter("")}
            >
              {blockTitle(blockFilter)}
              <X size={12} />
            </button>
          )}
        </div>
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
            retry={() =>
              void reload().catch((cause) => setError(cause.message))
            }
          />
        )}
        <div className="discussion-list" ref={list}>
          {hasMore && (
            <button
              className="button secondary small"
              onClick={() => setPages((value) => value + 1)}
            >
              {t(
                "Charger les discussions plus anciennes",
                "Load older threads",
              )}
            </button>
          )}
          {shown.map((conversation) =>
            conversation.audience === "team" ? (
              <ChatThread
                key={conversation.key}
                header={
                  <>
                    <span className="chat-tag team">
                      <LockKeyhole size={11} />
                      {t("Équipe", "Team")}
                    </span>
                    {blockTag(conversation.blockId)}
                  </>
                }
                resolved={conversation.resolved}
                summary={`${conversation.thread.comments[0]?.author ?? ""} : ${conversation.thread.comments[0]?.text ?? ""}`}
                count={conversation.thread.totalComments}
                canResolve={!readOnly}
                busy={busy}
                onResolve={() =>
                  void action(() =>
                    api(
                      `/sessions/${session.id}/comments/${conversation.thread.id}`,
                      {
                        method: "PATCH",
                        body: JSON.stringify({
                          resolved: !conversation.resolved,
                          revision: conversation.thread.revision,
                        }),
                      },
                    ),
                  ).catch(() => {})
                }
                reply={
                  readOnly ? null : reply === conversation.key ? (
                    <div className="chat-reply">
                      <ChatComposer
                        focusOnMount
                        collaborators={collaborators}
                        busy={busy}
                        label={t("Votre réponse", "Your reply")}
                        placeholder={t(
                          "Répondre à l’équipe… @ pour mentionner",
                          "Reply to the team… @ to mention",
                        )}
                        onSend={async (text, mentions) => {
                          await action(() =>
                            post(`/sessions/${session.id}/comments`, {
                              text,
                              mentions,
                              parentId: conversation.thread.id,
                            }),
                          );
                          setReply(null);
                        }}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-button chat-reply-button"
                      onClick={() => setReply(conversation.key)}
                    >
                      <Reply size={13} />
                      {t("Répondre", "Reply")}
                    </button>
                  )
                }
              >
                {conversation.thread.hasMore && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setExpanded((values) => [
                        ...new Set([...values, conversation.thread.id]),
                      ])
                    }
                  >
                    {t(
                      `Voir les ${conversation.thread.totalComments} messages`,
                      `Show all ${conversation.thread.totalComments} messages`,
                    )}
                  </button>
                )}
                {conversation.thread.comments.map((comment) => (
                  <ChatMessage
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    author={comment.author}
                    createdAt={comment.createdAt}
                    text={comment.text}
                    reply={!!comment.parentId}
                    extra={
                      comment.mentions.length > 0 && (
                        <div className="chat-mentions">
                          {comment.mentions.map((member) => (
                            <span key={member.id}>@{member.name}</span>
                          ))}
                        </div>
                      )
                    }
                  />
                ))}
              </ChatThread>
            ) : (
              <ChatThread
                key={conversation.key}
                header={
                  <>
                    <span
                      className="chat-tag participants"
                      title={t(
                        "Visible par les personnes ayant ce lien",
                        "Visible to people with this link",
                      )}
                    >
                      <Users size={11} />
                      {conversation.root.shareLabel ??
                        t("Lien supprimé", "Deleted link")}
                    </span>
                    {blockTag(conversation.blockId)}
                  </>
                }
                resolved={conversation.resolved}
                summary={`${conversation.root.author} : ${conversation.root.text}`}
                count={1 + conversation.replies.length}
                canResolve={organizer && !readOnly}
                busy={busy}
                onResolve={() =>
                  void action(() =>
                    api(
                      `/sessions/${session.id}/visitor-comments/${conversation.root.id}`,
                      {
                        method: "PATCH",
                        body: JSON.stringify({
                          resolved: !conversation.resolved,
                        }),
                      },
                    ),
                  ).catch(() => {})
                }
                reply={
                  readOnly || !organizer ? null : reply === conversation.key ? (
                    <div className="chat-reply">
                      <ChatComposer
                        focusOnMount
                        busy={busy}
                        label={t("Votre réponse", "Your reply")}
                        placeholder={t(
                          "Répondre aux participants…",
                          "Reply to the participants…",
                        )}
                        onSend={async (text) => {
                          await action(() =>
                            post(
                              `/sessions/${session.id}/visitor-comments/${conversation.root.id}/replies`,
                              { text },
                            ),
                          );
                          setReply(null);
                        }}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-button chat-reply-button"
                      onClick={() => setReply(conversation.key)}
                    >
                      <Reply size={13} />
                      {t("Répondre", "Reply")}
                    </button>
                  )
                }
              >
                {[conversation.root, ...conversation.replies].map((comment) => (
                  <ChatMessage
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    author={comment.author}
                    createdAt={comment.createdAt}
                    text={comment.text}
                    team={comment.team}
                    reply={!!comment.parentId}
                  />
                ))}
              </ChatThread>
            ),
          )}
          {!shown.length && (
            <div className="empty-comments">
              <MessageSquare size={24} />
              <p>
                {filter === "participants" && !links.length
                  ? t(
                      "Aucun lien visiteur n’accepte les commentaires. Activez-les dans Partager.",
                      "No visitor link accepts comments. Enable them in Share.",
                    )
                  : t("Aucune discussion pour le moment.", "No threads yet.")}
              </p>
            </div>
          )}
        </div>
        {!readOnly && (
          <footer className="discussion-composer">
            <div className="discussion-composer-options">
              {organizer && (
                <div
                  className="discussion-audience"
                  role="radiogroup"
                  aria-label={t("Visible par", "Visible to")}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={target === "participants"}
                    disabled={!links.length}
                    title={
                      links.length
                        ? undefined
                        : t(
                            "Aucun lien visiteur n’accepte les commentaires",
                            "No visitor link accepts comments",
                          )
                    }
                    className={target === "participants" ? "active" : ""}
                    onClick={() => setAudience("participants")}
                  >
                    <Users size={13} />
                    {t("Participants", "Participants")}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={target === "team"}
                    className={target === "team" ? "active" : ""}
                    onClick={() => setAudience("team")}
                  >
                    <LockKeyhole size={13} />
                    {t("Équipe", "Team")}
                  </button>
                </div>
              )}
              {target === "participants" && links.length > 1 && (
                <select
                  aria-label={t("Lien", "Link")}
                  value={link?.id}
                  onChange={(event) => setLinkId(event.target.value)}
                >
                  {links.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.label}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label={t("À propos de", "About")}
                value={blockId}
                onChange={(event) => setBlockId(event.target.value)}
              >
                <option value="">
                  {t("Toute la séance", "Whole session")}
                </option>
                {blocks.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.title}
                  </option>
                ))}
              </select>
            </div>
            <ChatComposer
              collaborators={target === "team" ? collaborators : []}
              busy={busy}
              label={t("Nouveau message", "New message")}
              placeholder={
                target === "participants"
                  ? t(
                      `Écrire aux participants de « ${link?.label ?? ""} »…`,
                      `Write to the participants of “${link?.label ?? ""}”…`,
                    )
                  : t(
                      "Écrire à l’équipe… @ pour mentionner",
                      "Write to the team… @ to mention",
                    )
              }
              onSend={(text, mentions) =>
                action(() =>
                  target === "participants" && link
                    ? post(`/sessions/${session.id}/visitor-comments`, {
                        shareId: link.id,
                        text,
                        blockId: blockId || null,
                      })
                    : post(`/sessions/${session.id}/comments`, {
                        text,
                        mentions,
                        blockId: blockId || null,
                      }),
                ).then(() => {
                  requestAnimationFrame(() => {
                    if (list.current)
                      list.current.scrollTop = list.current.scrollHeight;
                  });
                })
              }
            />
            <small className="discussion-hint">
              {target === "participants"
                ? t(
                    "Visible par les personnes ayant ce lien, avec votre nom.",
                    "Visible to people with this link, with your name.",
                  )
                : t(
                    "Visible uniquement par l’équipe de la séance.",
                    "Visible only to the session’s team.",
                  )}
            </small>
          </footer>
        )}
      </div>
    </Inspector>
  );
}
export default CommentsPanel;
