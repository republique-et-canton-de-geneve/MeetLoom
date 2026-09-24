import { useState } from "react";
import { post } from "./api";
import { useI18n } from "./i18n";
import { Brand, ErrorBanner, LanguageSwitch } from "./ui";
export default function RecoverAccount({
  token,
  onSuccess,
}: {
  token: string;
  onSuccess: () => void;
}) {
  const { t } = useI18n(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Brand />
        <LanguageSwitch />
        <h1>{t("Récupérer mon compte", "Recover my account")}</h1>
        <p>
          {t(
            "Choisissez un nouveau mot de passe. Vos autres connexions seront fermées.",
            "Choose a new password. Your other sessions will be signed out.",
          )}
        </p>
        {error && <ErrorBanner message={error} />}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setError("");
            if (data.get("password") !== data.get("confirmation")) {
              setError(
                t(
                  "Les mots de passe ne correspondent pas.",
                  "Passwords do not match.",
                ),
              );
              return;
            }
            setBusy(true);
            try {
              await post("/auth/reset-password", {
                token,
                password: data.get("password"),
              });
              onSuccess();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {t("Nouveau mot de passe", "New password")}
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
            />
          </label>
          <label>
            {t("Confirmer le mot de passe", "Confirm password")}
            <input
              name="confirmation"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
            />
          </label>
          <button className="button primary" disabled={busy}>
            {t("Enregistrer et me connecter", "Save and sign in")}
          </button>
        </form>
      </div>
    </main>
  );
}
