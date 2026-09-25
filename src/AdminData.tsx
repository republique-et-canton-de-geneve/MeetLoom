import { useEffect, useState, type FormEvent } from "react";
import { Download, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import type { User } from "../shared/model";
import { api, ApiError, post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";

type Schedule = {
  mode: "off" | "daily" | "twice";
  times: string[];
  keep: number;
  timezone: string;
};
type Backup = {
  id: string;
  createdAt: string;
  kind: "scheduled" | "manual" | "safety";
  label: string;
  sizeBytes: number;
  sessions: number;
  accounts: number;
  appVersion: string;
};
type Listing = {
  settings: Schedule;
  nextRun: number | null;
  scheduler: boolean;
  backups: Backup[];
};
type Action =
  | { kind: "restore"; backup: Backup }
  | { kind: "download"; backup: Backup }
  | { kind: "sessions"; backup: Backup }
  | null;

const PASSPHRASE_MIN = 12;

/** Downloads an encrypted archive; the server answers JSON only on errors. */
async function downloadArchive(path: string, body: unknown) {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error ?? "", data?.code ?? "");
  }
  const name =
    /filename="([^"]+)"/.exec(
      response.headers.get("content-disposition") ?? "",
    )?.[1] ?? "meetloom.mldx";
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const base64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Backups, restore points and moving all data between installations. */
export default function AdminData({ user }: { user: User }) {
  const { t, locale } = useI18n();
  const [listing, setListing] = useState<Listing | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [action, setAction] = useState<Action>(null);
  const [sessions, setSessions] = useState<
    { id: string; title: string; owner: string; exists: boolean }[]
  >([]);
  // Shared by the confirmation forms; cleared whenever one closes.
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseAgain, setPassphraseAgain] = useState("");
  const [confirm, setConfirm] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [transfer, setTransfer] = useState<"export" | "import" | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const load = async () => {
    const value = await api<Listing>("/admin/backups");
    setListing(value);
    setSchedule(value.settings);
  };
  useEffect(() => {
    if (!user.isAdmin) return;
    let active = true;
    api<Listing>("/admin/backups")
      .then((value) => {
        if (!active) return;
        setListing(value);
        setSchedule(value.settings);
      })
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [user.isAdmin]);
  if (!user.isAdmin) return null;

  const reset = () => {
    setAction(null);
    setTransfer(null);
    setPassword("");
    setPassphrase("");
    setPassphraseAgain("");
    setConfirm("");
    setFile(null);
    setSessions([]);
  };
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const when = (value: string | number) =>
    new Date(value).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const size = (bytes: number) =>
    bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} Ko`
      : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  const kindLabel = (backup: Backup) =>
    backup.kind === "scheduled"
      ? t("Automatique", "Scheduled")
      : backup.kind === "manual"
        ? t("Point de restauration", "Restore point")
        : t("Sécurité", "Safety");
  const replaced = (safety: string) => {
    setNotice(
      t(
        "Les données ont été remplacées. Tout le monde a été déconnecté ; reconnectez-vous avec un compte des données chargées.",
        "The data was replaced. Everyone was signed out; sign in with an account from the loaded data.",
      ) + (safety ? ` (${safety.slice(0, 8)})` : ""),
    );
    setSignedOut(true);
  };
  const confirmWord = t("REMPLACER", "REPLACE");
  const passwordField = (
    <label>
      {t("Votre mot de passe", "Your password")}
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <small className="muted">
        {t(
          "Sauf compte connecté par l’organisation (OIDC).",
          "Not needed for accounts signed in through the organization (OIDC).",
        )}
      </small>
    </label>
  );
  const passphraseFields = (
    <>
      <label>
        {t("Phrase de chiffrement", "Encryption passphrase")}
        <input
          type="password"
          autoComplete="new-password"
          minLength={PASSPHRASE_MIN}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
        />
      </label>
      <label>
        {t("Répétez la phrase", "Repeat the passphrase")}
        <input
          type="password"
          autoComplete="new-password"
          value={passphraseAgain}
          onChange={(event) => setPassphraseAgain(event.target.value)}
        />
      </label>
      <small className="muted">
        {t(
          `Au moins ${PASSPHRASE_MIN} caractères. Le fichier contient toutes les données, y compris les comptes : gardez la phrase à part, elle sera demandée à l’import. Sans elle, le fichier est illisible.`,
          `At least ${PASSPHRASE_MIN} characters. The file holds all data, accounts included: keep the passphrase separately, it is asked for on import. Without it the file cannot be read.`,
        )}
      </small>
    </>
  );
  const passphraseReady =
    passphrase.length >= PASSPHRASE_MIN && passphrase === passphraseAgain;
  const confirmField = (
    <label>
      {t(
        `Tapez ${confirmWord} pour confirmer`,
        `Type ${confirmWord} to confirm`,
      )}
      <input
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        autoComplete="off"
      />
    </label>
  );

  const saveSchedule = (event: FormEvent) => {
    event.preventDefault();
    if (!schedule) return;
    void run(async () => {
      await api("/admin/backups/settings", {
        method: "PUT",
        body: JSON.stringify(schedule),
      });
      await load();
      setNotice(t("Planification enregistrée.", "Schedule saved."));
    });
  };

  return (
    <details className="admin-accounts admin-data">
      <summary>{t("Sauvegardes et données", "Backups and data")}</summary>
      {error && <ErrorBanner message={error} />}
      {notice && <p role="status">{notice}</p>}
      {signedOut && (
        <button
          className="button primary small"
          onClick={() => location.assign("/")}
        >
          {t("Se reconnecter", "Sign in again")}
        </button>
      )}
      <p className="muted">
        {t(
          "Les sauvegardes sont gardées dans la base de l’application : elles permettent de revenir en arrière ou de récupérer une séance. Elles ne remplacent pas la sauvegarde du volume PostgreSQL par l’exploitation.",
          "Backups are kept in the application's database: they let you go back or recover a session. They do not replace the operator's backups of the PostgreSQL volume.",
        )}
      </p>

      {schedule && listing && (
        <form className="admin-data-schedule" onSubmit={saveSchedule}>
          <h4>{t("Sauvegardes automatiques", "Scheduled backups")}</h4>
          <label>
            {t("Fréquence", "Frequency")}
            <select
              value={schedule.mode}
              onChange={(event) =>
                setSchedule({
                  ...schedule,
                  mode: event.target.value as Schedule["mode"],
                  times:
                    event.target.value === "twice" && schedule.times.length < 2
                      ? [schedule.times[0] ?? "02:00", "14:00"]
                      : schedule.times,
                })
              }
            >
              <option value="off">{t("Désactivées", "Off")}</option>
              <option value="daily">
                {t("Une fois par jour", "Once a day")}
              </option>
              <option value="twice">
                {t("Deux fois par jour", "Twice a day")}
              </option>
            </select>
          </label>
          {schedule.mode !== "off" && (
            <div className="button-row">
              {(schedule.mode === "daily"
                ? schedule.times.slice(0, 1)
                : schedule.times
              ).map((time, index) => (
                <label key={index}>
                  {index
                    ? t("Deuxième heure", "Second time")
                    : t("Heure", "Time")}
                  <input
                    type="time"
                    required
                    value={time}
                    onChange={(event) =>
                      setSchedule({
                        ...schedule,
                        times: schedule.times.map((value, position) =>
                          position === index ? event.target.value : value,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <label>
                {t("Sauvegardes gardées", "Backups kept")}
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={schedule.keep}
                  onChange={(event) =>
                    setSchedule({
                      ...schedule,
                      keep: Math.max(1, Number(event.target.value) || 1),
                    })
                  }
                />
              </label>
            </div>
          )}
          <p className="muted">
            {!listing.scheduler
              ? t(
                  "Le planificateur est arrêté sur ce serveur (BACKUP_SCHEDULER=false).",
                  "The scheduler is turned off on this server (BACKUP_SCHEDULER=false).",
                )
              : listing.nextRun
                ? t(
                    `Prochaine sauvegarde : ${when(listing.nextRun)} (${schedule.timezone}).`,
                    `Next backup: ${when(listing.nextRun)} (${schedule.timezone}).`,
                  )
                : t("Aucune sauvegarde planifiée.", "No backup scheduled.")}
          </p>
          <button className="button secondary small" disabled={busy}>
            <Save size={14} />
            {t("Enregistrer la planification", "Save schedule")}
          </button>
        </form>
      )}

      <form
        className="admin-data-checkpoint"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await post("/admin/backups", { label });
            setLabel("");
            await load();
            setNotice(
              t("Point de restauration créé.", "Restore point created."),
            );
          });
        }}
      >
        <h4>{t("Point de restauration", "Restore point")}</h4>
        <div className="button-row">
          <input
            aria-label={t("Nom du point de restauration", "Restore point name")}
            placeholder={t("Ex. Avant la recette", "E.g. Before testing")}
            maxLength={120}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button className="button secondary small" disabled={busy}>
            {t("Créer maintenant", "Create now")}
          </button>
        </div>
      </form>

      {listing && (
        <ul className="admin-data-list">
          {!listing.backups.length && (
            <li className="muted">
              {t("Aucune sauvegarde pour l’instant.", "No backup yet.")}
            </li>
          )}
          {listing.backups.map((backup) => (
            <li key={backup.id}>
              <strong>
                {when(backup.createdAt)} · {kindLabel(backup)}
                {backup.label && ` · ${backup.label}`}
              </strong>
              <small>
                {t(
                  `${backup.sessions} séance(s), ${backup.accounts} compte(s), ${size(backup.sizeBytes)}, version ${backup.appVersion}`,
                  `${backup.sessions} session(s), ${backup.accounts} account(s), ${size(backup.sizeBytes)}, version ${backup.appVersion}`,
                )}
              </small>
              <div className="button-row">
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      reset();
                      const result = await api<{ sessions: typeof sessions }>(
                        `/admin/backups/${backup.id}/sessions`,
                      );
                      setSessions(result.sessions);
                      setAction({ kind: "sessions", backup });
                    })
                  }
                >
                  {t("Récupérer une séance…", "Recover a session…")}
                </button>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => {
                    reset();
                    setAction({ kind: "restore", backup });
                  }}
                >
                  <RotateCcw size={14} />
                  {t("Tout restaurer…", "Restore everything…")}
                </button>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => {
                    reset();
                    setAction({ kind: "download", backup });
                  }}
                >
                  <Download size={14} />
                  {t("Télécharger…", "Download…")}
                </button>
                <button
                  className="icon-button"
                  disabled={busy}
                  aria-label={t(
                    "Supprimer cette sauvegarde",
                    "Delete this backup",
                  )}
                  onClick={() =>
                    void run(async () => {
                      if (
                        !window.confirm(
                          t(
                            "Supprimer définitivement cette sauvegarde ?",
                            "Delete this backup for good?",
                          ),
                        )
                      )
                        return;
                      await api(`/admin/backups/${backup.id}`, {
                        method: "DELETE",
                      });
                      await load();
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {action?.backup.id === backup.id &&
                action.kind === "sessions" && (
                  <div className="admin-data-panel">
                    <p className="muted">
                      {t(
                        "La séance revient comme une copie, sans toucher au reste : ses liens visiteurs et réponses ne sont pas repris.",
                        "The session comes back as a copy, leaving everything else as is: its visitor links and responses are not brought back.",
                      )}
                    </p>
                    <ul>
                      {sessions.map((session) => (
                        <li key={session.id}>
                          <span>
                            {session.title} · {session.owner}
                            {!session.exists &&
                              t(" · supprimée depuis", " · deleted since")}
                          </span>
                          <button
                            className="button secondary small"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const result = await post<{
                                  session: { title: string };
                                }>(
                                  `/admin/backups/${backup.id}/sessions/${encodeURIComponent(session.id)}/restore`,
                                );
                                setNotice(
                                  t(
                                    `« ${result.session.title} » a été recréée chez son propriétaire.`,
                                    `“${result.session.title}” was recreated for its owner.`,
                                  ),
                                );
                              })
                            }
                          >
                            {t("Restaurer comme copie", "Restore as a copy")}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button className="button secondary small" onClick={reset}>
                      {t("Fermer", "Close")}
                    </button>
                  </div>
                )}

              {action?.backup.id === backup.id && action.kind === "restore" && (
                <form
                  className="admin-data-panel warning"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      const result = await post<{ safetyBackup: string }>(
                        `/admin/backups/${backup.id}/restore`,
                        {
                          password: password || undefined,
                          confirm: confirm.trim().toUpperCase(),
                        },
                      );
                      reset();
                      replaced(result.safetyBackup);
                    });
                  }}
                >
                  <p>
                    {t(
                      "Toutes les données actuelles seront remplacées par celles de cette sauvegarde, et tout le monde sera déconnecté. Une sauvegarde de sécurité de l’état actuel est prise juste avant.",
                      "All current data will be replaced by this backup, and everyone will be signed out. A safety backup of the current state is taken just before.",
                    )}
                  </p>
                  {passwordField}
                  {confirmField}
                  <div className="button-row">
                    <button
                      className="button secondary small danger"
                      disabled={
                        busy || confirm.trim().toUpperCase() !== confirmWord
                      }
                    >
                      {t("Tout restaurer", "Restore everything")}
                    </button>
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={reset}
                    >
                      {t("Annuler", "Cancel")}
                    </button>
                  </div>
                </form>
              )}

              {action?.backup.id === backup.id &&
                action.kind === "download" && (
                  <form
                    className="admin-data-panel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        await downloadArchive(
                          `/admin/backups/${backup.id}/download`,
                          {
                            password: password || undefined,
                            passphrase,
                          },
                        );
                        reset();
                      });
                    }}
                  >
                    {passwordField}
                    {passphraseFields}
                    <button
                      className="button secondary small"
                      disabled={busy || !passphraseReady}
                    >
                      <Download size={14} />
                      {t("Télécharger chiffré", "Download encrypted")}
                    </button>
                  </form>
                )}
            </li>
          ))}
        </ul>
      )}

      <h4>{t("Transférer toutes les données", "Move all data")}</h4>
      <p className="muted">
        {t(
          "Pour copier la production vers un environnement de test, ou changer d’installation : exportez ici, importez là-bas. L’import remplace toutes les données de l’installation qui le reçoit.",
          "To copy production to a test environment, or move to another installation: export here, import there. Importing replaces all data of the receiving installation.",
        )}
      </p>
      <div className="button-row">
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() => {
            reset();
            setTransfer("export");
          }}
        >
          <Download size={14} />
          {t("Exporter…", "Export…")}
        </button>
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() => {
            reset();
            setTransfer("import");
          }}
        >
          <Upload size={14} />
          {t("Importer…", "Import…")}
        </button>
      </div>
      {transfer === "export" && (
        <form
          className="admin-data-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await downloadArchive("/admin/data/export", {
                password: password || undefined,
                passphrase,
              });
              reset();
              setNotice(t("Export téléchargé.", "Export downloaded."));
            });
          }}
        >
          {passwordField}
          {passphraseFields}
          <button
            className="button secondary small"
            disabled={busy || !passphraseReady}
          >
            <Download size={14} />
            {t("Exporter chiffré", "Export encrypted")}
          </button>
        </form>
      )}
      {transfer === "import" && (
        <form
          className="admin-data-panel warning"
          onSubmit={(event) => {
            event.preventDefault();
            if (!file) return;
            void run(async () => {
              const result = await post<{ safetyBackup: string }>(
                "/admin/data/import",
                {
                  archive: await base64(file),
                  passphrase,
                  password: password || undefined,
                  confirm: confirm.trim().toUpperCase(),
                },
              );
              reset();
              replaced(result.safetyBackup);
            });
          }}
        >
          <p>
            {t(
              "Toutes les données de cette installation seront remplacées par celles du fichier, et tout le monde sera déconnecté. Une sauvegarde de sécurité de l’état actuel est prise juste avant.",
              "All data of this installation will be replaced by the file's, and everyone will be signed out. A safety backup of the current state is taken just before.",
            )}
          </p>
          <label>
            {t("Fichier exporté (.mldx)", "Exported file (.mldx)")}
            <input
              type="file"
              accept=".mldx,application/octet-stream"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            {t("Phrase de chiffrement", "Encryption passphrase")}
            <input
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </label>
          {passwordField}
          {confirmField}
          <button
            className="button secondary small danger"
            disabled={
              busy ||
              !file ||
              passphrase.length < PASSPHRASE_MIN ||
              confirm.trim().toUpperCase() !== confirmWord
            }
          >
            <Upload size={14} />
            {t("Importer et remplacer", "Import and replace")}
          </button>
        </form>
      )}
    </details>
  );
}
