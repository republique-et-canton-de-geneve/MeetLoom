import { useState } from "react";
import { Copy } from "lucide-react";
import { post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";

/** Administrators invite a colleague to create an account. */
export default function InviteColleague() {
  const { t } = useI18n();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [created, setCreated] = useState(""),
    [copied, setCopied] = useState(false);
  return (
    <section className="account-section invite-colleague">
      <h2>{t("Inviter un collègue", "Invite a colleague")}</h2>
      <p className="muted">
        {t(
          "Invitez un collègue à créer son compte, puis ajoutez-le aux séances de votre choix depuis leur panneau de partage.",
          "Invite a colleague to create an account, then add them to the sessions you choose from their sharing panel.",
        )}
      </p>
      {error && <ErrorBanner message={error} />}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            const values = Object.fromEntries(new FormData(e.currentTarget));
            const r = await post<{ token: string }>("/auth/invites", values);
            setCreated(`${location.origin}/join/${r.token}`);
            setCopied(false);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-row">
          <label>
            {t("Nom du collègue", "Colleague’s name")}
            <input name="name" required maxLength={100} />
          </label>
          <label>
            {t("Adresse e-mail", "Email address")}
            <input name="email" type="email" required />
          </label>
        </div>
        <button className="button primary" disabled={busy}>
          {t("Créer une invitation", "Create invitation")}
        </button>
      </form>
      {created && (
        <div className="share-result">
          <p>
            {t(
              "Transmettez ce lien à votre collègue :",
              "Send this link to your colleague:",
            )}
          </p>
          <input readOnly value={created} onFocus={(e) => e.target.select()} />
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(created);
                setCopied(true);
              } catch {
                setError(
                  t(
                    "Sélectionnez le lien pour le copier manuellement.",
                    "Select the link to copy it manually.",
                  ),
                );
              }
            }}
          >
            <Copy size={15} />
            {copied ? t("Copié", "Copied") : t("Copier", "Copy")}
          </button>
        </div>
      )}
    </section>
  );
}
