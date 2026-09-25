import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { User } from "../shared/model";
import { api } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";

interface LogLine {
  id: string;
  at: string;
  level: "info" | "warn" | "error";
  pod: string;
  message: string;
  details: Record<string, string | number | boolean | null> | null;
}

/** The server log lines of every pod, for administrators without access to
 * OpenShift (server/logs.ts). */
export default function AdminLogs({ user }: { user: User }) {
  const { t, locale } = useI18n();
  const [level, setLevel] = useState<LogLine["level"]>("warn"),
    [query, setQuery] = useState(""),
    [lines, setLines] = useState<LogLine[]>([]),
    [retention, setRetention] = useState(0),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async (before?: string) => {
    setBusy(true);
    setError("");
    try {
      const search = new URLSearchParams({ level });
      if (query.trim()) search.set("q", query.trim());
      if (before) search.set("before", before);
      const result = await api<{ logs: LogLine[]; retentionDays: number }>(
        `/admin/logs?${search}`,
      );
      setRetention(result.retentionDays);
      setLines((current) =>
        before ? [...current, ...result.logs] : result.logs,
      );
      setMore(result.logs.length === 300);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (user.isAdmin) void load();
  }, [level, user.isAdmin]);
  if (!user.isAdmin) return null;
  const levelLabel = (value: LogLine["level"]) =>
    value === "error"
      ? t("Erreur", "Error")
      : value === "warn"
        ? t("Avertissement", "Warning")
        : t("Info", "Info");
  return (
    <section className="account-section admin-logs">
      <h2>{t("Journaux du serveur", "Server logs")}</h2>
      <p className="muted">
        {t(
          `Les messages de tous les serveurs (pods), conservés ${retention || "…"} jours. Ils indiquent ce qui a échoué et pourquoi, jamais les mots de passe, contenus ou réponses.`,
          `Messages from every server (pod), kept ${retention || "…"} days. They say what failed and why, never passwords, content or answers.`,
        )}
      </p>
      {error && <ErrorBanner message={error} />}
      <form
        className="admin-logs-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label>
          {t("Niveau", "Level")}
          <select
            value={level}
            onChange={(event) =>
              setLevel(event.target.value as LogLine["level"])
            }
          >
            <option value="info">{t("Tout", "Everything")}</option>
            <option value="warn">
              {t("Avertissements et erreurs", "Warnings and errors")}
            </option>
            <option value="error">{t("Erreurs", "Errors")}</option>
          </select>
        </label>
        <label>
          {t("Rechercher", "Search")}
          <input
            type="search"
            value={query}
            maxLength={200}
            placeholder={t("Ex. SMTP, AI service", "E.g. SMTP, AI service")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="button secondary" disabled={busy}>
          <RefreshCw size={15} />
          {t("Actualiser", "Refresh")}
        </button>
      </form>
      {!lines.length && !busy && (
        <p className="muted">
          {t("Aucun message pour ce filtre.", "No message for this filter.")}
        </p>
      )}
      <ol className="admin-logs-list">
        {lines.map((line) => (
          <li key={line.id} className={line.level}>
            <span className={`log-level ${line.level}`}>
              {levelLabel(line.level)}
            </span>
            <time dateTime={line.at}>
              {new Date(line.at).toLocaleString(locale)}
            </time>
            <span className="log-pod" title={line.pod}>
              {line.pod}
            </span>
            <p>
              {line.message}
              {line.details &&
                Object.entries(line.details).map(([key, value]) => (
                  <code key={key}>
                    {key}: {String(value)}
                  </code>
                ))}
            </p>
          </li>
        ))}
      </ol>
      {more && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void load(lines.at(-1)?.at)}
        >
          {t("Plus anciens", "Older")}
        </button>
      )}
    </section>
  );
}
