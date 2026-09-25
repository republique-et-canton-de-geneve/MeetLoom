import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  SendHorizontal,
} from "lucide-react";
import type { Collaborator } from "../shared/comments";
import { useI18n } from "./i18n";
import { Avatar } from "./ui";
import "./chat.css";

/** "14:05" today, "12 sept. 14:05" before. */
export function when(iso: string, locale: string) {
  const date = new Date(iso),
    today = new Date().toDateString() === date.toDateString();
  return date.toLocaleString(locale, {
    ...(today ? {} : { day: "numeric", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatMessage({
  id,
  author,
  createdAt,
  text,
  team = false,
  reply = false,
  extra,
}: {
  id?: string;
  author: string;
  createdAt: string;
  text: string;
  /** Written by the organizers: badged for visitors. */
  team?: boolean;
  reply?: boolean;
  extra?: ReactNode;
}) {
  const { t, locale } = useI18n();
  return (
    <div
      className={`chat-message ${reply ? "is-reply" : ""} ${team ? "is-team" : ""}`}
      id={id}
    >
      <Avatar name={author} small />
      <div className="chat-bubble">
        <div className="chat-meta">
          <strong>{author}</strong>
          {team && (
            <span className="chat-team-badge">{t("Équipe", "Organizers")}</span>
          )}
          <time dateTime={createdAt}>{when(createdAt, locale)}</time>
        </div>
        <p>{text}</p>
        {extra}
      </div>
    </div>
  );
}

/** One conversation: its header, messages, and an inline reply. A resolved
 * conversation stays visible, folded to one line until opened. */
export function ChatThread({
  id,
  header,
  resolved,
  summary,
  count,
  canResolve,
  onResolve,
  busy,
  children,
  reply,
}: {
  id?: string;
  header: ReactNode;
  resolved: boolean;
  /** First message, shown when the resolved thread is folded. */
  summary: string;
  count: number;
  canResolve: boolean;
  onResolve?: () => void;
  busy?: boolean;
  children: ReactNode;
  /** The reply composer or the "Reply" button. */
  reply?: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(!resolved);
  const shown = !resolved || open;
  return (
    <article className={`chat-thread ${resolved ? "is-resolved" : ""}`} id={id}>
      {(header || resolved || (canResolve && onResolve)) && (
        <header className="chat-thread-header">
          <div className="chat-thread-tags">{header}</div>
          {resolved && (
            <span className="chat-resolved">
              <Check size={12} />
              {t("Résolu", "Resolved")}
            </span>
          )}
          {canResolve && onResolve && (
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              title={
                resolved
                  ? t("Rouvrir la discussion", "Reopen thread")
                  : t("Marquer comme résolu", "Mark as resolved")
              }
              aria-label={
                resolved
                  ? t("Rouvrir la discussion", "Reopen thread")
                  : t("Marquer comme résolu", "Mark as resolved")
              }
              onClick={onResolve}
            >
              {resolved ? <RotateCcw size={15} /> : <Check size={15} />}
            </button>
          )}
        </header>
      )}
      {shown ? (
        <>
          <div className="chat-messages">{children}</div>
          {!resolved && reply}
          {resolved && (
            <button
              type="button"
              className="text-button chat-fold"
              onClick={() => setOpen(false)}
            >
              <ChevronUp size={14} />
              {t("Replier", "Fold")}
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          className="chat-folded"
          onClick={() => setOpen(true)}
        >
          <span>{summary}</span>
          <small>
            {count} {t("message(s)", "message(s)")}
            <ChevronDown size={14} />
          </small>
        </button>
      )}
    </article>
  );
}

/** Enter sends, Shift+Enter starts a new line; @ mentions collaborators when
 * some are given (team conversations). */
export function ChatComposer({
  collaborators = [],
  busy,
  onSend,
  placeholder,
  label,
  focusOnMount = false,
}: {
  collaborators?: Collaborator[];
  busy: boolean;
  onSend: (text: string, mentions: string[]) => Promise<void>;
  placeholder: string;
  label: string;
  focusOnMount?: boolean;
}) {
  const { t } = useI18n(),
    [text, setText] = useState(""),
    [mentions, setMentions] = useState<Collaborator[]>([]),
    [query, setQuery] = useState<string | null>(null),
    [selection, setSelection] = useState(0),
    input = useRef<HTMLTextAreaElement>(null);
  // Opened to reply: ready to type.
  useEffect(() => {
    if (focusOnMount) input.current?.focus();
  }, [focusOnMount]);
  const options =
    query === null || !collaborators.length
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
      mention = `@${member.name} `;
    const next =
      text.slice(0, start < 0 ? caret : start) + mention + text.slice(caret);
    if (next.length > 4000) return;
    setText(next);
    setMentions((previous) => [
      ...previous.filter((value) => value.id !== member.id),
      member,
    ]);
    setQuery(null);
    requestAnimationFrame(() => {
      element?.focus();
      const position = (start < 0 ? caret : start) + mention.length;
      element?.setSelectionRange(position, position);
    });
  };
  const send = async () => {
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
      /* The parent shows the error; the draft stays. */
    }
  };
  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <textarea
        ref={input}
        aria-label={label}
        value={text}
        maxLength={4000}
        rows={1}
        placeholder={placeholder}
        disabled={busy}
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          // Grow with the text, up to a few lines.
          event.target.style.height = "auto";
          event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
          const before = value.slice(0, event.target.selectionStart),
            match = before.match(/(?:^|\s)@([\p{L}\p{N}_. -]*)$/u);
          setQuery(match?.[1] ?? null);
          setSelection(0);
        }}
        onKeyDown={(event) => {
          if (options.length) {
            if (event.key === "Escape") {
              event.stopPropagation();
              setQuery(null);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setSelection(
                (value) =>
                  (value +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    options.length) %
                  options.length,
              );
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              choose(options[selection % options.length]);
              return;
            }
          }
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <button
        type="submit"
        className="chat-send"
        disabled={busy || !text.trim()}
        title={t("Envoyer (Entrée)", "Send (Enter)")}
        aria-label={t("Envoyer", "Send")}
      >
        <SendHorizontal size={17} />
      </button>
      {options.length > 0 && (
        <div
          className="mention-options"
          role="listbox"
          aria-label={t("Collaborateurs", "Collaborators")}
        >
          {options.map((member, index) => (
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
          ))}
        </div>
      )}
    </form>
  );
}
