import { useEffect, useState } from "react";
import type { User } from "../shared/model";
import {
  DEFAULT_ACCOUNT_PREFERENCES,
  type AccountProfile,
} from "../shared/accounts";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";

export default function ProfileSettings({
  user,
  onSaved,
}: {
  user: User;
  onSaved?: () => void;
}) {
  const { t, setLocale } = useI18n(),
    [profile, setProfile] = useState<AccountProfile>({
      preferences: { ...DEFAULT_ACCOUNT_PREFERENCES },
    }),
    [name, setName] = useState(user.name),
    [email, setEmail] = useState(user.email),
    [language, setLanguage] = useState(user.locale),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ profile: AccountProfile }>("/account")
      .then((data) => setProfile(data.profile))
      .catch((error) => setError(error.message));
  }, []);
  const preference = <K extends keyof AccountProfile["preferences"]>(
    key: K,
    value: AccountProfile["preferences"][K],
  ) =>
    setProfile((current) => ({
      ...current,
      preferences: { ...current.preferences, [key]: value },
    }));
  const photo = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 5_000_000
      )
        throw new Error(
          t(
            "Choisissez une image PNG, JPEG ou WebP de moins de 5 Mo.",
            "Choose a PNG, JPEG or WebP image under 5 MB.",
          ),
        );
      const bitmap = await createImageBitmap(file),
        canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const context = canvas.getContext("2d")!,
        side = Math.min(bitmap.width, bitmap.height);
      context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        128,
        128,
      );
      bitmap.close();
      setProfile((current) => ({
        ...current,
        avatar: canvas.toDataURL("image/jpeg", 0.85),
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <details className="profile-settings">
      <summary>{t("Profil et préférences", "Profile and preferences")}</summary>
      {error && <ErrorBanner message={error} />}{" "}
      {notice && <p role="status">{notice}</p>}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/account", {
              method: "PUT",
              body: JSON.stringify({
                name,
                email,
                locale: language,
                ...profile,
                currentPassword:
                  new FormData(event.currentTarget).get("currentPassword") ||
                  undefined,
              }),
            });
            setLocale(language);
            localStorage.setItem(
              "meetloom.display-preferences",
              JSON.stringify(profile.preferences),
            );
            window.dispatchEvent(new Event("meetloom:preferences"));
            setNotice(t("Profil enregistré.", "Profile saved."));
            onSaved?.();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            {t("Nom affiché", "Display name")}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label>
            {t("Adresse e-mail", "Email address")}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
            />
          </label>
        </div>
        {email !== user.email && (
          <label>
            {t(
              "Mot de passe actuel pour confirmer le changement d’adresse",
              "Current password to confirm the email change",
            )}
            <input
              type="password"
              name="currentPassword"
              required
              autoComplete="current-password"
            />
          </label>
        )}
        <div className="form-grid">
          <label>
            {t("Langue", "Language")}
            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as "fr" | "en")
              }
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {t("Fuseau horaire affiché", "Display timezone")}
            <input
              value={profile.preferences.displayTimezone}
              placeholder={t(
                "Utiliser le fuseau de la séance",
                "Use the session timezone",
              )}
              list="account-timezones"
              onChange={(event) =>
                preference("displayTimezone", event.target.value)
              }
            />
            <datalist id="account-timezones">
              {Intl.supportedValuesOf("timeZone").map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={profile.preferences.hour12}
            onChange={(event) => preference("hour12", event.target.checked)}
          />
          {t("Format horaire 12 heures (AM/PM)", "12-hour time format (AM/PM)")}
        </label>
        <label>
          {t("Photo de profil", "Profile photo")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => void photo(event.target.files?.[0])}
          />
        </label>
        {profile.avatar && (
          <div className="button-row">
            <img
              src={profile.avatar}
              width={64}
              height={64}
              style={{ borderRadius: "50%" }}
              alt={t("Votre photo de profil", "Your profile photo")}
            />
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                setProfile((current) => ({ ...current, avatar: undefined }))
              }
            >
              {t("Retirer la photo", "Remove photo")}
            </button>
          </div>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={profile.preferences.inAppMentions}
            onChange={(event) =>
              preference("inAppMentions", event.target.checked)
            }
          />
          {t(
            "Afficher les notifications de mentions",
            "Show mention notifications",
          )}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={profile.preferences.emailDigest}
            onChange={(event) =>
              preference("emailDigest", event.target.checked)
            }
          />
          {t(
            "Recevoir un récapitulatif horaire des échanges non lus (si SMTP est configuré)",
            "Receive hourly digests of unread updates (when SMTP is configured)",
          )}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={profile.preferences.emailReminder}
            onChange={(event) =>
              preference("emailReminder", event.target.checked)
            }
          />
          {t(
            "Recevoir un rappel de préparation trois jours avant mes séances (si SMTP est configuré)",
            "Receive a preparation reminder three days before my sessions (when SMTP is configured)",
          )}
        </label>
        <button className="button primary" disabled={busy}>
          {t("Enregistrer mon profil", "Save profile")}
        </button>
      </form>
      <details className="account-deletion">
        <summary>{t("Supprimer mon compte", "Delete my account")}</summary>
        <p className="muted">
          {t(
            "Vos séances doivent être transférées à un compte actif. Vos commentaires et historiques sont conservés avec un auteur anonymisé. Le dernier administrateur ne peut pas partir sans nommer un successeur.",
            "Your sessions must be transferred to an active account. Comments and history retain an anonymized author. The last administrator must appoint a successor first.",
          )}
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setBusy(true);
            setError("");
            try {
              await post("/account/delete", {
                currentPassword: data.get("password"),
                transferEmail: data.get("transferEmail") || undefined,
              });
              location.assign("/");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {t(
              "E-mail du nouveau propriétaire de mes séances",
              "Email of the new owner of my sessions",
            )}
            <input name="transferEmail" type="email" />
          </label>
          <label>
            {t("Confirmer avec mon mot de passe", "Confirm with my password")}
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" required />
            {t(
              "Je comprends que la suppression de mon compte est définitive.",
              "I understand that account deletion is permanent.",
            )}
          </label>
          <button className="button secondary danger" disabled={busy}>
            {t(
              "Transférer mes séances et supprimer mon compte",
              "Transfer my sessions and delete my account",
            )}
          </button>
        </form>
      </details>
    </details>
  );
}
