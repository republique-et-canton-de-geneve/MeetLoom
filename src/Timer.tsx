import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Pause,
  Play,
  SkipForward,
  SkipBack,
  Square,
  RotateCcw,
  PictureInPicture2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  Locale,
  Session,
  PublicSession,
  SoundSettings,
} from "../shared/model";
import {
  timerView,
  shouldPlayWarning,
  warningThresholdSeconds,
  plannedStartTimestamp,
  runnableBlocks,
} from "../shared/domain";
import { useI18n } from "./i18n";
import { TIMER_COLORS, timerVisualState } from "../shared/timer-visual";

let audioContext: AudioContext | null = null;
async function enableAudio() {
  if (!audioContext || audioContext.state === "closed")
    audioContext = new AudioContext();
  await audioContext.resume();
  return audioContext;
}
export async function chime(settings: SoundSettings, end = false) {
  try {
    const context = await enableAudio();
    const now = context.currentTime;
    const frequencies =
      settings.sound === "digital"
        ? [880, 660]
        : settings.sound === "soft"
          ? [440, 554]
          : [659, 880];
    frequencies.slice(0, end ? 2 : 1).forEach((frequency, i) => {
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + i * 0.22);
      gain.gain.linearRampToValueAtTime(
        settings.volume * 0.28,
        now + i * 0.22 + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.65);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + i * 0.22);
      oscillator.stop(now + i * 0.22 + 0.7);
    });
  } catch {
    /* A browser can suspend audio until the next user gesture. */
  }
}

export interface AudioFrame {
  sessionId: string;
  runStart: number | null;
  blockId: string | null;
  remaining: number;
  elapsed: number;
  duration: number;
  deadline: number | null;
  status: Session["run"]["status"];
  revision: number;
  warned: boolean;
  ended: boolean;
}
/** Track the current execution, rather than a permanent block-ID set. A return
 * to a previous block gets fresh alerts; pause/resume keeps the same alerts. */
export function timerAudioStep(
  previous: AudioFrame | null,
  session: Session,
  now: number,
  audible: boolean,
): { frame: AudioFrame; warning: boolean; end: boolean } {
  const view = timerView(session, now),
    run = session.run;
  const duration = (view.block?.duration ?? 0) * 60;
  const sameBlock =
    !!previous &&
    previous.sessionId === session.id &&
    previous.runStart === run.runStartedAt &&
    previous.blockId === run.blockId;
  const replayed =
    sameBlock &&
    (run.status === "running" || run.status === "paused") &&
    previous.revision !== run.revision &&
    run.elapsedBeforePause === 0 &&
    view.elapsedSeconds + 0.01 < previous.elapsed;
  const sameExecution = sameBlock && !replayed;
  const threshold = warningThresholdSeconds(session.sound, duration);
  const frame: AudioFrame = {
    sessionId: session.id,
    runStart: run.runStartedAt,
    blockId: run.blockId,
    remaining: view.remainingSeconds,
    elapsed: view.elapsedSeconds,
    duration,
    deadline:
      run.status === "running" && run.startedAt !== null
        ? run.startedAt + (duration - run.elapsedBeforePause) * 1000
        : null,
    status: run.status,
    revision: run.revision,
    // Added time (an extension, or an edited block resumed later) re-arms an
    // alert once the remaining time is back above its trigger point.
    warned: sameExecution
      ? previous.warned &&
        !(threshold !== null && view.remainingSeconds > threshold)
      : threshold !== null && view.remainingSeconds <= threshold,
    ended: sameExecution
      ? previous.ended && view.remainingSeconds <= 0
      : view.remainingSeconds <= 0,
  };
  let warning = false,
    end = false;
  if (sameExecution && previous && run.status === "running") {
    warning = shouldPlayWarning(
      session.sound,
      duration,
      previous.remaining,
      view.remainingSeconds,
      previous.warned,
    );
    end =
      session.sound.atEnd &&
      !previous.ended &&
      previous.remaining > 0 &&
      view.remainingSeconds <= 0;
    frame.warned ||= warning;
    frame.ended ||= end;
  } else if (
    previous &&
    !sameExecution &&
    previous.sessionId === session.id &&
    previous.runStart === run.runStartedAt &&
    run.status !== "idle" &&
    previous.status === "running" &&
    !previous.ended &&
    previous.deadline !== null &&
    now >= previous.deadline
  ) {
    // The server can advance between two UI ticks. Account for the old deadline
    // before replacing it, including an automatic transition to finished.
    end = session.sound.atEnd;
  }
  const enabled = audible && session.sound.enabled;
  return { frame, warning: enabled && warning, end: enabled && end };
}
/** Why "from scheduled time" cannot be chosen, or null when it can. */
export function plannedStartUnavailableReason(
  plannedStart: number | null,
  now: number,
  locale: Locale = "fr",
): string | null {
  const t = (fr: string, en: string) => (locale === "fr" ? fr : en);
  if (plannedStart === null)
    return t(
      "vérifiez la date et l’heure de début",
      "check the start date and time",
    );
  if (Math.abs(now - plannedStart) > 100_000_000_000)
    return t("heure prévue trop éloignée", "scheduled time is too far away");
  return null;
}

