import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  FileClock,
  Pause,
  Play,
  PictureInPicture2,
  Sparkles,
  X,
} from "lucide-react";
import type { Block, Session } from "../shared/model";
import type { MeetingInvitation } from "../shared/meeting-invitation";
import {
  quickMeetingPrompt,
  quickMeetingSession,
} from "../shared/quick-meeting";
import { transitionRun } from "../shared/domain";
import { parseMeetingFile } from "./meeting-invitation-client";
import { useI18n } from "./i18n";
import { post } from "./api";
import { TimerContent, FloatingTimer, useFloatingWindow } from "./Timer";
import "./quick-meeting.css";

const Launcher = createContext<(() => void) | null>(null);
export function QuickMeetingLauncher() {
  const launch = useContext(Launcher);
  const { t } = useI18n();
  return (
    <button className="button secondary" onClick={() => launch?.()}>
      <FileClock size={17} />
      {t("Séance rapide", "Quick meeting")}
    </button>
  );
}

export default function QuickMeeting({
  children,
  aiEnabled,
  authenticated = true,
}: {
  children: ReactNode;
  aiEnabled: boolean;
  authenticated?: boolean;
}) {
  const { t, locale } = useI18n();
  const translate = useRef(t);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [invitation, setInvitation] = useState<MeetingInvitation | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [now, setNow] = useState(Date.now);
  const [analyzing, setAnalyzing] = useState(false);
  const [proposal, setProposal] = useState<Block[] | null>(null);
  const duration = invitation
    ? (Date.parse(invitation.end) - Date.parse(invitation.start)) / 60000
    : 0;
  const analysisUnavailable = !authenticated
    ? t(
        "Connectez-vous pour analyser le déroulé avec l’IA.",
        "Sign in to analyze the agenda with AI.",
      )
    : !aiEnabled
      ? t(
          "L’analyse est disponible lorsque l’IA interne est configurée.",
          "Analysis is available when the internal AI is configured.",
        )
      : !invitation?.body.trim()
        ? t(
            "L’invitation ne contient pas de texte à analyser.",
            "The invitation has no text to analyze.",
          )
        : !Number.isInteger(duration) || duration < 5 || duration > 1440
          ? t(
              "L’analyse nécessite une durée entière de 5 à 1 440 minutes.",
              "Analysis requires a whole duration from 5 to 1,440 minutes.",
            )
          : "";
  const { floating, movable, openFloating, closeFloating, floatingNotice } =
    useFloatingWindow();

  const close = () => {
    generation.current += 1;
    busy.current = false;
    setLoading(false);
    setAnalyzing(false);
    closeFloating();
    setSession(null);
    setInvitation(null);
    setProposal(null);
    setError("");
    setVisible(false);
  };
  const load = async (file: File) => {
    if (busy.current) return;
    busy.current = true;
    const current = ++generation.current;
    setVisible(true);
    setLoading(true);
    setError("");
    setProposal(null);
    setAnalyzing(false);
    // Invoke before any file reading or worker/AI work loses user activation.
    // A browser refusal leaves the countdown visible with a one-click retry.
    void openFloating();
    try {
      const parsed = await parseMeetingFile(file);
      if (current !== generation.current) return;
      setInvitation(parsed);
      setSession(quickMeetingSession(parsed, locale));
      setNow(Date.now());
    } catch (cause) {
      if (current !== generation.current) return;
      const code = (cause as { code?: string })?.code;
      setError(
        code === "MEETING_FILE_LIMIT"
          ? t(
              "L’invitation dépasse la limite de 10 Mo.",
              "The invitation exceeds the 10 MB limit.",
            )
          : code === "MEETING_RECURRENCE_UNSUPPORTED" ||
              code === "MEETING_NO_OCCURRENCE" ||
              code === "MEETING_AMBIGUOUS_TIME"
            ? t(
                "Impossible de déterminer une occurrence et un horaire fiables. Exportez une seule occurrence de cette réunion au format .ics.",
                "A reliable occurrence and time could not be determined. Export a single occurrence of this meeting as .ics.",
              )
            : code === "MEETING_ALL_DAY"
              ? t(
                  "Une réunion sur la journée entière n’a pas d’horaire pour le décompte. Choisissez une invitation avec une heure de début et de fin.",
                  "An all-day event has no countdown schedule. Choose an invitation with start and end times.",
                )
              : t(
                  "Invitation illisible ou horaire non pris en charge. Déposez une seule occurrence de réunion au format .msg ou .ics, avec une heure de début et de fin.",
                  "Unreadable invitation or unsupported schedule. Drop one meeting occurrence as .msg or .ics, with start and end times.",
                ),
      );
      closeFloating();
    } finally {
      if (current === generation.current) {
        setLoading(false);
        busy.current = false;
      }
    }
  };
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
    translate.current = t;
  });
  useEffect(() => {
    let depth = 0;
    const files = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => {
      if (files(event)) {
        event.preventDefault();
        depth++;
        setDragging(true);
      }
    };
    const over = (event: DragEvent) => {
      if (files(event)) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }
    };
    const leave = (event: DragEvent) => {
      if (files(event) && --depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const drop = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const list = event.dataTransfer?.files;
      if (
        !list?.length ||
        list.length !== 1 ||
        !/\.(msg|ics)$/i.test(list[0].name)
      ) {
        setVisible(true);
        setError(
          translate.current(
            "Déposez une seule invitation Outlook (.msg) ou calendrier (.ics).",
            "Drop one Outlook (.msg) or calendar (.ics) invitation.",
          ),
        );
        return;
      }
      void loadRef.current(list[0]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      generation.current++;
    };
  }, []);
  const hasSession = session !== null;
  useEffect(() => {
    if (!hasSession) return;
    const owner = floating && !floating.closed ? floating : window;
    const tick = owner.setInterval(() => {
      const time = Date.now();
      setNow(time);
      setSession((value) =>
        value ? transitionRun(value, "sync", {}, time) : value,
      );
    }, 250);
    return () => owner.clearInterval(tick);
  }, [hasSession, floating]);
  const analyze = async () => {
    if (!authenticated || !aiEnabled || !invitation || analyzing) return;
    const current = generation.current;
    setAnalyzing(true);
    setError("");
    try {
      const prompt = quickMeetingPrompt(invitation, locale);
      const { blocks } = await post<{ blocks: Block[] }>("/ai/generate", {
        prompt,
        duration,
        locale,
      });
      if (current === generation.current) setProposal(blocks);
    } catch (cause) {
      if (current === generation.current)
        setError(
          (cause as Error).message === "MEETING_AI_LIMIT"
            ? t(
                "Cette invitation est trop longue pour l’analyse (8 000 caractères maximum).",
                "This invitation is too long to analyze (8,000 characters maximum).",
              )
            : (cause as Error).message,
        );
    } finally {
      if (current === generation.current) setAnalyzing(false);
    }
  };
  const content = session ? (
    <TimerContent session={session} now={now} compact />
  ) : (
    <p className="quick-meeting-loading">
      {t("Lecture de l’invitation…", "Reading invitation…")}
    </p>
  );
  return (
    <Launcher.Provider value={() => setVisible(true)}>
      {children}
      {dragging && (
        <div className="quick-meeting-drag" aria-hidden="true">
          <FileClock size={42} />
          <strong>
            {t(
              "Déposez pour lancer le décompte",
              "Drop to start the countdown",
            )}
          </strong>
          <span>
            {t(
              "Invitation Outlook .msg ou calendrier .ics · sans enregistrement",
              "Outlook .msg or calendar .ics · not saved",
            )}
          </span>
        </div>
      )}
      {visible && (
        <section
          className="quick-meeting"
          aria-label={t("Séance rapide", "Quick meeting")}
        >
          <header>
            <div>
              <span className="eyebrow">
                {t("SÉANCE RAPIDE", "QUICK MEETING")}
              </span>
              <h2>
                {session?.title ??
                  t("Un décompte, en un dépôt", "One drop, one countdown")}
              </h2>
            </div>
            <button
              className="icon-button quick-meeting-close"
              aria-label={t("Fermer la séance rapide", "Close quick meeting")}
              onClick={close}
            >
              <X />
            </button>
          </header>
          <p>
            {t(
              "Temporaire : reste dans cet onglet, disparaît à la fermeture ou au rechargement. Aucun ajout à vos séances.",
              "Temporary: stays in this tab and disappears on close or reload. Nothing is added to your sessions.",
            )}
          </p>
          {!session && (
            <label className="quick-meeting-file">
              <FileClock />
              <strong>
                {t(
                  "Déposez une invitation Outlook ici ou cliquez pour choisir",
                  "Drop an Outlook invitation here or click to choose",
                )}
              </strong>
              <span>{t(".msg / .ics · 10 Mo", ".msg / .ics · 10 MB")}</span>
              <input
                ref={input}
                type="file"
                accept=".msg,.ics"
                aria-label={t(
                  "Invitation Outlook ou calendrier",
                  "Outlook or calendar invitation",
                )}
                disabled={loading}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void load(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          )}
          {loading && (
            <p role="status">
              {t("Lecture de l’invitation…", "Reading invitation…")}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {session && (
            <>
              <p className="quick-meeting-schedule">
                {invitation?.recurrence && (
                  <>
                    {invitation.recurrence === "today"
                      ? t("Occurrence du jour", "Today's occurrence")
                      : t("Prochaine occurrence", "Next occurrence")}{" "}
                    ·{" "}
                  </>
                )}
                {t("Depuis l’heure prévue", "From scheduled time")} ·{" "}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(invitation!.start))}{" "}
                –{" "}
                {new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(
                  new Date(invitation!.end),
                )}
              </p>
              <div className="timer-bar">{content}</div>
              <div className="quick-meeting-actions">
                <button
                  className="button secondary"
                  onClick={() => void openFloating()}
                >
                  <PictureInPicture2 size={17} />
                  {t("Afficher au premier plan", "Show always on top")}
                </button>
                <button
                  className="button secondary"
                  disabled={
                    session.run.status === "finished" ||
                    now < Date.parse(invitation!.start)
                  }
                  onClick={() =>
                    setSession((value) =>
                      value
                        ? transitionRun(
                            value,
                            value.run.status === "paused" ? "resume" : "pause",
                            {},
                            Date.now(),
                          )
                        : value,
                    )
                  }
                >
                  {session.run.status === "paused" ? (
                    <Play size={17} />
                  ) : (
                    <Pause size={17} />
                  )}
                  {session.run.status === "paused"
                    ? t("Reprendre", "Resume")
                    : t("Pause", "Pause")}
                </button>
                <button
                  className="button secondary"
                  disabled={!!analysisUnavailable || analyzing || loading}
                  title={analysisUnavailable || undefined}
                  onClick={() => void analyze()}
                >
                  <Sparkles size={17} />
                  {analyzing
                    ? t("Analyse…", "Analyzing…")
                    : t(
                        "Analyser le déroulé de l’invitation",
                        "Analyze invitation agenda",
                      )}
                </button>
              </div>
              <small>
                {analysisUnavailable ||
                  (aiEnabled
                    ? t(
                        "L’analyse envoie le titre et le corps de l’invitation au modèle configuré, uniquement à votre demande. Les propositions restent temporaires.",
                        "Analysis sends the invitation title and body to the configured model only when requested. Proposals remain temporary.",
                      )
                    : t(
                        "L’analyse est disponible lorsque l’IA interne est configurée.",
                        "Analysis is available when the internal AI is configured.",
                      ))}
              </small>
              {proposal && (
                <div className="quick-meeting-proposal">
                  <h3>{t("Déroulé proposé", "Proposed agenda")}</h3>
                  <ol>
                    {proposal.map((block) => (
                      <li key={block.id}>
                        {block.title} <strong>{block.duration} min</strong>
                      </li>
                    ))}
                  </ol>
                  <p>
                    {t(
                      "Le décompte reste ancré à l’heure prévue de l’invitation.",
                      "The countdown stays anchored to the invitation’s scheduled start.",
                    )}
                  </p>
                  <button
                    className="button primary"
                    onClick={() => {
                      setSession(
                        quickMeetingSession(
                          invitation!,
                          locale,
                          Date.now(),
                          proposal,
                        ),
                      );
                      setProposal(null);
                    }}
                  >
                    {t("Appliquer le déroulé", "Apply agenda")}
                  </button>{" "}
                  <button
                    className="button quiet"
                    onClick={() => setProposal(null)}
                  >
                    {t("Ignorer", "Dismiss")}
                  </button>
                </div>
              )}
            </>
          )}
          {floatingNotice && (
            <p className="notice" role="status">
              {floatingNotice}
            </p>
          )}
        </section>
      )}
      {floating &&
        createPortal(
          session ? (
            <FloatingTimer
              win={floating}
              movable={movable}
              session={session}
              now={now}
            />
          ) : (
            content
          ),
          floating.document.body,
        )}
    </Launcher.Provider>
  );
}
