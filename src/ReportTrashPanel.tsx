import { useEffect, useMemo, useState } from "react";
import { ArchiveRestore, ArrowUpRight, Copy, Clock3 } from "lucide-react";
import type { DeliveredSession, TrashedSession } from "../shared/lifecycle";
import type { SessionResponse } from "../shared/model";
import { api, post } from "./api";
import { useI18n } from "./i18n";
import { durationLabel, ErrorBanner, Loading, Modal } from "./ui";
import "./lifecycle.css";

export default function ReportTrashPanel({
  mode,
  close,
  onChanged,
  navigate,
  workspaceId,
}: {
  mode: "report" | "trash";
  close: () => void;
  onChanged: () => void;
  navigate: (path: string) => void;
  workspaceId?: string;
}) {
  const { t, locale } = useI18n(),
    [report, setReport] = useState<DeliveredSession[] | null>(null),
    [trash, setTrash] = useState<TrashedSession[] | null>(null),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [facilitator, setFacilitator] = useState(""),
    [tag, setTag] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const load = async () => {
    if (mode === "report")
      setReport(
        (await api<{ sessions: DeliveredSession[] }>("/reports/delivered"))
          .sessions,
      );
    else
      setTrash(
        (await api<{ sessions: TrashedSession[] }>("/trash/sessions")).sessions,
      );
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [mode]);
  const scopedReport = (report ?? []).filter(
      (item) => !workspaceId || item.workspaceId === workspaceId,
    ),
    scopedTrash = (trash ?? []).filter(
      (item) => !workspaceId || item.workspaceId === workspaceId,
    );
  const people = useMemo(
    () =>
      [
        ...new Map(
          scopedReport
            .flatMap((session) => session.facilitators)
            .map((person) => [person.id, person]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    [report, workspaceId],
  );
  const tags = [...new Set(scopedReport.flatMap((item) => item.tags))].sort();
  const visible = scopedReport.filter(
    (session) =>
      (!from || session.closedAt.slice(0, 10) >= from) &&
      (!to || session.closedAt.slice(0, 10) <= to) &&
      (!facilitator ||
        session.facilitators.some((person) => person.id === facilitator)) &&
      (!tag || session.tags.includes(tag)),
  );
  const total = visible.reduce(
      (sum, session) => sum + session.plannedMinutes,
      0,
    ),
    actual = visible.reduce(
      (sum, session) => sum + (session.actualMinutes ?? 0),
      0,
    );
  const action = async (id: string, work: () => Promise<void>) => {
    setBusy(id);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <Modal
      wide
      title={
        mode === "report"
          ? t("Rapport des séances livrées", "Delivered sessions report")
          : t("Séances dans la corbeille", "Sessions in trash")
      }
      subtitle={
        mode === "report"
          ? t(
              "Les séances clôturées auxquelles vous avez accès.",
              "Closed sessions you can access.",
            )
          : t(
              "Récupération possible pendant 30 jours après suppression.",
              "Recover sessions for 30 days after deletion.",
            )
      }
      close={close}
    >
      {error && (
        <ErrorBanner
          message={error}
          retry={() => void load().catch((e) => setError(e.message))}
        />
      )}
      {mode === "report" ? (
        report === null ? (
          <Loading />
        ) : (
          <>
            <div className="report-filters">
              <label>
                {t("Clôturée à partir du", "Closed from")}
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                {t("Jusqu’au", "To")}
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <label>
                {t("Animateur", "Facilitator")}
                <select
                  value={facilitator}
                  onChange={(e) => setFacilitator(e.target.value)}
                >
                  <option value="">{t("Tous", "All")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Étiquette", "Tag")}
                <select value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">{t("Toutes", "All")}</option>
                  {tags.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="report-totals">
              <strong>
                {visible.length} {t("séances livrées", "delivered sessions")}
              </strong>
              <span>
                <Clock3 size={16} />
                {durationLabel(total)} {t("planifiées", "planned")}
              </span>
              <span>
                {durationLabel(actual)}{" "}
                {t("mesurées au minuteur", "measured by timer")}
              </span>
            </div>
            <p className="muted">
              {t(
                "Une séance sans minuteur utilisé contribue au temps planifié, pas au temps mesuré.",
                "A session without timer measurements contributes to planned time, not measured time.",
              )}
            </p>
            {!visible.length ? (
              <p className="muted">
                {t(
                  "Aucune séance clôturée pour ces filtres.",
                  "No closed session matches these filters.",
                )}
              </p>
            ) : (
              visible.map((session) => (
                <article className="report-session" key={session.id}>
                  <div>
                    <strong>{session.title}</strong>
                    <p>
                      {new Date(session.closedAt).toLocaleDateString(locale)} ·{" "}
                      {session.facilitators
                        .map((person) => person.name)
                        .join(", ")}
                    </p>
                    <span>
                      {durationLabel(session.plannedMinutes)}{" "}
                      {t("planifiées", "planned")}
                      {session.tags.length
                        ? ` · ${session.tags.join(", ")}`
                        : ""}
                    </span>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => navigate(`/session/${session.id}`)}
                  >
                    <ArrowUpRight size={15} />
                    {t("Ouvrir", "Open")}
                  </button>
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void action(session.id, async () => {
                        const value = await post<SessionResponse>(
                          `/sessions/${session.id}/duplicate`,
                        );
                        navigate(`/session/${value.session.id}`);
                      })
                    }
                  >
                    <Copy size={15} />
                    {t("Dupliquer", "Duplicate")}
                  </button>
                </article>
              ))
            )}
          </>
        )
      ) : trash === null ? (
        <Loading />
      ) : (
        <>
          {!scopedTrash.length ? (
            <p className="muted">
              {t("La corbeille est vide.", "Trash is empty.")}
            </p>
          ) : (
            scopedTrash.map((session) => (
              <article className="report-session" key={session.id}>
                <div>
                  <strong>{session.title}</strong>
                  <p>
                    {t("Supprimée le ", "Deleted on ")}
                    {new Date(session.deletedAt).toLocaleDateString(locale)}
                  </p>
                  <span>
                    {t("Récupérable jusqu’au ", "Recoverable until ")}
                    {new Date(session.expiresAt).toLocaleDateString(locale)}
                  </span>
                </div>
                {session.canRestore ? (
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void action(session.id, async () => {
                        await post(`/trash/sessions/${session.id}/restore`, {
                          version: session.version,
                        });
                        await load();
                        onChanged();
                      })
                    }
                  >
                    <ArchiveRestore size={16} />
                    {t("Restaurer", "Restore")}
                  </button>
                ) : (
                  <span className="muted">
                    {t(
                      "Restauration par le propriétaire ou un administrateur",
                      "Owner or administrator can restore",
                    )}
                  </span>
                )}
              </article>
            ))
          )}
        </>
      )}
    </Modal>
  );
}
