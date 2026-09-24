import { useEffect, useState } from "react";
import { CheckCircle2, RotateCcw, Trash2, LockKeyhole } from "lucide-react";
import type { Role, Session, User } from "../shared/model";
import type { LifecycleInfo } from "../shared/lifecycle";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner, Loading, Modal } from "./ui";
import "./lifecycle.css";

export default function LifecyclePanel({
  session,
  close,
  reload,
  onDeleted,
}: {
  session: Session;
  role?: Role;
  user?: User;
  close: () => void;
  reload: () => Promise<void>;
  onDeleted?: () => void;
}) {
  const { t, locale } = useI18n(),
    [info, setInfo] = useState<LifecycleInfo | null>(null),
    [facilitators, setFacilitators] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmTrash, setConfirmTrash] = useState(false);
  useEffect(() => {
    void api<LifecycleInfo>(`/sessions/${session.id}/lifecycle`)
      .then((value) => {
        setInfo(value);
        setFacilitators(
          new Set(
            value.facilitators.length
              ? value.facilitators.map((person) => person.id)
              : [session.ownerId],
          ),
        );
      })
      .catch((e) => setError(e.message));
  }, [session.id]);
  const transition = async (action: "close" | "reopen" | "trash") => {
    setBusy(true);
    setError("");
    try {
      await post(
        `/sessions/${session.id}/${action === "trash" ? "trash" : "lifecycle"}`,
        action === "trash"
          ? { version: session.version }
          : {
              action,
              version: session.version,
              ...(action === "close"
                ? { facilitatorIds: [...facilitators] }
                : {}),
            },
      );
      if (action === "trash") {
        onDeleted?.();
        close();
      } else {
        await reload();
        close();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t("État de la séance", "Session status")}
      subtitle={session.title}
      close={() => {
        if (!busy) close();
      }}
    >
      {error && <ErrorBanner message={error} />}
      {!info ? (
        <Loading />
      ) : (
        <div className="lifecycle-settings">
          {info.closedAt ? (
            <>
              <p className="lifecycle-closed">
                <LockKeyhole size={18} />
                {t("Clôturée le ", "Closed on ")}
                {new Date(info.closedAt).toLocaleDateString(locale)}
              </p>
              <p>
                {t(
                  "L’agenda et les commentaires sont en lecture seule. Les formulaires sont fermés. Les liens de consultation restent accessibles.",
                  "The agenda and comments are read-only. Forms are closed. Viewing links remain accessible.",
                )}
              </p>
              <p>
                <strong>{t("Animateurs : ", "Facilitators: ")}</strong>
                {info.facilitators.map((person) => person.name).join(", ")}
              </p>
              {info.canReopen && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void transition("reopen")}
                >
                  <RotateCcw size={16} />
                  {t("Rouvrir la séance", "Reopen session")}
                </button>
              )}
            </>
          ) : (
            <>
              <p>
                {t(
                  "Clôturez une séance livrée pour figer son agenda et l’inclure dans le rapport. Le propriétaire ou un administrateur pourra la rouvrir.",
                  "Close a delivered session to freeze its agenda and include it in the report. Its owner or an administrator can reopen it.",
                )}
              </p>
              <fieldset disabled={!info.canClose || busy}>
                <legend>
                  {t(
                    "Qui a animé cette séance ?",
                    "Who facilitated this session?",
                  )}
                </legend>
                {info.collaborators.map((person) => (
                  <label className="checkbox-row" key={person.id}>
                    <input
                      type="checkbox"
                      checked={facilitators.has(person.id)}
                      onChange={(e) =>
                        setFacilitators((current) => {
                          const next = new Set(current);
                          if (e.target.checked) next.add(person.id);
                          else next.delete(person.id);
                          return next;
                        })
                      }
                    />
                    {person.name}
                  </label>
                ))}
              </fieldset>
              {info.canClose && (
                <button
                  className="button primary"
                  disabled={busy || !facilitators.size}
                  onClick={() => void transition("close")}
                >
                  <CheckCircle2 size={16} />
                  {t("Clôturer la séance", "Close session")}
                </button>
              )}
            </>
          )}
          {info.canTrash && (
            <div className="lifecycle-delete">
              <h3>{t("Corbeille", "Trash")}</h3>
              <p>
                {t(
                  "La séance disparaîtra pour tous les collaborateurs et ses liens publics seront inaccessibles. Vous pourrez la restaurer pendant 30 jours, avec ses droits de partage.",
                  "The session will disappear for every collaborator and public links will be unavailable. You can restore it for 30 days with its sharing permissions.",
                )}
              </p>
              {confirmTrash ? (
                <div className="button-row">
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() => void transition("trash")}
                  >
                    {t("Confirmer la suppression", "Confirm deletion")}
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setConfirmTrash(false)}
                  >
                    {t("Annuler", "Cancel")}
                  </button>
                </div>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => setConfirmTrash(true)}
                >
                  <Trash2 size={16} />
                  {t("Mettre à la corbeille", "Move to trash")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
