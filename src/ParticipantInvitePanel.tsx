import { useCallback, useEffect, useState } from "react";
import { Copy, MailPlus, Trash2 } from "lucide-react";
import type { ParticipantInvitation } from "../shared/participants";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";
import "./participants.css";

export default function ParticipantInvitePanel({
  sessionId,
  onChanged,
}: {
  sessionId: string;
  onChanged?: () => void;
}) {
  const { t } = useI18n(),
    [invitations, setInvitations] = useState<ParticipantInvitation[]>([]),
    [canInviteNew, setCanInviteNew] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState<"editor" | "facilitator" | "viewer">("editor"),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api<{
        invitations: ParticipantInvitation[];
        canInviteNew: boolean;
      }>(`/sessions/${sessionId}/invitations`, { signal });
      if (!signal?.aborted) {
        setInvitations(result.invitations);
        setCanInviteNew(result.canInviteNew);
      }
    },
    [sessionId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, [reload]);
  return (
    <section className="participant-invitations">
      <h3>
        <MailPlus size={18} />
        {t(
          "Inviter et attribuer avant inscription",
          "Invite and assign before sign-up",
        )}
      </h3>
      <p className="muted">
        {canInviteNew
          ? t(
              "Une invitation peut être attribuée aux blocs immédiatement. Partagez son lien de manière privée.",
              "An invitation can be assigned to blocks immediately. Share its link privately.",
            )
          : t(
              "Vous pouvez ajouter un compte existant. Un administrateur global ou de l’espace doit créer les nouveaux comptes.",
              "You can add an existing account. A global or workspace administrator must invite new accounts.",
            )}
      </p>
      {error && <ErrorBanner message={error} />}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          setLink("");
          setNotice("");
          try {
            const result = await post<{ token?: string }>(
              `/sessions/${sessionId}/invitations`,
              { name, email, role },
            );
            setLink(
              result.token ? `${location.origin}/join/${result.token}` : "",
            );
            setNotice(
              result.token
                ? t(
                    "Invitation créée. La personne peut déjà être attribuée.",
                    "Invitation created. This person can already be assigned.",
                  )
                : t(
                    "Collaborateur ajouté à la séance.",
                    "Collaborator added to the session.",
                  ),
            );
            setName("");
            setEmail("");
            await reload();
            onChanged?.();
            window.dispatchEvent(new Event("meetloom:participants"));
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t("Nom affiché", "Display name")}
          <input
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {t("E-mail", "Email")}
          <input
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          {t("Accès à la séance", "Session access")}
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
          >
            <option value="editor">
              {t("Éditeur — modifier l’agenda", "Editor — edit the agenda")}
            </option>
            <option value="facilitator">
              {t(
                "Animateur — piloter le minuteur",
                "Facilitator — run the timer",
              )}
            </option>
            <option value="viewer">
              {t("Lecteur — lire et commenter", "Viewer — read and comment")}
            </option>
          </select>
        </label>
        <button className="button secondary" disabled={busy}>
          {t("Ajouter / inviter", "Add / invite")}
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
      {link && (
        <div className="participant-invite-link">
          <input
            aria-label={t("Lien privé d’invitation", "Private invitation link")}
            readOnly
            value={link}
          />
          <button
            type="button"
            className="icon-button"
            title={t("Copier le lien", "Copy link")}
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .catch(() =>
                  setError(
                    t(
                      "Copiez le lien depuis le champ.",
                      "Copy the link from the field.",
                    ),
                  ),
                )
            }
          >
            <Copy size={16} />
          </button>
        </div>
      )}
      {invitations.map((invitation) => (
        <div key={invitation.id} className="participant-pending">
          <span>
            <strong>{invitation.name}</strong>
            <small>
              {invitation.email} ·{" "}
              {invitation.active
                ? t("En attente", "Pending")
                : t("Expirée ou révoquée", "Expired or revoked")}
            </small>
          </span>
          {invitation.active && (
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              title={t("Révoquer cette invitation", "Revoke this invitation")}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(
                    `/sessions/${sessionId}/invitations/${invitation.id}`,
                    { method: "DELETE" },
                  );
                  await reload();
                  onChanged?.();
                  window.dispatchEvent(new Event("meetloom:participants"));
                } catch (cause) {
                  setError((cause as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

export function AcceptSessionInvitation({
  token,
  onAccepted,
}: {
  token: string;
  onAccepted: () => void;
}) {
  const { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section>
      <h2>{t("Rejoindre une séance", "Join a session")}</h2>
      <p>
        {t(
          "Accepter cette invitation avec votre compte connecté.",
          "Accept this invitation with your signed-in account.",
        )}
      </p>
      {error && <ErrorBanner message={error} />}
      <button
        className="button primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await post("/auth/accept-session-invite", { token });
            onAccepted();
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Accepter l’invitation", "Accept invitation")}
      </button>
    </section>
  );
}
