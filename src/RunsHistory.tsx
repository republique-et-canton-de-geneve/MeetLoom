import { Flag, RotateCcw, Timer as TimerIcon } from "lucide-react";
import type { Session } from "../shared/model";
import type { RunRecord } from "../shared/history";
import { compareDurations } from "../shared/domain";
import { useI18n } from "./i18n";
import { actualDurationLabel, gapPhrase } from "./TimeFields";
import { durationGapLabel, durationLabel } from "./ui";

/** The steps a run reached, as the agenda counts them: a step skipped in
 * under a second was played for 0 s. */
export const playedSteps = (run: RunRecord) =>
  run.blocks.filter((block) => block.played ?? block.actual > 0);

/** What "Apply these actual durations" puts back: each played step's time. */
export const actualDurationsOf = (run: RunRecord) =>
  Object.fromEntries(playedSteps(run).map((block) => [block.id, block.actual]));

/**
 * Every finished run, newest first. The first run of each day is the initial
 * plan: it stays here whatever durations are applied afterwards, and can be
 * put back into the agenda at any time.
 */
export default function RunsHistory({
  runs,
  session,
  editable,
  apply,
}: {
  runs: RunRecord[];
  session: Session;
  editable: boolean;
  apply: (run: RunRecord, durations: "plan" | "actual") => void;
}) {
  const { t, locale } = useI18n();
  const rank = new Map<string, number>(),
    seen = new Map<string, number>();
  for (const run of runs) {
    const next = (seen.get(run.dayId) ?? 0) + 1;
    seen.set(run.dayId, next);
    rank.set(run.id, next);
  }
  const time = (iso: string, withDate: boolean) =>
    new Date(iso).toLocaleString(locale, {
      ...(withDate ? { day: "numeric", month: "short", year: "numeric" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      timeZone: session.timezone,
    });
  const running =
    session.run.status === "running" || session.run.status === "paused"
      ? session.run.dayId
      : null;
  return (
    <>
      <p className="muted">
        {t(
          "Chaque déroulé terminé est conservé avec le plan de départ et les durées réelles. Le premier déroulé d’un jour garde son plan initial, même après « Utiliser les durées réelles ».",
          "Every finished run is kept with the plan it started from and the actual durations. A day’s first run keeps its initial plan, even after “Use actual durations”.",
        )}
      </p>
      {!runs.length && (
        <p>
          {t(
            "Aucun déroulé terminé pour le moment. Lancez le minuteur puis terminez la séance pour en conserver un.",
            "No finished run yet. Start the timer and finish the session to keep one.",
          )}
        </p>
      )}
      {[...runs].reverse().map((run) => {
        const day = session.days.find((value) => value.id === run.dayId),
          first = rank.get(run.id) === 1,
          played = playedSteps(run),
          planned = run.blocks.reduce((sum, block) => sum + block.planned, 0),
          actual = played.reduce((sum, block) => sum + block.actual, 0),
          // Whole minutes rounded down, like the gaps shown in the agenda.
          gap = compareDurations(
            played.reduce((sum, block) => sum + block.planned, 0),
            actual,
          );
        return (
          <article
            className={`history-run ${first ? "is-initial" : ""}`}
            key={run.id}
          >
            <header>
              <strong>
                {day?.title ?? run.dayTitle}
                {!day && ` (${t("jour supprimé", "deleted day")})`}
              </strong>
              {first ? (
                <span className="history-run-badge">
                  <Flag size={12} />
                  {t("Plan initial", "Initial plan")}
                </span>
              ) : (
                <span className="history-run-rank">
                  {t("Déroulé", "Run")} {rank.get(run.id)}
                </span>
              )}
            </header>
            <small>
              {time(run.startedAt, true)} – {time(run.finishedAt, false)}
            </small>
            <p className="history-run-totals">
              <TimerIcon size={14} />
              {t("Prévu", "Planned")} {durationLabel(planned / 60)} ·{" "}
              {t("réel", "actual")} {durationLabel(actual / 60)}
              {played.length > 0 && (
                <span className="history-run-gap" data-gap={gap.state}>
                  {gapPhrase(t, gap.deltaMinutes)}
                </span>
              )}
            </p>
            <details>
              <summary>{t("Détail par étape", "Step by step")}</summary>
              <table className="history-run-table">
                <thead>
                  <tr>
                    <th>{t("Étape", "Step")}</th>
                    <th>{t("Prévu", "Planned")}</th>
                    <th>{t("Réel", "Actual")}</th>
                    <th>{t("Écart", "Gap")}</th>
                  </tr>
                </thead>
                <tbody>
                  {run.blocks.map((block) => (
                    <tr key={block.id}>
                      <td>{block.title}</td>
                      <td>{durationLabel(block.planned / 60)}</td>
                      <td>
                        {played.includes(block)
                          ? block.actual < 60
                            ? actualDurationLabel(block.actual)
                            : durationLabel(block.actual / 60)
                          : "—"}
                      </td>
                      <td>
                        {played.includes(block)
                          ? durationGapLabel(
                              compareDurations(block.planned, block.actual)
                                .deltaMinutes,
                            )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            {editable && day && (
              <div className="button-row">
                <button
                  className="button small secondary"
                  disabled={running === day.id}
                  title={
                    running === day.id
                      ? t(
                          "Terminez le déroulé en cours d’abord.",
                          "Finish the current run first.",
                        )
                      : undefined
                  }
                  onClick={() => apply(run, "plan")}
                >
                  <RotateCcw size={14} />
                  {first
                    ? t("Rétablir le plan initial", "Restore the initial plan")
                    : t("Rétablir ce plan", "Restore this plan")}
                </button>
                <button
                  className="button small secondary"
                  disabled={running === day.id || !played.length}
                  onClick={() => apply(run, "actual")}
                >
                  {t(
                    "Appliquer ces durées réelles",
                    "Apply these actual durations",
                  )}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </>
  );
}
