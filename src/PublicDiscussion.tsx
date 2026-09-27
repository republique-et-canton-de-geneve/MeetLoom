import { useEffect, useRef, useState } from "react";
import { MessageSquare, Pencil, Reply } from "lucide-react";
import type { PublicSession } from "../shared/model";
import type { VisitorComment } from "../shared/sharing";
import { allBlocks } from "../shared/domain";
import { useI18n } from "./i18n";
import { api } from "./api";
import { ErrorBanner } from "./ui";
import { ChatComposer, ChatMessage, ChatThread } from "./Chat";

const NAME = "meetloom.visitor-name";

/**
 * Questions and comments of a visitor link, as a conversation: the
 * organizers' answers are marked as theirs, resolved exchanges stay visible
 * (folded), and a reply is written under the message it answers.
 */
export default function PublicDiscussion({
  session,
  token,
  readOnly = false,
}: {
  session: PublicSession;
  token: string;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const [comments, setComments] = useState<VisitorComment[]>([]),
    [name, setName] = useState(() => {
      try {
        return localStorage.getItem(NAME) ?? "";
      } catch {
        return "";
      }
    }),
    [editingName, setEditingName] = useState(false),
    [blockId, setBlockId] = useState(""),
    [reply, setReply] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const path = `/public/${encodeURIComponent(token)}/comments`;
  const load = async () => {
    try {
      const result = await api<{ comments: VisitorComment[] }>(path, {
        credentials: "omit",
      });
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
  const roots = comments.filter((comment) => !comment.parentId);
  const send = async (text: string, parentId: string | null) => {
    setBusy(true);
    setError("");
    try {
      await api(path, {
        method: "POST",
        credentials: "omit",
        body: JSON.stringify({
          author: name.trim(),
          text,
          blockId: parentId ? null : blockId || null,
          parentId,
        }),
      });
      try {
        localStorage.setItem(NAME, name.trim());
      } catch {
        /* Storage is optional. */
      }
      setEditingName(false);
      setReply(null);
      await load();
      if (!parentId)
        requestAnimationFrame(() =>
          list.current?.lastElementChild?.scrollIntoView({ block: "nearest" }),
        );
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const named = !!name.trim() && !editingName;
  const nameField = (
    <label className="visitor-name">
      {t("Votre nom", "Your name")}
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        maxLength={80}
        placeholder={t("Prénom Nom", "First Last")}
      />
    </label>
  );
  return (
    <section
      className="visitor-discussion"
      aria-label={t("Questions et commentaires", "Questions and comments")}
    >
      <h3>
        <MessageSquare size={18} />
        {t("Questions et commentaires", "Questions and comments")}
      </h3>
      <p className="muted">
        {t(
          "Visibles par les personnes ayant ce lien et par l’équipe d’animation.",
          "Visible to people with this link and to the organizers.",
        )}
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="visitor-discussion-list" ref={list}>
        {roots.map((root) => {
          const replies = comments.filter(
            (comment) => comment.parentId === root.id,
          );
          const block = root.blockId
            ? (blocks.find((value) => value.id === root.blockId)?.title ??
              t("Ancien bloc", "Previous block"))
            : null;
          return (
            <ChatThread
              key={root.id}
              header={block && <span className="chat-tag">{block}</span>}
              resolved={root.resolved}
              summary={`${root.author} : ${root.text}`}
              count={1 + replies.length}
              canResolve={false}
              reply={
                readOnly ? null : reply === root.id ? (
                  <div className="chat-reply">
                    {!named && nameField}
                    <ChatComposer
                      focusOnMount
                      busy={busy || !name.trim()}
                      label={t("Votre réponse", "Your reply")}
                      placeholder={t("Répondre…", "Reply…")}
                      onSend={(text) => send(text, root.id)}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-button chat-reply-button"
                    onClick={() => setReply(root.id)}
                  >
                    <Reply size={13} />
                    {t("Répondre", "Reply")}
                  </button>
                )
              }
            >
              {[root, ...replies].map((comment) => (
                <ChatMessage
                  key={comment.id}
                  author={comment.author}
                  createdAt={comment.createdAt}
                  text={comment.text}
                  team={comment.team}
                  reply={!!comment.parentId}
                />
              ))}
            </ChatThread>
          );
        })}
        {!roots.length && (
          <p className="muted visitor-discussion-empty">
            {t(
              "Aucune question pour le moment. Soyez le premier à écrire.",
              "No questions yet. Be the first to write.",
            )}
          </p>
        )}
      </div>
      {readOnly ? (
        <p className="muted">
          {t(
            "Séance clôturée : les échanges sont en lecture seule.",
            "Closed session: discussions are read-only.",
          )}
        </p>
      ) : (
        <div className="visitor-discussion-composer">
          {named ? (
            <p className="visitor-identity">
              {t("Vous écrivez en tant que", "Writing as")}{" "}
              <strong>{name.trim()}</strong>
              <button
                type="button"
                className="text-button"
                onClick={() => setEditingName(true)}
              >
                <Pencil size={12} />
                {t("Modifier", "Change")}
              </button>
            </p>
          ) : (
            nameField
          )}
          <select
            aria-label={t("À propos de", "About")}
            value={blockId}
            onChange={(event) => setBlockId(event.target.value)}
          >
            <option value="">{t("Toute la séance", "Whole session")}</option>
            {blocks.map((block) => (
              <option value={block.id} key={block.id}>
                {block.title}
              </option>
            ))}
          </select>
          <ChatComposer
            busy={busy || !name.trim()}
            label={t(
              "Votre question ou commentaire",
              "Your question or comment",
            )}
            placeholder={
              name.trim()
                ? t(
                    "Posez une question, laissez un commentaire…",
                    "Ask a question, leave a comment…",
                  )
                : t("Indiquez d’abord votre nom", "Enter your name first")
            }
            onSend={(text) => send(text, null)}
          />
        </div>
      )}
    </section>
  );
}
