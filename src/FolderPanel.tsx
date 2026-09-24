import { useEffect, useState } from "react";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import type { FolderListing } from "../shared/folders";
import { normalizeFolder } from "../shared/folders";
import { api } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner, Loading, Modal } from "./ui";

export default function FolderPanel({
  mode,
  source = "",
  workspaceId,
  close,
  onChanged,
}: {
  mode: "create" | "rename" | "delete";
  source?: string;
  workspaceId?: string;
  close: () => void;
  onChanged: (path: string) => void;
}) {
  const { t } = useI18n(),
    [listing, setListing] = useState<FolderListing | null>(null),
    [path, setPath] = useState(
      mode === "create" ? (source ? `${source}/` : "") : source,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reload = async () =>
    setListing(
      await api<FolderListing>(
        `/folders${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`,
      ),
    );
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [workspaceId]);
  const title =
    mode === "create"
      ? t("Créer un dossier", "Create folder")
      : mode === "rename"
        ? t("Renommer ou déplacer le dossier", "Rename or move folder")
        : t("Supprimer un dossier vide", "Delete empty folder");
  return (
    <Modal
      title={title}
      subtitle={source || undefined}
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!listing) return;
          setBusy(true);
          setError("");
          void api("/folders", {
            method:
              mode === "create"
                ? "POST"
                : mode === "rename"
                  ? "PATCH"
                  : "DELETE",
            body: JSON.stringify({
              workspaceId,
              version: listing.version,
              path: mode === "delete" ? source : path,
              ...(mode === "rename" ? { source } : {}),
            }),
          })
            .then(() =>
              onChanged(
                mode === "delete"
                  ? source.split("/").slice(0, -1).join("/")
                  : normalizeFolder(path),
              ),
            )
            .catch(async (e) => {
              setError(e.message);
              await reload().catch(() => {});
            })
            .finally(() => setBusy(false));
        }}
      >
        {!listing ? (
          <Loading />
        ) : mode === "delete" ? (
          <p>
            {t(
              "Ce dossier et ses sous-dossiers vides seront supprimés. L’opération sera refusée s’ils contiennent des séances, même archivées.",
              "This folder and its empty subfolders will be deleted. The operation is refused if they contain sessions, including archived ones.",
            )}
          </p>
        ) : (
          <label>
            {t("Chemin du dossier", "Folder path")}
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              maxLength={240}
              required
              autoFocus
              list="folder-manager-paths"
              placeholder={t("Équipe / Ateliers", "Team / Workshops")}
            />
            <small>
              {t(
                "Séparez les sous-dossiers par /. Les dossiers vides sont conservés.",
                "Separate subfolders with /. Empty folders are retained.",
              )}
            </small>
          </label>
        )}
        {mode === "rename" && (
          <p className="muted">
            {t(
              "Les sous-dossiers et le classement des séances suivront ce changement. Les agendas et leurs droits restent inchangés.",
              "Subfolders and filed sessions follow this change. Agendas and sharing permissions remain unchanged.",
            )}
          </p>
        )}
        {error && <ErrorBanner message={error} />}
        <datalist id="folder-manager-paths">
          {listing?.folders.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={close}
            disabled={busy}
          >
            {t("Annuler", "Cancel")}
          </button>
          <button
            className={`button ${mode === "delete" ? "danger" : "primary"}`}
            disabled={
              !listing?.editable ||
              busy ||
              (mode === "rename" && normalizeFolder(path) === source)
            }
          >
            {mode === "create" ? (
              <FolderPlus size={16} />
            ) : mode === "rename" ? (
              <Pencil size={16} />
            ) : (
              <Trash2 size={16} />
            )}
            {mode === "create"
              ? t("Créer", "Create")
              : mode === "rename"
                ? t("Enregistrer", "Save")
                : t("Supprimer", "Delete")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
