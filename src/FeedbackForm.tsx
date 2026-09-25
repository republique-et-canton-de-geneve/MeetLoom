import { useEffect, useState } from "react";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";

export type FeedbackKind = "bug" | "idea" | "other";
export type FeedbackStatus = "new" | "in-progress" | "done" | "dismissed";
export interface Feedback {
  id: string;
  kind: FeedbackKind;
  message: string;
  page: string | null;
  appVersion: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
  author?: { name: string; email: string } | null;
}

export const kindLabel = (
  kind: FeedbackKind,
  t: (fr: string, en: string) => string,
) =>
  kind === "bug"
    ? t("Problème", "Problem")
    : kind === "idea"
      ? t("Idée", "Idea")
      : t("Autre", "Other");
export const statusLabel = (
  status: FeedbackStatus,
  t: (fr: string, en: string) => string,
) =>
  status === "new"
    ? t("Reçu", "Received")
    : status === "in-progress"
      ? t("En cours", "In progress")
      : status === "done"
        ? t("Traité", "Done")
        : t("Écarté", "Dismissed");

/** Anyone signed in reports a problem or suggests an idea to the
 * administrators, and follows what became of it. */
export default function FeedbackForm({ page }: { page?: string }) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<FeedbackKind>("bug"),
    [message, setMessage] = useState(""),
    [where, setWhere] = useState(page ?? ""),
    [mine, setMine] = useState<Feedback[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false);
  const load = () =>
    api<{ feedback: Feedback[] }>("/feedback/mine")
      .then((result) => setMine(result.feedback))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <section className="account-section feedback-form">
        <h2>
          {t("Signaler un problème ou une idée", "Report a problem or an idea")}
        </h2>
        <p className="muted">
          {t(
            "Votre message arrive aux administrateurs de MeetLoom, avec votre nom, la page concernée et la version installée. Aucun compte GitHub n’est nécessaire.",
            "Your message reaches the MeetLoom administrators, with your name, the page concerned and the installed version. No GitHub account is needed.",
          )}
        </p>
        {error && <ErrorBanner message={error} />}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            setSent(false);
            try {
              await post("/feedback", {
                kind,
                message,
                ...(where.trim() ? { page: where.trim() } : {}),
              });
              setMessage("");
              setSent(true);
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset className="feedback-kinds">
            <legend>{t("Il s’agit…", "This is…")}</legend>
            {(
              [
                ["bug", t("d’un problème", "a problem")],
                [
                  "idea",
                  t("d’une idée ou d’une demande", "an idea or a request"),
                ],
                ["other", t("d’autre chose", "something else")],
              ] as const
            ).map(([value, label]) => (
              <label className="checkbox-label" key={value}>
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label>
            {kind === "bug"
              ? t(
                  "Que s’est-il passé ? Qu’attendiez-vous ?",
                  "What happened? What did you expect?",
                )
              : t("Votre message", "Your message")}
            <textarea
              required
              rows={6}
              maxLength={4000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <label>
            {t("Page concernée (facultatif)", "Page concerned (optional)")}
            <input
              value={where}
              maxLength={300}
              placeholder="/session/…"
              onChange={(event) => setWhere(event.target.value)}
            />
          </label>
          <button className="button primary" disabled={busy || !message.trim()}>
            {t("Envoyer", "Send")}
          </button>
          {sent && (
            <p role="status">
              {t(
                "Merci ! Les administrateurs ont reçu votre message.",
                "Thank you! The administrators received your message.",
              )}
            </p>
          )}
        </form>
      </section>
      {!!mine.length && (
        <section className="account-section">
          <h2>{t("Mes signalements", "My reports")}</h2>
          <ul className="feedback-list">
            {mine.map((item) => (
              <li key={item.id}>
                <div className="feedback-meta">
                  <span className={`tag feedback-kind ${item.kind}`}>
                    {kindLabel(item.kind, t)}
                  </span>
                  <span className={`tag feedback-status ${item.status}`}>
                    {statusLabel(item.status, t)}
                  </span>
                  <time>{new Date(item.createdAt).toLocaleString(locale)}</time>
                </div>
                <p>{item.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
