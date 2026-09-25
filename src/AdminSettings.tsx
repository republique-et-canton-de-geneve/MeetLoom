import { useEffect, useState } from "react";
import type { User } from "../shared/model";
import { api } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";

type Settings = {
  signup: { enabled: boolean; domains: string[] };
  services: {
    smtp: boolean;
    oidc: boolean;
    ai: {
      model: string | null;
      visionModel: string | null;
      allowSelfSigned: boolean;
    } | null;
  };
};

/** Administrator settings: self-service sign-up, and the state of the
 * optional services, which the operator configures outside the browser. */
export default function AdminSettings({ user }: { user: User }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [domains, setDomains] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user.isAdmin) return;
    void api<Settings>("/admin/settings")
      .then((value) => {
        setSettings(value);
        setEnabled(value.signup.enabled);
        setDomains(value.signup.domains.join(", "));
      })
      .catch((e) => setError((e as Error).message));
  }, [user.isAdmin]);
  if (!user.isAdmin) return null;
  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await api<{ signup: Settings["signup"] }>(
        "/admin/settings/signup",
        {
          method: "PUT",
          body: JSON.stringify({
            enabled,
            domains: domains
              .split(/[\s,;]+/)
              .map((value) => value.trim().replace(/^@/, ""))
              .filter(Boolean),
          }),
        },
      );
      setDomains(result.signup.domains.join(", "));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const state = (on: boolean) =>
    on ? t("configuré", "configured") : t("non configuré", "not configured");
  return (
    <details className="admin-accounts admin-settings">
      <summary>
        {t("Paramètres de l’installation", "Installation settings")}
      </summary>
      {error && <ErrorBanner message={error} />}
      <h4>{t("Création de compte", "Account creation")}</h4>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {t(
          "Permettre à chacun de créer son compte depuis la page de connexion",
          "Let anyone create an account from the sign-in page",
        )}
      </label>
      <label>
        {t(
          "Domaines d’adresse autorisés (facultatif)",
          "Allowed email domains (optional)",
        )}
        <input
          value={domains}
          disabled={!enabled}
          placeholder="organisation.ch, partenaire.ch"
          onChange={(e) => setDomains(e.target.value)}
        />
        <small>
          {t(
            "Vide : toute adresse. Les comptes créés ainsi ne sont pas administrateurs. Sans SMTP, l’adresse n’est pas vérifiée : réservez cette option à un réseau interne.",
            "Empty: any address. Accounts created this way are not administrators. Without SMTP the address is not verified: keep this option for an internal network.",
          )}
        </small>
      </label>
      <div className="button-row">
        <button className="button secondary" disabled={busy} onClick={save}>
          {t("Enregistrer", "Save")}
        </button>
        {saved && <span role="status">{t("Enregistré.", "Saved.")}</span>}
      </div>
      {settings && (
        <>
          <h4>{t("Services facultatifs", "Optional services")}</h4>
          <ul className="admin-services">
            <li>
              <strong>SMTP</strong> · {state(settings.services.smtp)}{" "}
              <small>
                {t(
                  "(récupération de mot de passe par e-mail, rappels)",
                  "(password recovery by email, reminders)",
                )}
              </small>
            </li>
            <li>
              <strong>OIDC</strong> · {state(settings.services.oidc)}{" "}
              <small>
                {t("(connexion de l’organisation)", "(organization sign-in)")}
              </small>
            </li>
            <li>
              <strong>{t("IA", "AI")}</strong> ·{" "}
              {settings.services.ai
                ? `${t("modèle", "model")} ${settings.services.ai.model ?? "—"}${settings.services.ai.visionModel ? ` · ${t("vision", "vision")} ${settings.services.ai.visionModel}` : ""}${settings.services.ai.allowSelfSigned ? t(" · certificat non vérifié (LLM_ALLOW_SELF_SIGNED)", " · certificate not verified (LLM_ALLOW_SELF_SIGNED)") : ""}`
                : state(false)}
            </li>
          </ul>
          <p className="muted">
            {t(
              "Ces services se configurent côté serveur (variables d’environnement, ConfigMap et Secret OpenShift), jamais depuis le navigateur. Sans SMTP, réinitialisez un mot de passe perdu avec « Lien de récupération » dans l’administration des comptes.",
              "These services are configured on the server (environment variables, OpenShift ConfigMap and Secret), never from the browser. Without SMTP, reset a lost password with “Recovery link” in account administration.",
            )}
          </p>
        </>
      )}
    </details>
  );
}
