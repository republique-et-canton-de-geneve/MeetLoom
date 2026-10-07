import { useEffect, useId, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import type { McpToken } from "../shared/mcp";
import type { SessionSummary } from "../shared/model";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { canGrantWrite, mcpSessionChoices, mcpTokenCheck } from "./mcp-grant";
import { ErrorBanner, Loading } from "./ui";
// Also rendered on its own from the editor's "Autres actions" menu.
import "./ai.css";
export default function McpPanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n(),
    [tokens, setTokens] = useState<McpToken[]>([]),
    [sessions, setSessions] = useState<SessionSummary[]>([]),
    [selected, setSelected] = useState([sessionId]),
    [label, setLabel] = useState(""),
    [includePrivate, setIncludePrivate] = useState(false),
    [write, setWrite] = useState(false),
    [days, setDays] = useState(30),
    [created, setCreated] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    internalHint = useId(),
    writeHint = useId();
  const choices = mcpSessionChoices(sessions, sessionId),
    { readOnly, ready } = mcpTokenCheck({ label, selected, write }, sessions),
    count = selected.length;
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<{ tokens: McpToken[] }>("/mcp/tokens"),
      api<{ sessions: SessionSummary[] }>("/sessions"),
    ])
      .then(([list, agendas]) => {
        if (active) {
          setTokens(list.tokens);
          setSessions(agendas.sessions);
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="mcp-panel">
      <h3>{t("Connecteur MCP interne", "Internal MCP connector")}</h3>
      <p className="privacy-explainer">
        {t(
          "Connectez uniquement un client autorisé par votre organisation. Ce jeton lui donne accès aux séances sélectionnées. Aucune connexion n’est créée automatiquement.",
          "Connect only a client authorized by your organization. This token grants access to selected sessions. No connection is created automatically.",
        )}
      </p>
      {loading && <Loading />}
      {error && <ErrorBanner message={error} />}
      <code className="mcp-endpoint">{window.location.origin}/mcp</code>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setCreated("");
          void post<{ token: string; metadata: McpToken }>("/mcp/tokens", {
            label,
            sessionIds: selected,
            includePrivate,
            write,
            expiresInDays: days,
          })
            .then((data) => {
              setCreated(data.token);
              setTokens((prior) => [data.metadata, ...prior]);
              setLabel("");
            })
            .catch((error) => setError(error.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {t("Nom du client", "Client name")}
          <input
            required
            maxLength={120}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <fieldset className="mcp-sessions">
          <legend>{t("Séances autorisées", "Allowed sessions")}</legend>
          {sessions.length > 0 && (
            <p className="mcp-session-count">
              {t(
                `${count} ${count > 1 ? "séances sélectionnées" : "séance sélectionnée"} sur ${sessions.length}`,
                `${count} of ${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} selected`,
              )}
            </p>
          )}
          <div className="mcp-session-list">
            {choices.map((session) => {
              const meta = [
                session.id === sessionId &&
                  t("Séance actuelle", "This session"),
                session.client,
                session.closedAt && t("Clôturée", "Closed"),
                session.archived && t("Archivée", "Archived"),
                !canGrantWrite(session.role) && t("Lecture seule", "Read only"),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <label className="checkbox-row" key={session.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(session.id)}
                    onChange={(event) =>
                      setSelected((prior) =>
                        event.target.checked
                          ? [...prior, session.id]
                          : prior.filter((id) => id !== session.id),
                      )
                    }
                  />
                  <span>
                    <strong>{session.title}</strong>
                    {meta && <small>{meta}</small>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="mcp-permissions">
          <legend>{t("Autorisations", "Permissions")}</legend>
          <div className="mcp-option internal">
            <label className="checkbox-row">
              <input
                type="checkbox"
                aria-describedby={internalHint}
                checked={includePrivate}
                onChange={(event) => setIncludePrivate(event.target.checked)}
              />
              <strong>
                {t(
                  "Inclure colonnes internes, Pages privées et formulaires brouillons",
                  "Include internal columns, private Pages and draft forms",
                )}
              </strong>
            </label>
            <small className="mcp-option-hint" id={internalHint}>
              {t(
                "Donne aussi accès à la description de la séance et à ces contenus réservés à l’équipe. Sans cette option : l’agenda avec ses colonnes et Pages publiques uniquement.",
                "Also gives access to the session description and this team-only content. Without it: the agenda with its public columns and Pages only.",
              )}
            </small>
          </div>
          <div className="mcp-option">
            <label className="checkbox-row">
              <input
                type="checkbox"
                aria-describedby={writeHint}
                checked={write}
                onChange={(event) => setWrite(event.target.checked)}
              />
              <strong>
                {t(
                  "Autoriser les modifications et la création de jours",
                  "Allow edits and creation of days",
                )}
              </strong>
            </label>
            <small className="mcp-option-hint" id={writeHint}>
              {t(
                "Le client peut ajouter des jours et modifier l’agenda, suppressions comprises, dans les séances que vous pouvez modifier et qui ne sont pas clôturées. Chaque changement figure dans l’historique. Sans cette option : lecture seule.",
                "The client can add days and change the agenda, deletions included, in sessions you can edit that are not closed. Every change is recorded in the history. Without it: read-only.",
              )}
            </small>
            {readOnly > 0 && (
              <p className="mcp-warning" role="alert">
                {readOnly === 1
                  ? t(
                      "1 séance sélectionnée est en lecture seule pour vous : décochez-la ou retirez cette option.",
                      "1 selected session is read-only for you: untick it or turn this option off.",
                    )
                  : t(
                      `${readOnly} séances sélectionnées sont en lecture seule pour vous : décochez-les ou retirez cette option.`,
                      `${readOnly} selected sessions are read-only for you: untick them or turn this option off.`,
                    )}
              </p>
            )}
          </div>
        </fieldset>
        <label>
          {t("Expiration", "Expiry")}
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {[1, 7, 30, 90].map((days) => (
              <option key={days} value={days}>
                {days} {t("jours", "days")}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" disabled={busy || !ready}>
          <KeyRound size={16} />
          {t("Créer le jeton", "Create token")}
        </button>
      </form>
      {created && (
        <section className="ai-operation">
          <strong>
            {t(
              "Copiez maintenant : le jeton ne sera plus affiché après fermeture.",
              "Copy now: this token will not be shown after closing.",
            )}
          </strong>
          <p>
            {t(
              "Transport : Streamable HTTP. En-tête requis :",
              "Transport: Streamable HTTP. Required header:",
            )}
          </p>
          <code className="mcp-endpoint">Authorization: Bearer {created}</code>
          <button
            className="button secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(created)
                .then(() => setNotice(t("Jeton copié", "Token copied")))
                .catch(() =>
                  setError(
                    t(
                      "Copie impossible. Sélectionnez le jeton.",
                      "Copy failed. Select the token.",
                    ),
                  ),
                )
            }
          >
            <Copy size={15} />
            {t("Copier le jeton", "Copy token")}
          </button>
          <p className="muted">
            {t(
              "Le client doit accepter un en-tête Bearer explicite. Ce connecteur ne fournit pas de connexion automatique OAuth.",
              "The client must support an explicit Bearer header. This connector does not provide automatic OAuth connection.",
            )}
          </p>
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
      <h4>{t("Jetons personnels", "Personal tokens")}</h4>
      {tokens.map((token) => (
        <div className="ai-instruction-item" key={token.id}>
          <div>
            <strong>{token.label}</strong>
            <p className="muted">
              {token.sessionIds.length} {t("séances", "sessions")} ·{" "}
              {token.write ? t("écriture", "write") : t("lecture", "read")} ·{" "}
              {token.includePrivate
                ? t("données internes", "internal data")
                : t("données publiques", "public data")}
              <br />
              {t("Expire le", "Expires")}{" "}
              {new Date(token.expiresAt).toLocaleDateString()}
            </p>
          </div>
          <button
            className="icon-button"
            disabled={busy}
            aria-label={`${t("Révoquer", "Revoke")} ${token.label}`}
            onClick={() => {
              setBusy(true);
              setError("");
              void api(`/mcp/tokens/${token.id}`, { method: "DELETE" })
                .then(() => {
                  setTokens((prior) =>
                    prior.filter((value) => value.id !== token.id),
                  );
                  setCreated("");
                })
                .catch((error) => setError(error.message))
                .finally(() => setBusy(false));
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
