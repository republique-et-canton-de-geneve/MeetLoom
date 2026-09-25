import { useEffect, useState } from "react";
import type { User } from "../shared/model";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";
type AdminAccount = User & { disabled: boolean };
export default function AdminAccounts({ user }: { user: User }) {
  const { t } = useI18n(),
    [accounts, setAccounts] = useState<AdminAccount[]>([]),
    [error, setError] = useState(""),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [access, setAccess] = useState<{
      name: string;
      sessions: { id: string; title: string; role: string }[];
    } | null>(null);
  const load = async () =>
    setAccounts(
      (await api<{ users: AdminAccount[] }>("/admin/accounts")).users,
    );
  useEffect(() => {
    if (user.isAdmin) void load().catch((error) => setError(error.message));
  }, [user.isAdmin]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!user.isAdmin) return null;
  return (
    <section className="admin-accounts account-section">
      <h2>{t("Administration des comptes", "Account administration")}</h2>
      {error && <ErrorBanner message={error} />}
      <p className="muted">
        {t(
          "La désactivation coupe immédiatement les connexions et suspend l’accès. Les données restent conservées.",
          "Disabling an account immediately signs it out and suspends access. Its data is retained.",
        )}
      </p>
      {accounts.map((account) => (
        <div className="admin-account-row" key={account.id}>
          <strong>{account.name}</strong>
          <small>{account.email}</small>
          <div className="button-row">
            <select
              disabled={busy || account.id === user.id}
              aria-label={t(
                `Rôle de ${account.name}`,
                `Role of ${account.name}`,
              )}
              value={account.isAdmin ? "admin" : "member"}
              onChange={(event) =>
                void action(() =>
                  api(`/admin/accounts/${account.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      isAdmin: event.target.value === "admin",
                    }),
                  }),
                )
              }
            >
              <option value="member">{t("Membre", "Member")}</option>
              <option value="admin">
                {t("Administrateur", "Administrator")}
              </option>
            </select>
            <button
              className="button secondary small"
              disabled={busy || account.id === user.id}
              onClick={() =>
                void action(() =>
                  api(`/admin/accounts/${account.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ disabled: !account.disabled }),
                  }),
                )
              }
            >
              {account.disabled
                ? t("Réactiver", "Enable")
                : t("Désactiver", "Disable")}
            </button>
            <button
              className="button secondary small"
              disabled={busy || account.disabled}
              onClick={() =>
                void action(async () => {
                  const result = await post<{ token: string }>(
                    `/admin/accounts/${account.id}/reset`,
                  );
                  setLink(`${location.origin}/recover/${result.token}`);
                })
              }
            >
              {t("Lien de récupération", "Recovery link")}
            </button>
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await api<{
                    sessions: { id: string; title: string; role: string }[];
                  }>(`/admin/accounts/${account.id}/access`);
                  setAccess({ name: account.name, sessions: result.sessions });
                })
              }
            >
              {t("Voir les accès", "View access")}
            </button>
            <button
              className="button secondary small"
              disabled={busy || account.id === user.id}
              onClick={() =>
                void action(() =>
                  api(`/admin/accounts/${account.id}/access`, {
                    method: "DELETE",
                  }),
                )
              }
            >
              {t("Retirer des collaborations", "Remove from collaborations")}
            </button>
          </div>
        </div>
      ))}
      {link && (
        <div className="share-result">
          <p>
            {t(
              "Lien à transmettre à la personne par votre canal habituel. Valable une heure, une seule utilisation.",
              "Send this link through your usual channel. Valid for one hour and one use.",
            )}
          </p>
          <input
            readOnly
            value={link}
            aria-label={t("Lien de récupération créé", "Created recovery link")}
            onFocus={(event) => event.target.select()}
          />
          <button
            className="button secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .catch(() =>
                  setError(
                    t(
                      "Sélectionnez le lien pour le copier.",
                      "Select the link to copy it.",
                    ),
                  ),
                )
            }
          >
            {t("Copier", "Copy")}
          </button>
        </div>
      )}
      {access && (
        <div className="privacy-explainer">
          <div>
            <h4>{access.name}</h4>
            {access.sessions.length ? (
              access.sessions.map((session) => (
                <p key={session.id}>
                  {session.title} · {session.role}
                </p>
              ))
            ) : (
              <p>
                {t(
                  "Aucune séance directement accessible.",
                  "No directly accessible sessions.",
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
