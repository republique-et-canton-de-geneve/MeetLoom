import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import type { User } from "../shared/model";
import { api } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner, Loading } from "./ui";
import {
  kindLabel,
  statusLabel,
  type Feedback,
  type FeedbackStatus,
} from "./FeedbackForm";

const STATUSES: FeedbackStatus[] = ["new", "in-progress", "done", "dismissed"];

/** A GitHub issue draft: the report without its author, whom a public
 * issue must not name. */
function issueText(item: Feedback) {
  const title = `${item.kind === "bug" ? "[Bug] " : item.kind === "idea" ? "[Idea] " : ""}${item.message.split("\n")[0].slice(0, 80)}`;
  const body = [
    item.message,
    "",
    "---",
    `Reported from MeetLoom ${item.appVersion}${item.page ? ` on ${item.page}` : ""}, ${item.createdAt.slice(0, 10)}.`,
  ].join("\n");
  return { title, body };
}

/** Reports from the application's users, for administrators. */
export default function AdminFeedback({ user }: { user: User }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Feedback[] | null>(null),
    [issuesUrl, setIssuesUrl] = useState<string | null>(null),
    [filter, setFilter] = useState<FeedbackStatus | "open" | "all">("open"),
    [error, setError] = useState(""),
    [copied, setCopied] = useState("");
  const load = () =>
    api<{ feedback: Feedback[]; issuesUrl: string | null }>("/admin/feedback")
      .then((result) => {
        setItems(result.feedback);
        setIssuesUrl(result.issuesUrl);
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    if (user.isAdmin) void load();
  }, [user.isAdmin]);
  if (!user.isAdmin) return null;
  if (!items) return error ? <ErrorBanner message={error} /> : <Loading />;
  const shown = items.filter((item) =>
    filter === "all"
      ? true
      : filter === "open"
        ? item.status === "new" || item.status === "in-progress"
        : item.status === filter,
  );
  return (
    <section className="account-section admin-feedback">
      <h2>{t("Retours des utilisateurs", "User feedback")}</h2>
      <p className="muted">
        {issuesUrl
          ? t(
              "« Créer une issue GitHub » ouvre un brouillon dans votre navigateur, sans le nom de l’auteur : relisez-le avant de le publier. Le serveur ne contacte jamais GitHub.",
              "“Create a GitHub issue” opens a draft in your browser, without the author’s name: review it before publishing. The server never contacts GitHub.",
            )
          : t(
              "Copiez un retour pour le transmettre à l’équipe qui maintient MeetLoom.",
              "Copy a report to pass it on to the team maintaining MeetLoom.",
            )}
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="button-row">
        <label>
          {t("Afficher", "Show")}
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
          >
            <option value="open">{t("À traiter", "To handle")}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status, t)}
              </option>
            ))}
            <option value="all">{t("Tous", "All")}</option>
          </select>
        </label>
      </div>
      {!shown.length && (
        <p className="muted">{t("Aucun retour.", "No feedback.")}</p>
      )}
      <ul className="feedback-list">
        {shown.map((item) => {
          const issue = issueText(item);
          return (
            <li key={item.id}>
              <div className="feedback-meta">
                <span className={`tag feedback-kind ${item.kind}`}>
                  {kindLabel(item.kind, t)}
                </span>
                <strong>
                  {item.author?.name ?? t("Compte supprimé", "Deleted account")}
                </strong>
                {item.author && <small>{item.author.email}</small>}
                <time>{new Date(item.createdAt).toLocaleString(locale)}</time>
              </div>
              <p>{item.message}</p>
              <small className="muted">
                {item.page && `${item.page} · `}
                MeetLoom {item.appVersion}
              </small>
              <div className="button-row">
                <select
                  aria-label={t("Statut", "Status")}
                  value={item.status}
                  onChange={async (event) => {
                    const status = event.target.value as FeedbackStatus;
                    try {
                      await api(`/admin/feedback/${item.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status }),
                      });
                      setItems((current) =>
                        (current ?? []).map((value) =>
                          value.id === item.id ? { ...value, status } : value,
                        ),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status, t)}
                    </option>
                  ))}
                </select>
                {issuesUrl && (
                  <a
                    className="button secondary small"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`${issuesUrl}?${new URLSearchParams(issue)}`}
                  >
                    <ExternalLink size={14} />
                    {t("Créer une issue GitHub", "Create a GitHub issue")}
                  </a>
                )}
                <button
                  className="button secondary small"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        `${issue.title}\n\n${issue.body}`,
                      );
                      setCopied(item.id);
                    } catch {
                      setError(
                        t(
                          "Copie impossible : sélectionnez le texte à la main.",
                          "Copy failed: select the text by hand.",
                        ),
                      );
                    }
                  }}
                >
                  <Copy size={14} />
                  {copied === item.id
                    ? t("Copié", "Copied")
                    : t("Copier", "Copy")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
