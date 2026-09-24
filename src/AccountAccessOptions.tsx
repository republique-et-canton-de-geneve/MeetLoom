import { useState } from "react";
import { Building2, Mail } from "lucide-react";
import { post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";

export default function AccountAccessOptions({
  oidcEnabled,
  passwordResetEnabled,
}: {
  oidcEnabled?: boolean;
  passwordResetEnabled?: boolean;
}) {
  const { t } = useI18n(),
    [forgot, setForgot] = useState(false),
    [email, setEmail] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(
      new URLSearchParams(location.search).get("authError") === "OIDC_FAILED"
        ? t(
            "Connexion organisationnelle impossible. Vérifiez votre invitation ou votre compte auprès de l’administrateur.",
            "Organizational sign-in failed. Check your invitation or account with your administrator.",
          )
        : "",
    );
  return (
    <div
      className="account-access-options"
      style={{ display: "grid", gap: 12, marginTop: 20 }}
    >
      {error && <ErrorBanner message={error} />}{" "}
      {oidcEnabled && (
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await post<{ url: string }>("/auth/oidc/start");
              const url = new URL(result.url);
              if (url.protocol !== "https:")
                throw new Error(
                  t(
                    "Adresse du fournisseur invalide.",
                    "Invalid identity provider address.",
                  ),
                );
              location.assign(url.href);
            } catch (cause) {
              setError((cause as Error).message);
              setBusy(false);
            }
          }}
        >
          <Building2 size={17} />
          {t("Connexion avec mon organisation", "Sign in with my organization")}
        </button>
      )}
      {passwordResetEnabled && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setForgot((value) => !value);
            setSent(false);
          }}
        >
          {t("Mot de passe oublié ?", "Forgot your password?")}
        </button>
      )}
      {forgot && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await post("/auth/forgot-password", { email });
              setSent(true);
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {t("Adresse e-mail", "Email address")}
            <input
              type="email"
              value={email}
              maxLength={254}
              required
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="button secondary" disabled={busy}>
            <Mail size={15} />
            {t("Envoyer un lien de récupération", "Send recovery link")}
          </button>
          {sent && (
            <p role="status">
              {t(
                "Si un compte actif correspond à cette adresse, un lien de récupération sera envoyé. Il peut prendre quelques minutes ; vérifiez aussi les courriers indésirables.",
                "If this address matches an active account, a recovery link will be sent. Allow a few minutes and check your spam folder.",
              )}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
