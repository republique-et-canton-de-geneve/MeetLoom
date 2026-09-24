import { useEffect, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import type { McpToken } from "../shared/mcp";
import type { SessionSummary } from "../shared/model";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner, Loading } from "./ui";
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
    [notice, setNotice] = useState("");
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
        <fieldset>
          <legend>{t("Séances autorisées", "Allowed sessions")}</legend>
          {sessions.map((session) => (
            <label className="check-row" key={session.id}>
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
              {session.title}
            </label>
          ))}
        </fieldset>
        <label className="check-row">
          <input
            type="checkbox"
            checked={includePrivate}
            onChange={(event) => setIncludePrivate(event.target.checked)}
          />
          {t(
            "Inclure colonnes internes, Pages privées et formulaires brouillons",
            "Include internal columns, private Pages and draft forms",
          )}
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={write}
            onChange={(event) => setWrite(event.target.checked)}
          />
          {t(
            "Autoriser les modifications et la création de jours",
            "Allow edits and creation of days",
          )}
        </label>
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
        <button
          className="button primary"
          disabled={busy || !selected.length || !label.trim()}
        >
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
