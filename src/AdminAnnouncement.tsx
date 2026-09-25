import { useEffect, useState } from "react";
import type { User } from "../shared/model";
import { api } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";
import type { Announcement } from "./AnnouncementBanner";

/** The banner message shown to every account, set by administrators. */
export default function AdminAnnouncement({ user }: { user: User }) {
  const { t } = useI18n();
  const [message, setMessage] = useState(""),
    [tone, setTone] = useState<Announcement["tone"]>("info"),
    [current, setCurrent] = useState<Announcement | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState("");
  useEffect(() => {
    void api<{ announcement: Announcement | null }>("/announcement")
      .then(({ announcement }) => {
        setCurrent(announcement);
        setMessage(announcement?.message ?? "");
        setTone(announcement?.tone ?? "info");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  if (!user.isAdmin) return null;
  const save = async (text: string) => {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const result = await api<{ announcement: Announcement | null }>(
        "/admin/announcement",
        { method: "PUT", body: JSON.stringify({ message: text, tone }) },
      );
      setCurrent(result.announcement);
      setMessage(result.announcement?.message ?? "");
      setSaved(
        result.announcement
          ? t("Message publié.", "Message published.")
          : t("Message retiré.", "Message removed."),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="account-section admin-announcement">
      <h2>{t("Message d’annonce", "Announcement")}</h2>
      <p className="muted">
        {t(
          "Affiché en haut de chaque page pour tous les comptes, y compris sur la page de connexion : n’y mettez rien de confidentiel. Laissez vide pour ne rien afficher.",
          "Shown at the top of every page for all accounts, including the sign-in page: put nothing confidential in it. Leave empty to show nothing.",
        )}
      </p>
      {error && <ErrorBanner message={error} />}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(message);
        }}
      >
        <label>
          {t("Message", "Message")}
          <textarea
            value={message}
            maxLength={500}
            rows={3}
            placeholder={t(
              "Ex. Maintenance ce soir de 18 h à 19 h : enregistrez votre travail.",
              "E.g. Maintenance tonight 6–7 pm: save your work.",
            )}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <small className="muted">{message.length} / 500</small>
        <label>
          {t("Type", "Type")}
          <select
            value={tone}
            onChange={(event) =>
              setTone(event.target.value as Announcement["tone"])
            }
          >
            <option value="info">{t("Information", "Information")}</option>
            <option value="warning">{t("Avertissement", "Warning")}</option>
          </select>
        </label>
        {message.trim() && (
          <div
            className={`announcement-banner preview ${tone}`}
            aria-label={t("Aperçu", "Preview")}
          >
            <p>{message.trim()}</p>
          </div>
        )}
        <div className="button-row">
          <button className="button primary" disabled={busy}>
            {t("Publier", "Publish")}
          </button>
          {current && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void save("")}
            >
              {t("Retirer le message", "Remove message")}
            </button>
          )}
        </div>
        {saved && <p role="status">{saved}</p>}
      </form>
    </section>
  );
}
