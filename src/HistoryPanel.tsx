import { useEffect, useState } from "react";
import {
  ArchiveRestore,
  BookmarkPlus,
  Copy,
  Eye,
  Flag,
  History,
  ListChecks,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type { Session } from "../shared/model";
import type {
  DeletedElement,
  HistoryChange,
  JournalEntry,
  NamedVersion,
  RunRecord,
  VersionPreview,
} from "../shared/history";
import { allBlocks, blockDuration, withStepDurations } from "../shared/domain";
import { api, ApiError, post } from "./api";
import { useI18n } from "./i18n";
import { durationLabel, ErrorBanner, Inspector, Loading } from "./ui";
import { RichText } from "./RichText";
import RunsHistory from "./RunsHistory";
import "./history.css";

type Tab = "versions" | "journal" | "runs" | "deleted";
type Props = {
  session: Session;
  editable: boolean;
  reload: () => Promise<void>;
  /** Undoable agenda change, like any edit. */
  update: (change: (session: Session) => Session) => void;
  initialTab?: Tab;
  close: () => void;
};
type Restore = {
  versionId: string;
  dayId: string;
  targetDayId: string;
  mode: "replace" | "copy";
};
function HistoryPanel({
  session,
  editable,
  reload,
  update,
  initialTab = "versions",
  close,
}: Props) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [versions, setVersions] = useState<NamedVersion[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [deleted, setDeleted] = useState<DeletedElement[]>([]);
  const [journalCursor, setJournalCursor] = useState<number | null>(null),
    [trashCursor, setTrashCursor] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<VersionPreview | null>(null),
    [dayId, setDayId] = useState(""),
    [targetDayId, setTargetDayId] = useState(session.days[0]?.id ?? "");
  const [confirm, setConfirm] = useState<Restore | null>(null),
    [deleteVersion, setDeleteVersion] = useState<string | null>(null);
  const [editing, setEditing] = useState<NamedVersion | null>(null),
    [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const [trashTargets, setTrashTargets] = useState<Record<string, string>>({});
  const formatDate = (value: string) =>
    new Date(value).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const message = (cause: unknown) =>
    cause instanceof ApiError
      ? ((
          {
            HISTORY_RUN_ACTIVE: t(
              "Arrêtez le minuteur avant de restaurer son jour actif. Vous pouvez copier le jour dans un nouveau jour.",
              "Stop the timer before restoring its active day. You can copy it into a new day.",
            ),
            HISTORY_EXPIRED: t(
              "Cet élément est déjà restauré ou les 72 heures de conservation sont écoulées.",
              "This item is already restored or its 72-hour retention has ended.",
            ),
            HISTORY_ALREADY_PRESENT: t(
              "Cet élément existe déjà dans l’agenda.",
              "This element already exists in the agenda.",
            ),
            HISTORY_TARGET_REQUIRED: t(
              "Le jour d’origine a été supprimé. Choisissez un jour de destination.",
              "The original day was deleted. Choose a destination day.",
            ),
            HISTORY_LIMIT: t(
              "La limite est de 100 versions nommées. Supprimez une ancienne version avant d’en créer une autre.",
              "The limit is 100 named versions. Delete an old version before creating another.",
            ),
            VERSION_CONFLICT: t(
              "L’agenda ou cette version a changé. Rechargez l’agenda avant de réessayer.",
              "The agenda or this version changed. Reload the agenda before retrying.",
            ),
          } as Record<string, string>
        )[cause.code] ?? cause.message)
      : (cause as Error).message;
  const load = async (append = false) => {
    if (tab === "versions")
      setVersions(
        (
          await api<{ versions: NamedVersion[] }>(
            `/sessions/${session.id}/versions`,
          )
        ).versions,
      );
    else if (tab === "runs")
      setRuns(
        (await api<{ runs: RunRecord[] }>(`/sessions/${session.id}/runs`)).runs,
      );
    else if (tab === "journal") {
      const result = await api<{
        entries: JournalEntry[];
        nextBeforeVersion: number | null;
      }>(
        `/sessions/${session.id}/journal${append && journalCursor ? `?beforeVersion=${journalCursor}` : ""}`,
      );
      setEntries((previous) =>
        append ? [...previous, ...result.entries] : result.entries,
      );
      setJournalCursor(result.nextBeforeVersion);
    } else {
      const result = await api<{
        elements: DeletedElement[];
        nextBefore: string | null;
      }>(
        `/sessions/${session.id}/deleted-elements${append && trashCursor ? `?before=${encodeURIComponent(trashCursor)}` : ""}`,
      );
      setDeleted((previous) =>
        append ? [...previous, ...result.elements] : result.elements,
      );
      setTrashCursor(result.nextBefore);
    }
  };
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setPreview(null);
    setConfirm(null);
    void load()
      .catch((cause) => {
        if (alive) setError(message(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [session.id, tab]);
  const perform = async (task: () => Promise<void>, success = "") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (success) setNotice(success);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const restore = async (action: Restore) =>
    perform(
      async () => {
        await post(
          `/sessions/${session.id}/versions/${action.versionId}/restore`,
          {
            version: session.version,
            dayId: action.dayId,
            targetDayId:
              action.mode === "replace" ? action.targetDayId : undefined,
            mode: action.mode,
          },
        );
        setConfirm(null);
        await reload();
        await load();
      },
      action.mode === "copy"
        ? t(
            "Le jour a été copié avec de nouveaux identifiants.",
            "The day was copied with new identifiers.",
          )
        : t(
            "Le jour a été restauré. Son état précédent reste dans les versions automatiques.",
            "The day was restored. Its previous state remains in automatic versions.",
          ),
    );
  const fieldLabel = (field: string) =>
    field.startsWith("column:")
      ? (session.columns.find((column) => column.id === field.slice(7))
          ?.label ?? field.slice(7))
      : ((
          {
            title: t("Titre", "Title"),
            description: t("Description", "Description"),
            duration: t("Durée (min)", "Duration (min)"),
            category: t("Catégorie", "Category"),
            facilitator: t("Intervenant", "Facilitator"),
            section: t("Section", "Section"),
            lockedStart: t("Horaire verrouillé", "Locked start"),
            kind: t("Type", "Type"),
            date: t("Date", "Date"),
            startTime: t("Début", "Start"),
            visibility: t("Visibilité", "Visibility"),
            sections: t("Contenu", "Content"),
            questions: t("Questions", "Questions"),
            identityMode: t("Identification", "Identification"),
            client: t("Client", "Client"),
            tags: t("Étiquettes", "Tags"),
            folder: t("Dossier", "Folder"),
            timezone: t("Fuseau horaire", "Timezone"),
            columns: t("Colonnes", "Columns"),
            categories: t("Catégories", "Categories"),
            sound: t("Alertes sonores", "Sound alerts"),
            archived: t("Archivage", "Archive state"),
            contentOrder: t(
              "Ordre des jours et contenus",
              "Day and content order",
            ),
            location: t("Emplacement", "Location"),
          } as Record<string, string>
        )[field] ?? field);
  const actionLabel = (action: HistoryChange["action"]) =>
    ({
      added: t("Ajout", "Added"),
      changed: t("Modification", "Changed"),
      deleted: t("Suppression", "Deleted"),
      moved: t("Déplacement", "Moved"),
    })[action];
  const kindLabel = (kind: HistoryChange["kind"]) =>
    ({
      session: t("Séance", "Session"),
      day: t("Jour", "Day"),
      block: t("Bloc", "Block"),
      page: t("Page", "Page"),
      form: t("Formulaire", "Form"),
    })[kind];
  const automaticLabel = (version: NamedVersion) =>
    version.named
      ? version.label
      : ((
          {
            "Agenda edit": t("Avant modification", "Before edit"),
            "Restored version": t("Avant restauration", "Before restore"),
            "Copied historical day": t(
              "Avant copie d’un jour",
              "Before copying a day",
            ),
            "Restored deleted element": t(
              "Avant restauration d’un élément",
              "Before restoring an item",
            ),
          } as Record<string, string>
        )[version.label] ?? t("Version automatique", "Automatic version"));
  const previewDay = preview?.session.days.find((day) => day.id === dayId);
  return (
    <Inspector
      title={t("Versions & activité", "Versions & activity")}
      subtitle={t(
        "Versions nommées, changements de l’équipe, déroulés passés et éléments supprimés.",
        "Named versions, team changes, past runs and deleted items.",
      )}
      close={close}
    >
      <div className="history-panel">
        <div
          className="history-tabs"
          role="tablist"
          aria-label={t("Historique", "History")}
        >
          {(["versions", "journal", "runs", "deleted"] as const).map(
            (value) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
              >
                {value === "versions" ? (
                  <History size={15} />
                ) : value === "journal" ? (
                  <ListChecks size={15} />
                ) : value === "runs" ? (
                  <Flag size={15} />
                ) : (
                  <Trash2 size={15} />
                )}
                {
                  {
                    versions: t("Versions", "Versions"),
                    journal: t("Journal", "Activity"),
                    runs: t("Déroulés", "Runs"),
                    deleted: t("Supprimés", "Deleted"),
                  }[value]
                }
              </button>
            ),
          )}
        </div>
        {error && <ErrorBanner message={error} />}
        {notice && (
          <p className="history-notice" role="status">
            {notice}
          </p>
        )}
        <div className="history-refresh">
          <button
            className="text-button"
            disabled={busy || loading}
            onClick={() => void perform(() => load())}
          >
            <RefreshCw size={14} />
            {t("Actualiser", "Refresh")}
          </button>
        </div>
        {loading ? (
          <Loading />
        ) : tab === "versions" ? (
          <>
            {editable && (
              <details className="history-create">
                <summary>
                  <BookmarkPlus size={16} />
                  {t("Enregistrer une version nommée", "Save a named version")}
                </summary>
                <p className="muted">
                  {t(
                    "Enregistrez d’abord vos modifications. La version conserve l’agenda enregistré sur le serveur.",
                    "Save your changes first. This captures the agenda saved on the server.",
                  )}
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const values = new FormData(event.currentTarget);
                    const form = event.currentTarget;
                    void perform(
                      async () => {
                        await post(`/sessions/${session.id}/versions`, {
                          version: session.version,
                          name: values.get("name"),
                          description: values.get("description"),
                        });
                        form.reset();
                        await load();
                      },
                      t("Version enregistrée.", "Version saved."),
                    );
                  }}
                >
                  <label>
                    {t("Nom", "Name")}
                    <input
                      name="name"
                      required
                      maxLength={120}
                      placeholder={t(
                        "Ex. Validation de l’équipe",
                        "e.g. Team approval",
                      )}
                    />
                  </label>
                  <label>
                    {t("Description", "Description")}
                    <textarea name="description" maxLength={2000} rows={2} />
                  </label>
                  <button className="button primary small" disabled={busy}>
                    <Save size={15} />
                    {t("Enregistrer", "Save")}
                  </button>
                </form>
              </details>
            )}
            <p className="muted">
              {t(
                "100 versions automatiques et jusqu’à 100 versions nommées conservées. Les versions nommées restent jusqu’à leur suppression.",
                "100 automatic and up to 100 named versions are retained. Named versions remain until deleted.",
              )}
            </p>
            {!versions.length && (
              <p className="muted">
                {t("Aucune version enregistrée.", "No saved versions yet.")}
              </p>
            )}
            {versions.map((version) => (
              <article className="history-version" key={version.id}>
                <div>
                  <strong>{automaticLabel(version)}</strong>
                  {version.named && (
                    <span className="history-badge">
                      {t("Nommée", "Named")}
                    </span>
                  )}
                  <small>
                    {formatDate(version.createdAt)} · {version.author}
                  </small>
                  {version.description && <p>{version.description}</p>}
                </div>
                <div className="history-version-actions">
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const data = await api<VersionPreview>(
                          `/sessions/${session.id}/versions/${version.id}`,
                        );
                        setPreview(data);
                        setDayId(data.session.days[0]?.id ?? "");
                        setTargetDayId(
                          session.days.some(
                            (day) => day.id === data.session.days[0]?.id,
                          )
                            ? data.session.days[0].id
                            : session.days[0].id,
                        );
                        setConfirm(null);
                      })
                    }
                  >
                    <Eye size={14} />
                    {t("Voir", "Preview")}
                  </button>
                  {editable && (
                    <>
                      <button
                        className="icon-button"
                        title={t("Nom et description", "Name and description")}
                        aria-label={t(
                          "Modifier le nom de la version",
                          "Edit version name",
                        )}
                        onClick={() => {
                          setEditing(version);
                          setName(version.label);
                          setDescription(version.description);
                          setDeleteVersion(null);
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={busy}
                        title={t("Supprimer la version", "Delete version")}
                        aria-label={t("Supprimer la version", "Delete version")}
                        onClick={() => setDeleteVersion(version.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
                {deleteVersion === version.id && (
                  <div className="history-confirm">
                    <p>
                      {t(
                        "Supprimer définitivement cette version ? La séance actuelle reste inchangée.",
                        "Permanently delete this version? The current agenda stays unchanged.",
                      )}
                    </p>
                    <div className="button-row">
                      <button
                        className="button secondary small"
                        onClick={() => setDeleteVersion(null)}
                      >
                        {t("Annuler", "Cancel")}
                      </button>
                      <button
                        className="button danger small"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await api(
                              `/sessions/${session.id}/versions/${version.id}`,
                              {
                                method: "DELETE",
                                body: JSON.stringify({
                                  version: session.version,
                                  revision: version.revision,
                                }),
                              },
                            );
                            setDeleteVersion(null);
                            if (preview?.version.id === version.id)
                              setPreview(null);
                            await load();
                          })
                        }
                      >
                        {t("Supprimer", "Delete")}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
            {editing && (
              <form
                className="history-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(
                    async () => {
                      await api(
                        `/sessions/${session.id}/versions/${editing.id}`,
                        {
                          method: "PATCH",
                          body: JSON.stringify({
                            version: session.version,
                            revision: editing.revision,
                            name,
                            description,
                          }),
                        },
                      );
                      setEditing(null);
                      await load();
                    },
                    t("Version renommée.", "Version renamed."),
                  );
                }}
              >
                <h3>{t("Nom et description", "Name and description")}</h3>
                <label>
                  {t("Nom", "Name")}
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={120}
                  />
                </label>
                <label>
                  {t("Description", "Description")}
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </label>
                <div className="button-row">
                  <button
                    className="button secondary small"
                    type="button"
                    onClick={() => setEditing(null)}
                  >
                    {t("Annuler", "Cancel")}
                  </button>
                  <button className="button primary small" disabled={busy}>
                    {t("Enregistrer", "Save")}
                  </button>
                </div>
              </form>
            )}
            {preview && (
              <section className="history-preview">
                <header>
                  <h3>
                    {t("Aperçu", "Preview")} · {automaticLabel(preview.version)}
                  </h3>
                  <button
                    className="icon-button"
                    aria-label={t("Fermer l’aperçu", "Close preview")}
                    onClick={() => {
                      setPreview(null);
                      setConfirm(null);
                    }}
                  >
                    <X size={16} />
                  </button>
                </header>
                <label>
                  {t("Jour de la version", "Day in this version")}
                  <select
                    value={dayId}
                    onChange={(event) => {
                      setDayId(event.target.value);
                      setConfirm(null);
                      if (
                        session.days.some(
                          (day) => day.id === event.target.value,
                        )
                      )
                        setTargetDayId(event.target.value);
                    }}
                  >
                    {preview.session.days.map((day) => (
                      <option key={day.id} value={day.id}>
                        {day.title} · {day.date}
                      </option>
                    ))}
                  </select>
                </label>
                {previewDay && (
                  <>
                    <p className="muted">
                      {previewDay.date} · {previewDay.startTime} ·{" "}
                      {durationLabel(
                        previewDay.blocks.reduce(
                          (total, block) => total + blockDuration(block),
                          0,
                        ),
                      )}
                    </p>
                    <div className="history-preview-blocks">
                      {allBlocks(previewDay.blocks).map((block) => (
                        <details key={block.id}>
                          <summary>
                            <strong>{block.title}</strong>
                            <span>{durationLabel(blockDuration(block))}</span>
                          </summary>
                          <RichText value={block.description} />
                          {Object.entries(block.fields)
                            .filter(([, value]) => value)
                            .map(([key, value]) => (
                              <div key={key}>
                                <strong>
                                  {preview.session.columns.find(
                                    (column) => column.id === key,
                                  )?.label ?? key}
                                </strong>
                                <RichText value={value} />
                              </div>
                            ))}
                        </details>
                      ))}
                    </div>
                  </>
                )}
                {editable && (
                  <>
                    <label>
                      {t("Jour actuel à remplacer", "Current day to replace")}
                      <select
                        value={targetDayId}
                        onChange={(event) => setTargetDayId(event.target.value)}
                      >
                        {session.days.map((day) => (
                          <option key={day.id} value={day.id}>
                            {day.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="button-row">
                      <button
                        className="button secondary small"
                        disabled={busy || !dayId}
                        onClick={() =>
                          void restore({
                            versionId: preview.version.id,
                            dayId,
                            targetDayId,
                            mode: "copy",
                          })
                        }
                      >
                        <Copy size={14} />
                        {t("Copier en nouveau jour", "Copy as a new day")}
                      </button>
                      <button
                        className="button primary small"
                        disabled={busy || !dayId || !targetDayId}
                        onClick={() =>
                          setConfirm({
                            versionId: preview.version.id,
                            dayId,
                            targetDayId,
                            mode: "replace",
                          })
                        }
                      >
                        <ArchiveRestore size={14} />
                        {t("Restaurer le jour", "Restore day")}
                      </button>
                    </div>
                    <p className="muted">
                      {t(
                        "Les champs privés restaurés restent privés. Le minuteur du jour actif doit être arrêté avant un remplacement.",
                        "Restored private fields stay private. Stop the active day’s timer before replacing it.",
                      )}
                    </p>
                  </>
                )}
                {confirm && (
                  <div className="history-confirm">
                    <p>
                      {t(
                        `Remplacer « ${session.days.find((day) => day.id === confirm.targetDayId)?.title} » par ce jour historique ? Le jour actuel sera conservé dans une version automatique.`,
                        `Replace “${session.days.find((day) => day.id === confirm.targetDayId)?.title}” with this historical day? The current day will be saved as an automatic version.`,
                      )}
                    </p>
                    <div className="button-row">
                      <button
                        className="button secondary small"
                        onClick={() => setConfirm(null)}
                      >
                        {t("Annuler", "Cancel")}
                      </button>
                      <button
                        className="button primary small"
                        disabled={busy}
                        onClick={() => void restore(confirm)}
                      >
                        {t("Confirmer la restauration", "Confirm restore")}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        ) : tab === "runs" ? (
          <RunsHistory
            runs={runs}
            session={session}
            editable={editable}
            apply={(run, durations) => {
              setError("");
              try {
                update((current) => ({
                  ...current,
                  days: withStepDurations(
                    current.days,
                    run.dayId,
                    durations === "plan"
                      ? run.plan
                      : Object.fromEntries(
                          run.blocks
                            .filter((block) => block.actual > 0)
                            .map((block) => [block.id, block.actual]),
                        ),
                    durations === "actual",
                  ),
                }));
                setNotice(
                  durations === "plan"
                    ? t(
                        "Plan rétabli dans l’agenda. Le bouton Annuler le défait.",
                        "Plan restored in the agenda. Undo reverts it.",
                      )
                    : t(
                        "Durées réelles appliquées à l’agenda. Le bouton Annuler le défait.",
                        "Actual durations applied to the agenda. Undo reverts it.",
                      ),
                );
              } catch (cause) {
                setError((cause as Error).message);
              }
            }}
          />
        ) : tab === "journal" ? (
          <>
            <p className="muted">
              {t(
                "Les 1 000 derniers enregistrements avec auteur et détails. Les textes longs sont abrégés.",
                "The last 1,000 saves with authors and details. Long text is abbreviated.",
              )}
            </p>
            {!entries.length && (
              <p>
                {t(
                  "Aucun changement enregistré depuis l’activation du journal.",
                  "No changes recorded since activity logging was enabled.",
                )}
              </p>
            )}
            {entries.map((entry) => (
              <article className="history-journal" key={entry.id}>
                <header>
                  <strong>{entry.author}</strong>
                  <small>
                    {formatDate(entry.createdAt)} · v{entry.sessionVersion}
                  </small>
                </header>
                {entry.changes.map((change, index) => (
                  <details key={`${change.id}-${index}`}>
                    <summary>
                      <span
                        className={`history-action action-${change.action}`}
                      >
                        {actionLabel(change.action)}
                      </span>
                      <span>
                        {kindLabel(change.kind)} · {change.title}
                      </span>
                    </summary>
                    {change.fields.map((field) => (
                      <div className="history-diff" key={field.field}>
                        <strong>{fieldLabel(field.field)}</strong>
                        <del>{field.before || "—"}</del>
                        <ins>{field.after || "—"}</ins>
                      </div>
                    ))}
                  </details>
                ))}
                {entry.omittedChanges > 0 && (
                  <p className="muted">
                    {t(
                      `${entry.omittedChanges} autres changements dans cet enregistrement. Consultez les versions pour le contenu complet.`,
                      `${entry.omittedChanges} more changes in this save. See versions for the full content.`,
                    )}
                  </p>
                )}
              </article>
            ))}
            {journalCursor && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void perform(() => load(true))}
              >
                {t(
                  "Charger les changements précédents",
                  "Load earlier changes",
                )}
              </button>
            )}
          </>
        ) : (
          <>
            <p className="muted">
              {t(
                "Les éléments supprimés restent restaurables pendant 72 heures. Un groupe ou un jour supprimé conserve ses blocs ensemble.",
                "Deleted items can be restored for 72 hours. A deleted group or day keeps its blocks together.",
              )}
            </p>
            {!deleted.length && (
              <p>
                {t(
                  "Aucun élément supprimé à restaurer.",
                  "No deleted items to restore.",
                )}
              </p>
            )}
            {deleted.map((item) => (
              <article className="history-deleted" key={item.id}>
                <strong>
                  {kindLabel(item.kind)} · {item.title}
                </strong>
                <small>
                  {item.location} · {item.author}
                </small>
                <small>
                  {t("Supprimé le ", "Deleted ")}
                  {formatDate(item.deletedAt)}
                </small>
                <small>
                  {t("Restaurable jusqu’au ", "Restorable until ")}
                  {formatDate(item.expiresAt)}
                </small>
                {editable && (
                  <>
                    {item.kind === "block" && (
                      <label>
                        {t("Jour de destination", "Destination day")}
                        <select
                          value={
                            trashTargets[item.id] ??
                            (session.days.some(
                              (day) => day.id === item.originalDayId,
                            )
                              ? item.originalDayId
                              : session.days[0].id)
                          }
                          onChange={(event) =>
                            setTrashTargets((previous) => ({
                              ...previous,
                              [item.id]: event.target.value,
                            }))
                          }
                        >
                          {session.days.map((day) => (
                            <option key={day.id} value={day.id}>
                              {day.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          async () => {
                            await post(
                              `/sessions/${session.id}/deleted-elements/${item.id}/restore`,
                              {
                                version: session.version,
                                targetDayId:
                                  item.kind === "block"
                                    ? (trashTargets[item.id] ??
                                      (session.days.some(
                                        (day) => day.id === item.originalDayId,
                                      )
                                        ? item.originalDayId
                                        : session.days[0].id))
                                    : undefined,
                              },
                            );
                            await reload();
                            await load();
                          },
                          t("Élément restauré.", "Item restored."),
                        )
                      }
                    >
                      <ArchiveRestore size={14} />
                      {t("Restaurer cet élément", "Restore this item")}
                    </button>
                  </>
                )}
              </article>
            ))}
            {trashCursor && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void perform(() => load(true))}
              >
                {t("Charger les éléments précédents", "Load earlier items")}
              </button>
            )}
          </>
        )}
      </div>
    </Inspector>
  );
}
export default HistoryPanel;