/** Explains that a scheduled start still ahead begins with a countdown. */
export function plannedStartCountdownLabel(
  plannedStart: number,
  now: number,
  timezone: string,
  locale: Locale,
): string {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", {
      timeZone: timezone,
      ...options,
    });
  const day = format({ year: "numeric", month: "2-digit", day: "2-digit" });
  const when = format({
    hour: "2-digit",
    minute: "2-digit",
    ...(day.format(plannedStart) === day.format(now)
      ? {}
      : { day: "numeric", month: "short" }),
  }).format(plannedStart);
  return locale === "fr"
    ? `décompte jusqu’à ${when}`
    : `countdown until ${when}`;
}
export function clock(seconds: number) {
  const n = Math.abs(Math.ceil(seconds));
  const pad = (value: number) => String(value).padStart(2, "0");
  // Past an hour (a long countdown or block), read h:mm:ss, not 577:38.
  const body =
    n >= 3600
      ? `${Math.floor(n / 3600)}:${pad(Math.floor(n / 60) % 60)}:${pad(n % 60)}`
      : `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
  return `${seconds < 0 ? "+" : ""}${body}`;
}

export function TimerContent({
  session,
  now,
  compact = false,
}: {
  session: Session | PublicSession;
  now: number;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const day = session.days.find((d) => d.id === session.run.dayId);
  const playable = runnableBlocks(day?.blocks ?? []);
  const view = timerView(session, now);
  const block = view.block,
    remaining = view.remainingSeconds;
  const progress = view.progress * 100;
  const delta = view.deltaSeconds;
  const waiting = view.startsInSeconds > 0;
  const isOver = remaining < 0;
  const visual = timerVisualState(remaining, (block?.duration ?? 0) * 60);
  return (
    <div
      className={`timer-content ${compact ? "compact" : ""} ${isOver ? "overtime" : ""} ${waiting ? "waiting" : ""}`}
    >
      <div className="timer-current">
        <span className="timer-kicker">
          <span
            className={
              session.run.status === "running" ? "live-dot" : "paused-dot"
            }
          />
          {waiting
            ? t("DÉBUT DANS", "STARTS IN")
            : session.run.status === "paused"
              ? t("EN PAUSE", "PAUSED")
              : session.run.status === "finished"
                ? t("SÉANCE TERMINÉE", "SESSION COMPLETE")
                : t("EN CE MOMENT", "RIGHT NOW")}
        </span>
        <strong>{block?.title ?? session.title}</strong>
        <span className="timer-position">
          {day
            ? `${Math.max(1, playable.findIndex((b) => b.id === block?.id) + 1)} / ${playable.length} · ${day.title}`
            : ""}
        </span>
      </div>
      <div className="timer-clock">
        <strong>
          {session.run.status === "finished"
            ? "✓"
            : clock(waiting ? view.startsInSeconds : remaining)}
        </strong>
        <span>
          {waiting
            ? t(
                `avant le début · ${clock(remaining)} prévues`,
                `until start · ${clock(remaining)} planned`,
              )
            : isOver
              ? t("de dépassement", "over time")
              : t("restantes", "remaining")}
        </span>
      </div>
      <div className="timer-track">
        <span
          className={`timer-${visual}`}
          style={{ width: `${progress}%`, background: TIMER_COLORS[visual] }}
        />
      </div>
      <span className="timer-delta">
        {Math.abs(delta) < 30
          ? t("Dans le temps prévu", "Right on schedule")
          : delta > 0
            ? t(
                `${Math.ceil(delta / 60)} min de retard`,
                `${Math.ceil(delta / 60)} min behind`,
              )
            : t(
                `${Math.ceil(-delta / 60)} min d’avance`,
                `${Math.ceil(-delta / 60)} min ahead`,
              )}
      </span>
    </div>
  );
}

/** The always-on-top progress window (Document Picture-in-Picture, or a
 * popup where unavailable), shared by facilitators and visitors. */
export function useFloatingWindow() {
  const { t } = useI18n();
  const [floating, setFloating] = useState<Window | null>(null);
  const [floatingNotice, setNotice] = useState("");
  useEffect(
    () => () => {
      floating?.close();
    },
    [floating],
  );
  const openFloating = async () => {
    setNotice("");
    if (floating && !floating.closed) {
      floating.focus();
      return;
    }
    try {
      const pip = (
        window as unknown as {
          documentPictureInPicture?: {
            requestWindow: (options: {
              width: number;
              height: number;
            }) => Promise<Window>;
          };
        }
      ).documentPictureInPicture;
      const win = pip
        ? await pip.requestWindow({ width: 560, height: 188 })
        : window.open("", "meetloom-progress", "popup,width=560,height=230");
      if (!win) {
        setNotice(
          t(
            "Autorisez les fenêtres contextuelles pour ouvrir la progression.",
            "Allow pop-up windows to open the progress view.",
          ),
        );
        return;
      }
      win.document.title = "MeetLoom · " + t("Progression", "Progress");
      document
        .querySelectorAll('style, link[rel="stylesheet"]')
        .forEach((node) => win.document.head.appendChild(node.cloneNode(true)));
      win.document.body.className = "floating-window";
      win.addEventListener("pagehide", () => setFloating(null), { once: true });
      setFloating(win);
      if (!pip)
        setNotice(
          t(
            "Fenêtre séparée ouverte. Ce navigateur ne permet pas de la maintenir au premier plan.",
            "Separate window opened. This browser cannot keep it always on top.",
          ),
        );
    } catch {
      setNotice(
        t(
          "La fenêtre flottante n’est pas disponible. Réessayez dans Chrome ou Edge sur un ordinateur.",
          "The floating window is unavailable. Try Chrome or Edge on a desktop.",
        ),
      );
    }
  };
  return { floating, openFloating, floatingNotice };
}

export default function Timer({
  session,
  dayId,
  canRun,
  action,
}: {
  session: Session;
  dayId: string;
  canRun: boolean;
  action: (action: string, input?: Record<string, unknown>) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(false);
  const [startMode, setStartMode] = useState<"now" | "planned">("now");
  const { floating, openFloating, floatingNotice } = useFloatingWindow();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const previous = useRef<AudioFrame | null>(null);
  useEffect(() => {
    const owner = floating && !floating.closed ? floating : window;
    const timer = owner.setInterval(() => setNow(Date.now()), 250);
    return () => owner.clearInterval(timer);
  }, [floating]);
  const run = session.run;
  const previousAutomaticBlock =
    run.autoAdvance && run.lastAutoAdvance
      ? runnableBlocks(
          session.days.find((day) => day.id === run.dayId)?.blocks ?? [],
        ).find((block) => block.id === run.lastAutoAdvance!.blockId)
      : undefined;
  const running = run.status !== "idle";
  const selectedBlocks =
    session.days.find((day) => day.id === dayId)?.blocks ?? [];
  const plannedStart = useMemo(() => {
    try {
      return plannedStartTimestamp(session, dayId);
    } catch {
      return null; /* Invalid local drafts stay editable. */
    }
  }, [session.days, session.timezone, dayId]);
  const plannedUnavailable = runnableBlocks(selectedBlocks).length
    ? plannedStartUnavailableReason(plannedStart, now, locale)
    : t("ajoutez d’abord un bloc", "add a block first");
  const plannedLabel =
    plannedStart !== null && plannedStart > now
      ? plannedStartCountdownLabel(plannedStart, now, session.timezone, locale)
      : null;
  const canStartPlanned = plannedUnavailable === null;
  useEffect(() => {
    const result = timerAudioStep(previous.current, session, Date.now(), sound);
    previous.current = result.frame;
    if (result.end) void chime(session.sound, true);
    else if (result.warning) void chime(session.sound);
  }, [now, session, sound, run]);
  const runAction = async (name: string, input?: Record<string, unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action(name, input);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  if (!running)
    return (
      <div className="timer-start-row">
        {canRun && (
          <>
            <select
              aria-label={t("Début du minuteur", "Timer start")}
              title={t(
                "« Depuis l’heure prévue » cale le minuteur sur l’heure de début de la journée : décompte jusqu’à cette heure si elle n’est pas encore atteinte, rattrapage du temps écoulé sinon.",
                "“From scheduled time” aligns the timer with the day's start time: it counts down until that time if it is still ahead, or catches up the elapsed time otherwise.",
              )}
              value={startMode}
              onChange={(event) =>
                setStartMode(event.target.value as "now" | "planned")
              }
              disabled={busy}
            >
              <option value="now">
                {t("Commencer maintenant", "Start now")}
              </option>
              <option value="planned" disabled={!canStartPlanned}>
                {t("Depuis l’heure prévue", "From scheduled time")}
                {plannedUnavailable
                  ? ` (${plannedUnavailable})`
                  : plannedLabel && ` (${plannedLabel})`}
              </option>
            </select>
            <button
              className="button primary"
              disabled={
                busy ||
                !runnableBlocks(selectedBlocks).length ||
                (startMode === "planned" && !canStartPlanned)
              }
              onClick={() => {
                void enableAudio().catch(() => undefined);
                setSound(true);
                void runAction("start", { dayId, startMode });
              }}
            >
              <Play size={17} />
              {t("Animer la séance", "Run session")}
            </button>
          </>
        )}
      </div>
    );
  return (
    <div className="timer-wrapper">
      <div className="timer-bar">
        <TimerContent session={session} now={now} />
        <div className="timer-controls">
          {canRun && (
            <>
              <button
                className="timer-control"
                title={
                  run.status === "running"
                    ? t("Pause", "Pause")
                    : t("Reprendre", "Resume")
                }
                disabled={busy || run.status === "finished"}
                onClick={() =>
                  void runAction(run.status === "running" ? "pause" : "resume")
                }
              >
                {run.status === "running" ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} />
                )}
              </button>
              <button
                className="timer-control"
                onClick={() => void runAction("previous")}
                disabled={
                  busy ||
                  run.status === "finished" ||
                  runnableBlocks(
                    session.days.find((day) => day.id === run.dayId)?.blocks ??
                      [],
                  ).findIndex((block) => block.id === run.blockId) <= 0
                }
                title={t(
                  "Bloc précédent : il reprend là où il en était",
                  "Previous block: it resumes where it was left",
                )}
              >
                <SkipBack size={18} />
              </button>
              <button
                className="timer-control"
                onClick={() => void runAction("next")}
                disabled={busy || run.status === "finished"}
                title={t("Bloc suivant", "Next block")}
              >
                <SkipForward size={18} />
              </button>
              <button
                className="timer-control"
                onClick={() => void runAction("extend", { seconds: 60 })}
                disabled={busy || run.status === "finished"}
                title={t(
                  "Ajouter une minute au bloc",
                  "Add one minute to this block",
                )}
              >
                +1
              </button>
              <button
                className="timer-control"
                onClick={() => void runAction("extend", { seconds: 300 })}
                disabled={busy || run.status === "finished"}
                title={t(
                  "Ajouter cinq minutes au bloc",
                  "Add five minutes to this block",
                )}
              >
                +5
              </button>
              <button
                className="timer-control"
                onClick={() => void runAction("stop")}
                disabled={busy || run.status === "finished"}
                title={t("Terminer l’animation", "Finish facilitation")}
              >
                <Square size={15} />
              </button>
              <button
                className="timer-control"
                onClick={() => void runAction("reset")}
                disabled={busy}
                title={t("Réinitialiser", "Reset")}
              >
                <RotateCcw size={16} />
              </button>
            </>
          )}
          <button
            className="timer-control"
            disabled={!session.sound.enabled}
            onClick={() => {
              setSound(!sound);
              if (!sound) void enableAudio().catch(() => undefined);
            }}
            title={
              !session.sound.enabled
                ? t(
                    "Alertes désactivées dans les réglages de la séance",
                    "Alerts are disabled in session settings",
                  )
                : sound
                  ? t("Couper le son sur cet appareil", "Mute this device")
                  : t(
                      "Activer le son sur cet appareil",
                      "Enable sound on this device",
                    )
            }
          >
            {sound && session.sound.enabled ? (
              <Volume2 size={18} />
            ) : (
              <VolumeX size={18} />
            )}
          </button>
          <button
            className="timer-control"
            onClick={openFloating}
            title={t("Fenêtre au premier plan", "Always-on-top window")}
          >
            <PictureInPicture2 size={19} />
          </button>
        </div>
      </div>
      {canRun && run.status !== "finished" && (
        <label className="autoadvance">
          <input
            type="checkbox"
            checked={run.autoAdvance}
            disabled={busy}
            onChange={(e) =>
              void runAction("configure", { autoAdvance: e.target.checked })
            }
          />
          {t(
            "Passer automatiquement au bloc suivant",
            "Automatically advance to the next block",
          )}
        </label>
      )}
      {canRun && run.status === "finished" && (
        <div className="timer-start-row">
          <span>
            {t(
              "Durées actuelles conservées. Vous pouvez aussi :",
              "Current durations kept. You can also:",
            )}
          </span>
          <button
            className="button small"
            disabled={busy || !run.plannedDurations}
            onClick={() => void runAction("restore-plan")}
          >
            {t("Restaurer le plan initial", "Restore original plan")}
          </button>
          <button
            className="button small"
            disabled={busy || !Object.keys(run.actualDurations ?? {}).length}
            onClick={() => void runAction("apply-actual")}
          >
            {t("Utiliser les durées réelles", "Use actual durations")}
          </button>
        </div>
      )}
      {canRun && previousAutomaticBlock && (
        <div className="timer-recovery">
          <span>
            {t("Passage automatique depuis", "Auto-advanced from")}{" "}
            <strong>{previousAutomaticBlock.title}</strong>
          </span>
          <button
            className="button small secondary"
            disabled={busy}
            onClick={() =>
              void runAction("extend", {
                blockId: previousAutomaticBlock.id,
                seconds: 60,
              })
            }
          >
            {t("+1 min au précédent", "+1 min to previous")}
          </button>
          <button
            className="button small secondary"
            disabled={busy}
            onClick={() =>
              void runAction("extend", {
                blockId: previousAutomaticBlock.id,
                seconds: 300,
              })
            }
          >
            {t("+5 min au précédent", "+5 min to previous")}
          </button>
          <small>
            {t(
              "Le minuteur revient au bloc si sa nouvelle durée n’est pas écoulée.",
              "The timer returns to this block if its new duration has not elapsed.",
            )}
          </small>
        </div>
      )}
      {(notice || floatingNotice) && (
        <p className="notice">{notice || floatingNotice}</p>
      )}
      {floating &&
        createPortal(
          <TimerContent session={session} now={now} compact />,
          floating.document.body,
        )}
    </div>
  );
}
