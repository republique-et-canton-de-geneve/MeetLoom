import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Eye,
  LockKeyhole,
  Copy,
  Link2,
  Users,
  ShieldCheck,
  Volume2,
  Check,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type {
  Column,
  Member,
  Role,
  Session,
  Share,
  SoundSettings,
} from "../shared/model";
import { useI18n } from "./i18n";
import { api, post } from "./api";
import { Avatar, durationLabel, ErrorBanner, Modal } from "./ui";
import { chime } from "./Timer";
import {
  FIELD_PRESETS,
  createPresetColumn,
  fieldPresetLabel,
} from "../shared/field-presets";
import { mapBlocks } from "../shared/domain";
import { QRCode } from "./QRCode";
import ParticipantInvitePanel from "./ParticipantInvitePanel";

type Common = { session: Session; close: () => void };
type Editable = Common & {
  editable: boolean;
  update: (fn: (s: Session) => Session) => void;
};

export function ColumnsPanel({ session, editable, update, close }: Editable) {
  const { t, locale } = useI18n();
  const [name, setName] = useState("");
  const change = (id: string, patch: Partial<Column>) =>
    update((s) => ({
      ...s,
      columns: s.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  return (
    <Modal
      title={t(
        "Les bons détails, aux bonnes personnes",
        "The right details for the right people",
      )}
      subtitle={t(
        "Choisissez les colonnes de votre agenda et qui peut les consulter.",
        "Choose your agenda columns and who can see them.",
      )}
      close={close}
      wide
    >
      <div className="privacy-explainer">
        <ShieldCheck size={22} />
        <p>
          {t(
            "Les colonnes « Équipe » sont exclues des données envoyées aux visiteurs. Masquer une colonne dans votre éditeur est un réglage d’affichage distinct.",
            "Team columns are excluded from the data sent to visitors. Hiding a column in your editor is a separate display setting.",
          )}
        </p>
      </div>
      <div className="column-settings-header">
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={!editable}
            checked={!!session.editorLayout?.separateDescription}
            onChange={(event) =>
              update((current) => ({
                ...current,
                editorLayout: {
                  separateTime: !!current.editorLayout?.separateTime,
                  separateDescription: event.target.checked,
                },
              }))
            }
          />
          {t(
            "Description dans une colonne séparée",
            "Description in a separate column",
          )}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={!editable}
            checked={!!session.editorLayout?.separateTime}
            onChange={(event) =>
              update((current) => ({
                ...current,
                editorLayout: {
                  separateDescription:
                    !!current.editorLayout?.separateDescription,
                  separateTime: event.target.checked,
                },
              }))
            }
          />
          {t("Séparer horaire et durée", "Separate time and duration")}
        </label>
      </div>
      <div className="column-settings-header">
        <span>{t("COLONNE", "COLUMN")}</span>
        <span>{t("VISIBLE DANS L’ÉDITEUR", "VISIBLE IN EDITOR")}</span>
        <span>{t("AUDIENCE", "AUDIENCE")}</span>
        <span />
      </div>
      {session.columns.map((c, index) => (
        <div className="column-setting" key={c.id}>
          <div className="column-name-controls">
            <span className="column-order-buttons">
              <button
                className="icon-button"
                disabled={!editable || index === 0}
                aria-label={`${t("Monter", "Move up")} ${c.label}`}
                onClick={() =>
                  update((s) => {
                    const columns = [...s.columns];
                    [columns[index - 1], columns[index]] = [
                      columns[index],
                      columns[index - 1],
                    ];
                    return { ...s, columns };
                  })
                }
              >
                <ArrowUp size={13} />
              </button>
              <button
                className="icon-button"
                disabled={!editable || index === session.columns.length - 1}
                aria-label={`${t("Descendre", "Move down")} ${c.label}`}
                onClick={() =>
                  update((s) => {
                    const columns = [...s.columns];
                    [columns[index + 1], columns[index]] = [
                      columns[index],
                      columns[index + 1],
                    ];
                    return { ...s, columns };
                  })
                }
              >
                <ArrowDown size={13} />
              </button>
            </span>
            <div>
              <input
                aria-label={t("Nom de colonne", "Column name")}
                value={c.label}
                readOnly={!editable}
                maxLength={80}
                onChange={(e) => change(c.id, { label: e.target.value })}
              />
              {!["description", "facilitator"].includes(c.id) && (
                <select
                  className="column-kind"
                  aria-label={`${t("Type de", "Type of")} ${c.label}`}
                  value={c.kind ?? "text"}
                  disabled={!editable}
                  onChange={(e) =>
                    change(c.id, { kind: e.target.value as Column["kind"] })
                  }
                >
                  <option value="text">{t("Texte riche", "Rich text")}</option>
                  <option value="materials">
                    {t("Matériel", "Materials")}
                  </option>
                  <option value="tasks">{t("Tâches", "Tasks")}</option>
                </select>
              )}
            </div>
          </div>
          <label className="switch-label">
            <input
              type="checkbox"
              checked={c.visible}
              disabled={!editable}
              onChange={(e) => change(c.id, { visible: e.target.checked })}
            />
            <span>
              {c.visible ? t("Affichée", "Shown") : t("Masquée", "Hidden")}
            </span>
          </label>
          <select
            className={c.visibility === "team" ? "private-select" : ""}
            aria-label={`${t("Audience de", "Audience for")} ${c.label}`}
            value={c.visibility}
            disabled={!editable}
            onChange={(e) =>
              change(c.id, { visibility: e.target.value as "team" | "public" })
            }
          >
            <option value="team">
              🔒 {t("Équipe uniquement", "Team only")}
            </option>
            <option value="public">
              {t("Équipe & visiteurs", "Team & visitors")}
            </option>
          </select>
          {!["description", "facilitator"].includes(c.id) && editable ? (
            <button
              className="icon-button danger"
              aria-label={`${t("Supprimer", "Delete")} ${c.label}`}
              onClick={() =>
                update((s) => ({
                  ...s,
                  columns: s.columns.filter((x) => x.id !== c.id),
                  days: s.days.map((d) => ({
                    ...d,
                    blocks: mapBlocks(d.blocks, (b) => ({
                      ...b,
                      fields: Object.fromEntries(
                        Object.entries(b.fields).filter(
                          ([key]) => key !== c.id,
                        ),
                      ),
                    })),
                  })),
                }))
              }
            >
              <Trash2 size={15} />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {editable && session.columns.length < 20 && (
        <div className="column-presets">
          <strong>{t("Champs de préparation", "Preparation fields")}</strong>
          <div className="button-row">
            {FIELD_PRESETS.map((preset) => (
              <button
                className="button secondary small"
                key={preset}
                onClick={() =>
                  update((s) => ({
                    ...s,
                    columns: [...s.columns, createPresetColumn(preset, locale)],
                  }))
                }
              >
                <Plus size={13} />
                {fieldPresetLabel(preset, locale)}
              </button>
            ))}
          </div>
          <small className="muted">
            {t(
              "Ces champs sont créés pour l’équipe et accessibles dans le détail de chaque bloc.",
              "These fields are created for the team and available in each block’s details.",
            )}
          </small>
        </div>
      )}
      {editable && session.columns.length < 20 && (
        <form
          className="add-column-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            update((s) => ({
              ...s,
              columns: [
                ...s.columns,
                {
                  id: crypto.randomUUID(),
                  label: name.trim(),
                  visibility: "team",
                  visible: true,
                },
              ],
            }));
            setName("");
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            placeholder={t(
              "Ex. Prompteur, matériel, objectif…",
              "e.g. Speaker script, materials, goal…",
            )}
          />
          <button className="button secondary">
            <Plus size={16} />
            {t("Ajouter une colonne", "Add column")}
          </button>
        </form>
      )}
      <div className="modal-actions">
        <button className="button primary" onClick={close}>
          {t("Terminé", "Done")}
        </button>
      </div>
    </Modal>
  );
}

export function SharePanel({ session, role, close }: Common & { role: Role }) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"links" | "team">("links");
  const [shareMode, setShareMode] = useState<"visitor" | "agenda">("visitor");
  const [sharedDays, setSharedDays] = useState<string[]>(
    session.days.map((day) => day.id),
  );
  const [sharedPages, setSharedPages] = useState<string[]>(
    (session.pages ?? [])
      .filter((page) => page.visibility === "public")
      .map((page) => page.id),
  );
  const [initialDay, setInitialDay] = useState(session.days[0]?.id ?? "");
  const [sharedForms, setSharedForms] = useState<string[]>([]);
  const [initialContent, setInitialContent] = useState("");
  const [allowComments, setAllowComments] = useState(false);
  const [editingShare, setEditingShare] = useState<string | null>(null),
    [linkLabel, setLinkLabel] = useState(""),
    [expires, setExpires] = useState("");
  const [shares, setShares] = useState<Share[]>([]),
    [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState(""),
    [created, setCreated] = useState(""),
    [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      if (role === "owner") {
        const [links, team] = await Promise.all([
          api<{ shares: Share[] }>(`/sessions/${session.id}/shares`),
          api<{ members: Member[] }>(`/sessions/${session.id}/members`),
        ]);
        setShares(links.shares);
        setMembers(team.members);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, [session.id]);
  const copy = async () => {
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
  };
  return (
    <Modal
      title={t("Partager la séance", "Share session")}
      subtitle={t(
        "Votre équipe prépare. Vos visiteurs suivent le fil.",
        "Your team prepares. Your visitors follow along.",
      )}
      close={close}
      wide
    >
      <div className="tabs">
        <button
          className={tab === "links" ? "active" : ""}
          onClick={() => setTab("links")}
        >
          <Link2 size={16} />
          {t("Liens visiteurs", "Visitor links")}
        </button>
        <button
          className={tab === "team" ? "active" : ""}
          onClick={() => setTab("team")}
        >
          <Users size={16} />
          {t("Équipe", "Team")}
        </button>
      </div>
      {error && <ErrorBanner message={error} />}{" "}
      {role !== "owner" ? (
        <div className="privacy-explainer">
          <LockKeyhole />
          <p>
            {t(
              "Seul le propriétaire peut gérer les liens et les accès à cette séance.",
              "Only the owner can manage links and access to this session.",
            )}
          </p>
        </div>
      ) : tab === "links" ? (
        <>
          <div className="privacy-explainer">
            <Eye size={22} />
            <p>
              {t(
                "Un lien donne accès à l’agenda et à sa progression sans compte. Seules les colonnes marquées « Équipe & visiteurs » sont transmises.",
                "A link gives access to the agenda and its progress without an account. Only columns marked “Team & visitors” are shared.",
              )}
            </p>
          </div>
          <div className="audience-preview">
            <span>{t("Colonnes partagées :", "Shared columns:")}</span>
            {session.columns
              .filter((c) => c.visibility === "public")
              .map((c) => (
                <span className="tag" key={c.id}>
                  {c.label}
                </span>
              ))}
            <span className="private-tag">
              <LockKeyhole size={12} />
              {
                session.columns.filter((c) => c.visibility === "team").length
              }{" "}
              {t("privée(s)", "private")}
            </span>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const values = Object.fromEntries(new FormData(e.currentTarget));
              try {
                const payload = {
                  label: linkLabel,
                  mode: shareMode,
                  dayIds: sharedDays,
                  pageIds: sharedPages,
                  formIds: shareMode === "visitor" ? sharedForms : [],
                  initialContentId: initialContent || null,
                  initialDayId:
                    shareMode === "agenda"
                      ? sharedDays.includes(initialDay)
                        ? initialDay
                        : sharedDays[0]
                      : null,
                  allowComments: shareMode === "visitor" && allowComments,
                  expiresAt: expires
                    ? new Date(`${expires}T23:59:59`).toISOString()
                    : null,
                };
                if (editingShare) {
                  await api(`/sessions/${session.id}/shares/${editingShare}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                  });
                  setEditingShare(null);
                  setLinkLabel("");
                  setExpires("");
                  setCreated("");
                } else {
                  const r = await post<{ share: Share }>(
                    `/sessions/${session.id}/shares`,
                    payload,
                  );
                  setCreated(`${location.origin}/s/${r.share.token}`);
                }
                setCopied(false);
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("Présentation du lien", "Link layout")}
              <select
                value={shareMode}
                onChange={(event) =>
                  setShareMode(event.target.value as "visitor" | "agenda")
                }
              >
                <option value="visitor">
                  {t(
                    "Visiteur · détails et colonnes autorisés",
                    "Visitor · permitted details and columns",
                  )}
                </option>
                <option value="agenda">
                  {t(
                    "Agenda simple · titres, horaires et progression",
                    "Simple agenda · titles, times and progress",
                  )}
                </option>
              </select>
            </label>
            <fieldset className="share-scope">
              <legend>{t("Jours accessibles", "Shared days")}</legend>
              {session.days.map((day) => (
                <label key={day.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={sharedDays.includes(day.id)}
                    onChange={(event) =>
                      setSharedDays((current) =>
                        event.target.checked
                          ? [...current, day.id]
                          : current.filter((id) => id !== day.id),
                      )
                    }
                  />
                  {day.title}
                </label>
              ))}
            </fieldset>
            {shareMode === "agenda" && (
              <label>
                {t("Jour affiché à l’ouverture", "Day shown on opening")}
                <select
                  value={
                    sharedDays.includes(initialDay)
                      ? initialDay
                      : (sharedDays[0] ?? "")
                  }
                  onChange={(event) => setInitialDay(event.target.value)}
                >
                  {session.days
                    .filter((day) => sharedDays.includes(day.id))
                    .map((day) => (
                      <option value={day.id} key={day.id}>
                        {day.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {shareMode === "visitor" && (
              <>
                {!!session.forms?.length && (
                  <fieldset className="share-scope">
                    <legend>
                      {t("Formulaires accessibles", "Shared forms")}
                    </legend>
                    <p className="muted">
                      {t(
                        "Seuls les formulaires publiés et ouverts seront proposés aux visiteurs.",
                        "Only published, open forms appear for visitors.",
                      )}
                    </p>
                    {session.forms.map((form) => (
                      <label key={form.id} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={sharedForms.includes(form.id)}
                          onChange={(event) =>
                            setSharedForms((current) =>
                              event.target.checked
                                ? [...current, form.id]
                                : current.filter((id) => id !== form.id),
                            )
                          }
                        />
                        {form.title}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label>
                  {t(
                    "Contenu affiché à l’ouverture",
                    "Content shown on opening",
                  )}
                  <select
                    value={initialContent}
                    onChange={(event) => setInitialContent(event.target.value)}
                  >
                    <option value="">
                      {t(
                        "Ordre de navigation de la séance",
                        "Session navigation order",
                      )}
                    </option>
                    {[
                      ...session.days.filter((day) =>
                        sharedDays.includes(day.id),
                      ),
                      ...(session.pages ?? []).filter((page) =>
                        sharedPages.includes(page.id),
                      ),
                      ...(session.forms ?? []).filter((form) =>
                        sharedForms.includes(form.id),
                      ),
                    ].map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                {!!session.pages?.some(
                  (page) => page.visibility === "public",
                ) && (
                  <fieldset className="share-scope">
                    <legend>{t("Pages accessibles", "Shared pages")}</legend>
                    {session.pages
                      .filter((page) => page.visibility === "public")
                      .map((page) => (
                        <label className="checkbox-label" key={page.id}>
                          <input
                            type="checkbox"
                            checked={sharedPages.includes(page.id)}
                            onChange={(event) =>
                              setSharedPages((current) =>
                                event.target.checked
                                  ? [...current, page.id]
                                  : current.filter((id) => id !== page.id),
                              )
                            }
                          />
                          {page.title}
                        </label>
                      ))}
                  </fieldset>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={allowComments}
                    onChange={(event) => setAllowComments(event.target.checked)}
                  />
                  {t(
                    "Permettre les commentaires visibles par les visiteurs de ce lien",
                    "Allow comments visible to visitors of this link",
                  )}
                </label>
              </>
            )}
            <div className="form-grid">
              <label>
                {t("Nom du lien", "Link label")}
                <input
                  name="label"
                  value={linkLabel}
                  onChange={(event) => setLinkLabel(event.target.value)}
                  maxLength={100}
                  required
                  placeholder={t(
                    "Ex. Participants du comité",
                    "e.g. Committee participants",
                  )}
                />
              </label>
              <label>
                {t("Expire le (facultatif)", "Expires on (optional)")}
                <input
                  name="expires"
                  value={expires}
                  onChange={(event) => setExpires(event.target.value)}
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                />
              </label>
            </div>
            <button
              className="button primary"
              disabled={
                busy ||
                (!sharedDays.length &&
                  (shareMode === "agenda" ||
                    (!sharedPages.length && !sharedForms.length)))
              }
            >
              <Link2 size={16} />
              {editingShare
                ? t("Enregistrer la portée du lien", "Save link scope")
                : t("Générer le lien visiteur", "Generate visitor link")}
            </button>
            {editingShare && (
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setEditingShare(null);
                  setLinkLabel("");
                  setExpires("");
                }}
              >
                {t("Annuler", "Cancel")}
              </button>
            )}
          </form>
          {created && (
            <div className="share-result">
              <strong>{t("Votre lien est prêt", "Your link is ready")}</strong>
              <p>
                {t(
                  "Copiez-le maintenant : le jeton complet n’est pas conservé sur le serveur.",
                  "Copy it now: the full token is not stored on the server.",
                )}
              </p>
              <div className="button-row">
                <input
                  value={created}
                  readOnly
                  onFocus={(e) => e.target.select()}
                  aria-label={t("Lien visiteur créé", "Created visitor link")}
                />
                <button className="button secondary" onClick={copy}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                  {copied ? t("Copié", "Copied") : t("Copier", "Copy")}
                </button>
                <a
                  className="button secondary"
                  href={created}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Eye size={16} />
                  {t("Aperçu", "Preview")}
                </a>
              </div>
              <QRCode value={created} />
            </div>
          )}
          <h3 className="subheading">
            {t("Liens existants", "Existing links")}
          </h3>
          {!shares.length && (
            <p className="muted">
              {t(
                "Aucun lien visiteur pour le moment.",
                "No visitor links yet.",
              )}
            </p>
          )}
          {shares.map((share) => (
            <div className="list-item" key={share.id}>
              <span className="list-icon">
                <Link2 size={18} />
              </span>
              <div>
                <strong>{share.label}</strong>
                <small>
                  {share.mode === "agenda"
                    ? t("Agenda simple", "Simple agenda")
                    : t("Visiteur", "Visitor")}{" "}
                  · {share.dayIds?.length ?? session.days.length}{" "}
                  {t("jour(s)", "day(s)")}
                  {share.allowComments
                    ? ` · ${t("commentaires autorisés", "comments allowed")}`
                    : ""}
                </small>
                <small>
                  {share.expiresAt
                    ? t(
                        `Expire le ${new Date(share.expiresAt).toLocaleDateString(locale)}`,
                        `Expires ${new Date(share.expiresAt).toLocaleDateString(locale)}`,
                      )
                    : t("Sans expiration", "No expiration")}
                </small>
              </div>
              <button
                className="button secondary small"
                onClick={() => {
                  setEditingShare(share.id);
                  setLinkLabel(share.label);
                  setExpires(share.expiresAt?.slice(0, 10) ?? "");
                  setShareMode(share.mode ?? "visitor");
                  setSharedDays(
                    share.dayIds ?? session.days.map((day) => day.id),
                  );
                  setSharedPages(
                    share.pageIds ??
                      (session.pages ?? [])
                        .filter((page) => page.visibility === "public")
                        .map((page) => page.id),
                  );
                  setInitialDay(share.initialDayId ?? session.days[0].id);
                  setSharedForms(share.formIds ?? []);
                  setInitialContent(share.initialContentId ?? "");
                  setAllowComments(!!share.allowComments);
                  setCreated("");
                }}
              >
                {t("Modifier", "Edit")}
              </button>
              <button
                className="button secondary small"
                onClick={async () => {
                  try {
                    await api(`/sessions/${session.id}/shares/${share.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        enabled: share.enabled === false,
                      }),
                    });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {share.enabled === false
                  ? t("Réactiver", "Enable")
                  : t("Désactiver", "Disable")}
              </button>
              <button
                className="button secondary small danger"
                onClick={async () => {
                  try {
                    await api(`/sessions/${session.id}/shares/${share.id}`, {
                      method: "DELETE",
                    });
                    await load();
                    setCreated("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {t("Révoquer", "Revoke")}
              </button>
            </div>
          ))}
        </>
      ) : (
        <>
          <ParticipantInvitePanel sessionId={session.id} onChanged={load} />
          <div className="member-list">
            {members.map((member) => (
              <div className="list-item" key={member.userId}>
                <Avatar name={member.name} />
                <div>
                  <strong>{member.name}</strong>
                  <small>{member.email}</small>
                </div>
                <span className="tag">
                  {
                    {
                      owner: t("Propriétaire", "Owner"),
                      editor: t("Éditeur", "Editor"),
                      facilitator: t("Animateur", "Facilitator"),
                      viewer: t("Lecteur", "Viewer"),
                    }[member.role]
                  }
                </span>
                {member.role !== "owner" && (
                  <button
                    className="icon-button danger"
                    title={t("Retirer l’accès", "Remove access")}
                    onClick={async () => {
                      try {
                        await api(
                          `/sessions/${session.id}/members/${member.userId}`,
                          { method: "DELETE" },
                        );
                        await load();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

export function SettingsPanel({
  session,
  editable,
  update,
  close,
  isAdmin,
}: Editable & { isAdmin: boolean }) {
  const { t } = useI18n();
  const [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const change = (sound: Partial<SoundSettings>) =>
    update((s) => ({ ...s, sound: { ...s.sound, ...sound } }));
  return (
    <Modal
      title={t("Le bon rythme, à votre façon", "The right rhythm, your way")}
      subtitle={t(
        "Ces alertes s’appliquent à tous les blocs de la séance.",
        "These alerts apply to every block in this session.",
      )}
      close={close}
    >
      <label>
        {t("Fuseau horaire", "Time zone")}
        <select
          value={session.timezone}
          disabled={!editable}
          onChange={(e) => update((s) => ({ ...s, timezone: e.target.value }))}
        >
          {[
            ...new Set([
              session.timezone,
              "Europe/Zurich",
              "Europe/Paris",
              "Europe/London",
              "UTC",
              "America/New_York",
              "America/Montreal",
            ]),
          ].map((zone) => (
            <option key={zone}>{zone}</option>
          ))}
        </select>
      </label>
      <h3 className="subheading">{t("Alertes sonores", "Sound alerts")}</h3>
      <label className="setting-toggle">
        <span>
          <strong>
            {t("Un rappel avant la fin", "A reminder before the end")}
          </strong>
          <small>
            {t(
              "Laissez le temps à chacun de conclure.",
              "Give everyone time to wrap up.",
            )}
          </small>
        </span>
        <input
          type="checkbox"
          checked={session.sound.enabled}
          disabled={!editable}
          onChange={(e) => change({ enabled: e.target.checked })}
        />
      </label>
      <div className="form-grid">
        <label>
          {t("Déclencher le rappel", "Trigger reminder")}
          <select
            value={session.sound.mode}
            disabled={!editable}
            onChange={(e) =>
              change({
                mode: e.target.value as "minutes" | "percent",
                value: e.target.value === "percent" ? 20 : 1,
              })
            }
          >
            <option value="minutes">
              {t("En minutes restantes", "Minutes remaining")}
            </option>
            <option value="percent">
              {t("En pourcentage restant", "Percentage remaining")}
            </option>
          </select>
        </label>
        <label>
          {session.sound.mode === "minutes"
            ? t("Minutes avant la fin", "Minutes before end")
            : t("% du temps restant", "% of time remaining")}
          <input
            type="number"
            min={session.sound.mode === "minutes" ? 0.1 : 1}
            step={session.sound.mode === "minutes" ? 0.1 : 1}
            max={session.sound.mode === "minutes" ? 1440 : 99}
            value={session.sound.value}
            readOnly={!editable}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (
                value > 0 &&
                value <= (session.sound.mode === "percent" ? 99 : 1440)
              )
                change({ value });
            }}
          />
        </label>
      </div>
      <p className="setting-hint">
        {session.sound.mode === "percent"
          ? t(
              `Pour un bloc de 10 minutes, le rappel sonne à ${session.sound.value / 10} minute(s) de la fin.`,
              `For a 10-minute block, the reminder sounds with ${session.sound.value / 10} minute(s) remaining.`,
            )
          : t(
              "Si le bloc est plus court que le seuil, seul le son de fin est joué.",
              "If the block is shorter than the threshold, only the end sound plays.",
            )}
      </p>
      <label className="setting-toggle">
        <span>
          {t(
            "Sonner aussi à la fin du bloc",
            "Also chime at the end of the block",
          )}
        </span>
        <input
          type="checkbox"
          checked={session.sound.atEnd}
          disabled={!editable}
          onChange={(e) => change({ atEnd: e.target.checked })}
        />
      </label>
      <div className="form-grid">
        <label>
          {t("Son", "Sound")}
          <select
            value={session.sound.sound}
            disabled={!editable}
            onChange={(e) =>
              change({ sound: e.target.value as SoundSettings["sound"] })
            }
          >
            <option value="bell">{t("Clochette", "Bell")}</option>
            <option value="soft">{t("Doux", "Soft")}</option>
            <option value="digital">{t("Digital", "Digital")}</option>
          </select>
        </label>
        <label>
          {t("Volume", "Volume")}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={session.sound.volume}
            disabled={!editable}
            onChange={(e) => change({ volume: Number(e.target.value) })}
          />
        </label>
      </div>
      <button
        className="button secondary"
        onClick={() => chime(session.sound, true)}
      >
        <Volume2 size={16} />
        {t("Écouter le son", "Preview sound")}
      </button>
      <p className="setting-hint">
        {t(
          "Chaque animateur active le son sur son appareil. Les visiteurs restent silencieux.",
          "Each facilitator enables sound on their device. Visitor views stay silent.",
        )}
      </p>
      {error && <ErrorBanner message={error} />}{" "}
      {message && <p className="success-message">{message}</p>}
      <div className="modal-actions spread">
        {editable && isAdmin && (
          <button
            className="text-button"
            onClick={async () => {
              try {
                await api("/settings", {
                  method: "PUT",
                  body: JSON.stringify({ sound: session.sound }),
                });
                setMessage(
                  t(
                    "Réglages enregistrés pour les nouvelles séances.",
                    "Settings saved for new sessions.",
                  ),
                );
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {t(
              "Définir comme réglages par défaut",
              "Set as workspace defaults",
            )}
          </button>
        )}
        <button className="button primary" onClick={close}>
          {t("Terminé", "Done")}
        </button>
      </div>
    </Modal>
  );
}
