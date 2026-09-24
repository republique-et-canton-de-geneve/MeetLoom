import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, Users, Settings, Copy, Check } from "lucide-react";
import type { SessionResponse, SessionSummary } from "../shared/model";
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSettings,
} from "../shared/workspaces";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner, Loading, Modal } from "./ui";
import "./workspaces.css";

export default function WorkspacePanel({
  id,
  sessions,
  close,
  onChanged,
}: {
  id: string;
  sessions: SessionSummary[];
  close: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n(),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [members, setMembers] = useState<WorkspaceMember[]>([]),
    [invitations, setInvitations] = useState<
      { id: string; email: string; role: WorkspaceRole; expiresAt: number }[]
    >([]),
    [tab, setTab] = useState<"settings" | "members">("settings"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState(""),
    [invitation, setInvitation] = useState(""),
    [copied, setCopied] = useState(false),
    [confirm, setConfirm] = useState("");
  const loadMembers = async () => {
    const result = await api<{
      members: WorkspaceMember[];
      invitations: typeof invitations;
    }>(`/workspaces/${id}/members`);
    setMembers(result.members);
    setInvitations(result.invitations);
  };
  const reload = async () => {
    setWorkspace(
      (await api<{ workspace: Workspace }>(`/workspaces/${id}`)).workspace,
    );
    await loadMembers();
  };
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [id]);
  const change = (patch: Partial<WorkspaceSettings>) =>
    setWorkspace((current) =>
      current
        ? { ...current, settings: { ...current.settings, ...patch } }
        : current,
    );
  const defaults = (patch: Partial<WorkspaceSettings["defaults"]>) =>
    change({ defaults: { ...workspace!.settings.defaults, ...patch } });
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const roleLabel = (value: string) =>
    ({
      admin: t("Administrateur", "Administrator"),
      editor: t("Éditeur", "Editor"),
      viewer: t("Lecteur", "Viewer"),
      guest: t("Invité sur des séances", "Session guest"),
    })[value] ?? value;
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action(async () => {
      const result = await api<{ workspace: Workspace }>(`/workspaces/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: workspace!.name,
          version: workspace!.version,
          settings: workspace!.settings,
        }),
      });
      setWorkspace(result.workspace);
      onChanged();
      setNotice(
        t(
          "Paramètres enregistrés. Les séances existantes restent inchangées.",
          "Settings saved. Existing sessions remain unchanged.",
        ),
      );
    });
  };
  return (
    <Modal
      wide
      title={t("Gérer l’espace", "Manage workspace")}
      subtitle={workspace?.name}
      close={close}
    >
      <div className="segmented-control workspace-tabs">
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
        >
          <Settings size={16} />
          {t("Organisation et valeurs par défaut", "Organization and defaults")}
        </button>
        <button
          className={tab === "members" ? "active" : ""}
          onClick={() => setTab("members")}
        >
          <Users size={16} />
          {t("Membres et invités", "Members and guests")}
        </button>
      </div>
      {error && (
        <ErrorBanner
          message={error}
          retry={() => void reload().catch((e) => setError(e.message))}
        />
      )}
      {notice && (
        <p className="status-success" role="status">
          {notice}
        </p>
      )}
      {!workspace ? (
        <Loading />
      ) : tab === "settings" ? (
        <form className="workspace-settings" onSubmit={save}>
          <div className="form-row">
            <label>
              {t("Nom de l’espace", "Workspace name")}
              <input
                value={workspace.name}
                maxLength={200}
                required
                onChange={(e) =>
                  setWorkspace({ ...workspace, name: e.target.value })
                }
              />
            </label>
            <label>
              {t("Organisation", "Organization")}
              <input
                value={workspace.settings.organization}
                maxLength={200}
                onChange={(e) => change({ organization: e.target.value })}
              />
            </label>
          </div>
          <label>
            {t(
              "Logo (PNG, JPEG ou WebP, 85 Ko maximum)",
              "Logo (PNG, JPEG or WebP, up to 85 KB)",
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (
                  file.size > 85000 ||
                  !["image/png", "image/jpeg", "image/webp"].includes(file.type)
                ) {
                  setError(
                    t(
                      "Choisissez une image PNG, JPEG ou WebP de moins de 85 Ko.",
                      "Choose a PNG, JPEG or WebP image under 85 KB.",
                    ),
                  );
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => change({ logo: String(reader.result) });
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {workspace.settings.logo && (
            <div className="workspace-logo-preview">
              <img
                src={workspace.settings.logo}
                alt={workspace.settings.organization || workspace.name}
              />
              <button
                type="button"
                className="button secondary"
                onClick={() => change({ logo: undefined })}
              >
                {t("Retirer le logo", "Remove logo")}
              </button>
            </div>
          )}
          <h3>
            {t(
              "Valeurs par défaut des nouvelles séances",
              "New session defaults",
            )}
          </h3>
          <p className="muted">
            {t(
              "Les réglages s’appliquent uniquement à la création dans cet espace. Les membres pourront ensuite les modifier dans chaque séance.",
              "Settings apply only when creating a session in this workspace. Members can then change them in each session.",
            )}
          </p>
          <div className="workspace-copy-defaults">
            <label>
              {t(
                "Copier les réglages d’une séance accessible",
                "Copy settings from an accessible session",
              )}
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">
                  {t("Choisir une séance", "Choose a session")}
                </option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={!source || busy}
              onClick={() =>
                void action(async () => {
                  const { session } = await api<SessionResponse>(
                    `/sessions/${source}`,
                  );
                  defaults({
                    columns: session.columns,
                    editorLayout: session.editorLayout,
                    categories: session.categories,
                    pages: session.pages,
                    forms: session.forms,
                    sound: session.sound,
                    timezone: session.timezone,
                    startTime: session.days[0]?.startTime,
                  });
                  setNotice(
                    t(
                      "Réglages copiés dans ce formulaire. Vérifiez les contenus avant d’enregistrer : ils seront accessibles aux membres de cet espace.",
                      "Settings copied into this form. Review content before saving: it will become available to workspace members.",
                    ),
                  );
                })
              }
            >
              <Copy size={16} />
              {t("Copier", "Copy")}
            </button>
          </div>
          <div className="form-row">
            <label>
              {t("Fuseau horaire par défaut", "Default timezone")}
              <input
                value={workspace.settings.defaults.timezone ?? ""}
                placeholder="Europe/Zurich"
                onChange={(e) =>
                  defaults({ timezone: e.target.value || undefined })
                }
              />
            </label>
            <label>
              {t("Heure de début", "Start time")}
              <input
                type="time"
                value={workspace.settings.defaults.startTime ?? ""}
                onChange={(e) =>
                  defaults({ startTime: e.target.value || undefined })
                }
              />
            </label>
          </div>
          <details className="workspace-default-section">
            <summary>
              {t("Colonnes", "Columns")} ·{" "}
              {workspace.settings.defaults.columns?.length ??
                t("réglages initiaux", "initial settings")}
            </summary>
            {workspace.settings.defaults.columns?.map((column, index) => (
              <div className="workspace-column-row" key={column.id}>
                <input
                  aria-label={t("Titre de colonne", "Column title")}
                  value={column.label}
                  required
                  maxLength={80}
                  onChange={(e) =>
                    defaults({
                      columns: workspace.settings.defaults.columns!.map(
                        (item, i) =>
                          i === index
                            ? { ...item, label: e.target.value }
                            : item,
                      ),
                    })
                  }
                />
                <select
                  aria-label={t("Visibilité", "Visibility")}
                  value={column.visibility}
                  onChange={(e) =>
                    defaults({
                      columns: workspace.settings.defaults.columns!.map(
                        (item, i) =>
                          i === index
                            ? {
                                ...item,
                                visibility: e.target.value as "team" | "public",
                              }
                            : item,
                      ),
                    })
                  }
                >
                  <option value="team">{t("Équipe", "Team")}</option>
                  <option value="public">{t("Public", "Public")}</option>
                </select>
                <select
                  aria-label={t("Type de colonne", "Column type")}
                  value={column.kind ?? "text"}
                  onChange={(e) =>
                    defaults({
                      columns: workspace.settings.defaults.columns!.map(
                        (item, i) =>
                          i === index
                            ? {
                                ...item,
                                kind: e.target.value as
                                  "text" | "materials" | "tasks",
                              }
                            : item,
                      ),
                    })
                  }
                >
                  <option value="text">{t("Texte", "Text")}</option>
                  <option value="materials">
                    {t("Matériel", "Materials")}
                  </option>
                  <option value="tasks">{t("Tâches", "Tasks")}</option>
                </select>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("Retirer cette colonne", "Remove this column")}
                  onClick={() =>
                    defaults({
                      columns: workspace.settings.defaults.columns!.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button secondary"
              disabled={
                (workspace.settings.defaults.columns?.length ?? 0) >= 20
              }
              onClick={() =>
                defaults({
                  columns: [
                    ...(workspace.settings.defaults.columns ?? []),
                    {
                      id: crypto.randomUUID(),
                      label: t("Nouvelle colonne", "New column"),
                      visibility: "team",
                      visible: true,
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              {t("Ajouter une colonne", "Add column")}
            </button>
            {workspace.settings.defaults.columns && (
              <button
                type="button"
                className="button quiet"
                onClick={() => defaults({ columns: undefined })}
              >
                {t("Réglages initiaux", "Initial settings")}
              </button>
            )}
          </details>
          <details className="workspace-default-section">
            <summary>
              {t("Catégories", "Categories")} ·{" "}
              {workspace.settings.defaults.categories?.length ??
                t("réglages initiaux", "initial settings")}
            </summary>
            {workspace.settings.defaults.categories?.map((category, index) => (
              <div className="workspace-category-row" key={category.id}>
                <input
                  aria-label={t("Couleur", "Color")}
                  type="color"
                  value={category.color}
                  onChange={(e) =>
                    defaults({
                      categories: workspace.settings.defaults.categories!.map(
                        (item, i) =>
                          i === index
                            ? { ...item, color: e.target.value }
                            : item,
                      ),
                    })
                  }
                />
                <input
                  aria-label={t("Catégorie", "Category")}
                  value={category.label}
                  required
                  maxLength={80}
                  onChange={(e) =>
                    defaults({
                      categories: workspace.settings.defaults.categories!.map(
                        (item, i) =>
                          i === index
                            ? { ...item, label: e.target.value }
                            : item,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(
                    "Retirer cette catégorie",
                    "Remove this category",
                  )}
                  onClick={() =>
                    defaults({
                      categories:
                        workspace.settings.defaults.categories!.filter(
                          (_, i) => i !== index,
                        ),
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button secondary"
              disabled={
                (workspace.settings.defaults.categories?.length ?? 0) >= 30
              }
              onClick={() =>
                defaults({
                  categories: [
                    ...(workspace.settings.defaults.categories ?? []),
                    {
                      id: crypto.randomUUID(),
                      label: t("Nouvelle catégorie", "New category"),
                      color: "#527867",
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              {t("Ajouter une catégorie", "Add category")}
            </button>
            {workspace.settings.defaults.categories && (
              <button
                type="button"
                className="button quiet"
                onClick={() => defaults({ categories: undefined })}
              >
                {t("Réglages initiaux", "Initial settings")}
              </button>
            )}
          </details>
          <div className="workspace-content-defaults">
            {(["pages", "forms"] as const).map((kind) => (
              <div key={kind}>
                <strong>
                  {kind === "pages"
                    ? t("Pages de départ", "Starting pages")
                    : t("Formulaires de départ", "Starting forms")}
                </strong>
                <p>
                  {workspace.settings.defaults[kind]
                    ?.map((item) => item.title)
                    .join(", ") || t("Aucun", "None")}
                </p>
                {!!workspace.settings.defaults[kind]?.length && (
                  <button
                    type="button"
                    className="button quiet"
                    onClick={() => defaults({ [kind]: undefined })}
                  >
                    {t("Retirer", "Remove")}
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="muted">
            {t(
              "Préparez vos pages et formulaires dans une séance, puis copiez ses réglages ci-dessus. Les liens de publication et les réponses ne sont jamais copiés.",
              "Prepare pages and forms in a session, then copy its settings above. Publication links and responses are never copied.",
            )}
          </p>
          <h3>{t("Export par défaut", "Default export")}</h3>
          <div className="form-row">
            <label>
              {t("Destinataires", "Audience")}
              <select
                value={workspace.settings.defaults.export?.audience ?? "public"}
                onChange={(e) =>
                  defaults({
                    export: {
                      landscape:
                        workspace.settings.defaults.export?.landscape ?? false,
                      audience: e.target.value as "team" | "public",
                    },
                  })
                }
              >
                <option value="public">
                  {t(
                    "Participants (colonnes publiques)",
                    "Participants (public columns)",
                  )}
                </option>
                <option value="team">
                  {t(
                    "Équipe (informations internes possibles)",
                    "Team (may include internal information)",
                  )}
                </option>
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={workspace.settings.defaults.export?.landscape ?? false}
                onChange={(e) =>
                  defaults({
                    export: {
                      audience:
                        workspace.settings.defaults.export?.audience ??
                        "public",
                      landscape: e.target.checked,
                    },
                  })
                }
              />
              {t("Word en paysage", "Landscape Word documents")}
            </label>
          </div>
          <div className="modal-actions">
            <button className="button primary" disabled={busy}>
              {busy ? "…" : t("Enregistrer", "Save")}
            </button>
            <button
              type="button"
              className="button quiet"
              onClick={() => setConfirm("workspace")}
            >
              {t("Supprimer cet espace vide", "Delete empty workspace")}
            </button>
          </div>
        </form>
      ) : (
        <div className="workspace-members">
          <p className="muted">
            {t(
              "Les membres accèdent à toutes les séances de l’espace. Les invités accèdent uniquement aux séances qui leur ont été partagées individuellement. Le propriétaire conserve ses droits sur ses séances.",
              "Members can access every session in the workspace. Guests can access only sessions shared with them individually. Owners keep their rights over their own sessions.",
            )}
          </p>
          <form
            className="workspace-member-form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget),
                form = e.currentTarget;
              void action(async () => {
                const result = await post<{ added: boolean; token?: string }>(
                  `/workspaces/${id}/members`,
                  { email: data.get("email"), role: data.get("role") },
                );
                if (result.token) {
                  setInvitation(`${location.origin}/join/${result.token}`);
                  setCopied(false);
                } else setNotice(t("Membre ajouté.", "Member added."));
                form.reset();
                await loadMembers();
                onChanged();
              });
            }}
          >
            <label>
              {t("Adresse e-mail", "Email address")}
              <input
                type="email"
                name="email"
                required
                placeholder="colleague@example.org"
              />
            </label>
            <label>
              {t("Rôle", "Role")}
              <select name="role" defaultValue="editor">
                {(["editor", "viewer", "admin"] as const).map((value) => (
                  <option key={value} value={value}>
                    {roleLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button primary" disabled={busy}>
              <Plus size={16} />
              {t("Ajouter / inviter", "Add / invite")}
            </button>
          </form>
          {invitation && (
            <div className="workspace-invitation">
              <p>
                {t(
                  "Transmettez ce lien à la personne invitée. Il expire après 72 heures. Aucun e-mail n’a été envoyé.",
                  "Send this link to the invited person. It expires after 72 hours. No email has been sent.",
                )}
              </p>
              <input
                aria-label={t("Lien d’invitation", "Invitation link")}
                readOnly
                value={invitation}
              />
              <button
                className="button secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(invitation)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError(
                        t(
                          "Copiez le lien manuellement.",
                          "Copy the link manually.",
                        ),
                      ),
                    )
                }
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                {copied ? t("Copié", "Copied") : t("Copier", "Copy")}
              </button>
            </div>
          )}
          {members.map((member) => (
            <div className="workspace-member" key={member.userId}>
              <div>
                <strong>{member.name}</strong>
                <span>{member.email}</span>
                <details>
                  <summary>
                    {t(
                      `${member.sessions.length} séance(s) accessible(s)`,
                      `${member.sessions.length} accessible session(s)`,
                    )}
                  </summary>
                  <ul>
                    {member.sessions.map((session) => (
                      <li key={session.id}>
                        {session.title} <small>({session.role})</small>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
              {member.role === "guest" ? (
                <span className="role-chip">{roleLabel("guest")}</span>
              ) : (
                <select
                  aria-label={t(
                    `Rôle de ${member.name}`,
                    `Role for ${member.name}`,
                  )}
                  value={member.role}
                  disabled={busy}
                  onChange={(e) =>
                    void action(async () => {
                      await api(`/workspaces/${id}/members/${member.userId}`, {
                        method: "PATCH",
                        body: JSON.stringify({ role: e.target.value }),
                      });
                      await loadMembers();
                      onChanged();
                    })
                  }
                >
                  {(["admin", "editor", "viewer"] as const).map((value) => (
                    <option key={value} value={value}>
                      {roleLabel(value)}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="icon-button"
                aria-label={t(
                  `Retirer l’accès de ${member.name}`,
                  `Remove access for ${member.name}`,
                )}
                onClick={() => setConfirm(member.userId)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {!!invitations.length && (
            <h3>{t("Invitations en attente", "Pending invitations")}</h3>
          )}
          {invitations.map((invite) => (
            <div className="workspace-member" key={invite.id}>
              <div>
                <strong>{invite.email}</strong>
                <span>{roleLabel(invite.role)}</span>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api(`/workspaces/${id}/invitations/${invite.id}`, {
                      method: "DELETE",
                      body: "{}",
                    });
                    await loadMembers();
                  })
                }
              >
                {t("Révoquer", "Revoke")}
              </button>
            </div>
          ))}
        </div>
      )}
      {confirm && (
        <div className="workspace-confirm" role="alert">
          <p>
            {confirm === "workspace"
              ? t(
                  "Supprimer cet espace ? Il doit être vide. Ses paramètres et invitations seront supprimés.",
                  "Delete this workspace? It must be empty. Its settings and invitations will be deleted.",
                )
              : t(
                  "Retirer tous les accès de cette personne aux séances de cet espace ? Les séances dont elle est propriétaire doivent d’abord être déplacées ou transférées.",
                  "Remove all this person’s access to sessions in this workspace? Sessions they own must be moved or transferred first.",
                )}
          </p>
          <button
            className="button danger"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api(
                  confirm === "workspace"
                    ? `/workspaces/${id}`
                    : `/workspaces/${id}/members/${confirm}`,
                  { method: "DELETE", body: "{}" },
                );
                setConfirm("");
                onChanged();
                if (confirm === "workspace") close();
                else await loadMembers();
              })
            }
          >
            {t("Confirmer", "Confirm")}
          </button>
          <button className="button secondary" onClick={() => setConfirm("")}>
            {t("Annuler", "Cancel")}
          </button>
        </div>
      )}
    </Modal>
  );
}
