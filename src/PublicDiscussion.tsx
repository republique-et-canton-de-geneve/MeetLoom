import { useEffect, useState } from "react";
import { MessageSquare, Reply, Check } from "lucide-react";
import type { PublicSession, Role } from "../shared/model";
import type { VisitorComment } from "../shared/sharing";
import { allBlocks } from "../shared/domain";
import { useI18n } from "./i18n";
import { api } from "./api";
import { Avatar, ErrorBanner } from "./ui";

export default function PublicDiscussion({
  session,
  token,
  role,
  readOnly = false,
}: {
  session: PublicSession;
  token?: string;
  role?: Role;
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const [comments, setComments] = useState<VisitorComment[]>([]),
    [text, setText] = useState(""),
    [name, setName] = useState(() => {
      try {
        return localStorage.getItem("meetloom.visitor-name") ?? "";
      } catch {
        return "";
      }
    }),
    [blockId, setBlockId] = useState(""),
    [reply, setReply] = useState<VisitorComment | null>(null),
    [resolved, setResolved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const path = token
    ? `/public/${encodeURIComponent(token)}/comments`
    : `/sessions/${session.id}/visitor-comments`;
  const request = <T,>(suffix = "", init: RequestInit = {}) =>
    api<T>(path + suffix, {
      ...init,
      ...(token ? { credentials: "omit" as const } : {}),
    });
  const load = async () => {
    try {
      const result = await request<{ comments: VisitorComment[] }>();
      setComments(result.comments);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    setComments([]);
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [path]);
  const blocks = session.days.flatMap((day) => allBlocks(day.blocks));
  const roots = comments.filter(
    (comment) =>
      !comment.parentId &&
      (!blockId || comment.blockId === blockId) &&
      (resolved || !comment.resolved),
  );
  const canResolve = !readOnly && role && role !== "viewer";
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (readOnly) return;
    setBusy(true);
    setError("");
    try {
      if (token) {
        await request("", {
          method: "POST",
          body: JSON.stringify({
            author: name,
            text,
            blockId: blockId || null,
            parentId: reply?.id ?? null,
          }),
        });
        try {
          localStorage.setItem("meetloom.visitor-name", name);
        } catch {
          /* Storage is optional. */
        }
      } else if (reply)
        await request(`/${reply.id}/replies`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });
      setText("");
      setReply(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const commentView = (comment: VisitorComment) => (
    <article className="comment" key={comment.id}>
      <Avatar name={comment.author} small />
      <div>
        <div className="comment-meta">
          <strong>{comment.author}</strong>
          <time>
            {new Date(comment.createdAt).toLocaleString(locale, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </time>
        </div>
        <p>{comment.text}</p>
      </div>
    </article>
  );
  return (
    <section
      className="visitor-discussion"
      aria-label={t("Conversation visiteurs", "Visitor conversation")}
    >
      <h3>
        <MessageSquare size={18} />
        {t("Conversation visiteurs", "Visitor conversation")}
      </h3>
      <p className="muted">
        {t(
          "Ces échanges et votre nom sont visibles par les visiteurs de ce lien et par l’équipe.",
          "These messages and your name are visible to visitors of this link and to the team.",
        )}
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="form-grid">
        <label>
          {t("À propos de", "About")}
          <select
            value={blockId}
            onChange={(event) => {
              setBlockId(event.target.value);
              setReply(null);
            }}
          >
            <option value="">{t("Toute la séance", "Whole session")}</option>
            {blocks.map((block) => (
              <option value={block.id} key={block.id}>
                {block.title}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={resolved}
            onChange={(event) => setResolved(event.target.checked)}
          />
          {t("Afficher les échanges résolus", "Show resolved discussions")}
        </label>
      </div>
      <div className="comments-list">
        {roots.length ? (
          roots.map((root) => (
            <div
              className={`discussion-thread ${root.resolved ? "resolved" : ""}`}
              key={root.id}
            >
              {root.blockId && (
                <small className="tag">
                  {blocks.find((block) => block.id === root.blockId)?.title ??
                    t("Ancien bloc", "Previous block")}
                </small>
              )}
              {commentView(root)}
              <div className="discussion-replies">
                {comments
                  .filter((comment) => comment.parentId === root.id)
                  .map(commentView)}
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary small"
                  disabled={readOnly}
                  onClick={() => {
                    setReply(root);
                    setBlockId(root.blockId ?? "");
                  }}
                >
                  <Reply size={14} />
                  {t("Répondre", "Reply")}
                </button>
                {root.resolved && (
                  <span className="tag">
                    <Check size={13} />
                    {t("Résolu", "Resolved")}
                  </span>
                )}
                {canResolve && (
                  <button
                    className="button secondary small"
                    onClick={async () => {
                      try {
                        await request(`/${root.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ resolved: !root.resolved }),
                        });
                        await load();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {root.resolved
                      ? t("Rouvrir", "Reopen")
                      : t("Résoudre", "Resolve")}
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="muted">
            {t("Aucun échange dans cette vue.", "No discussions in this view.")}
          </p>
        )}
      </div>
      {readOnly && (
        <p className="muted">
          {t(
            "Séance clôturée : les échanges sont en lecture seule.",
            "Closed session: discussions are read-only.",
          )}
        </p>
      )}
      {!readOnly && (token || reply) && (
        <form onSubmit={submit}>
          {reply && (
            <div className="privacy-explainer">
              <span>
                {t("Réponse à", "Reply to")} {reply.author}
              </span>
              <button
                type="button"
                className="button secondary small"
                onClick={() => setReply(null)}
              >
                {t("Annuler", "Cancel")}
              </button>
            </div>
          )}
          {token && (
            <label>
              {t("Votre nom", "Your name")}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={80}
              />
            </label>
          )}
          <label>
            {t("Votre commentaire", "Your comment")}
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              required
              maxLength={4000}
              rows={3}
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !text.trim() || (!!token && !name.trim())}
          >
            {t("Publier le commentaire", "Post comment")}
          </button>
        </form>
      )}
    </section>
  );
}
