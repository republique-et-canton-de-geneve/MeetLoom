import { Fragment, useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  Clock3,
  Download,
  Eye,
  Maximize2,
  PictureInPicture2,
  Printer,
  WifiOff,
} from "lucide-react";
import type { PublicSession } from "../shared/model";
import {
  allBlocks,
  blockDuration,
  formatTime,
  publicProjection,
  scheduleTreeDay,
} from "../shared/domain";
import { useI18n } from "./i18n";
import {
  Brand,
  LanguageSwitch,
  ErrorBanner,
  Loading,
  durationLabel,
} from "./ui";
import { TimerContent, useFloatingWindow } from "./Timer";
import { createPortal } from "react-dom";
import { columnValue, exportSessionCsv } from "./export";
import { download } from "./api";
import { RichText } from "./RichText";
import PublicDiscussion from "./PublicDiscussion";
import { PageView } from "./PageEditor";
import PublicForm from "./PublicForm";
import type { SharedNavigation } from "../shared/sharing";
import "./public.css";
import "./richtext.css";

type LoadError = "unavailable" | "network" | "fullscreen" | null;

export default function PublicAgenda({ token }: { token: string }) {
  const { locale, t } = useI18n();
  const [session, setSession] = useState<PublicSession | null>(null);
  const [selectedDay, setSelectedDay] = useState("");
  const [selectedPage, setSelectedPage] = useState("");
  const [selectedForm, setSelectedForm] = useState("");
  const [sharing, setSharing] = useState<{
    mode: "visitor" | "agenda";
    allowComments: boolean;
    readOnly?: boolean;
    initialDayId?: string | null;
    initialContentId?: string | null;
    navigation?: SharedNavigation[];
  }>({ mode: "visitor", allowComments: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError>(null);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now());
  const retry = useCallback(() => setReload((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let next: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    setSession(null);
    setLoading(true);
    setError(null);
    setSelectedDay("");
    setSelectedPage("");
    setSelectedForm("");
    let firstLoad = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/public/${encodeURIComponent(token)}`,
          {
            credentials: "omit",
            cache: "no-store",
            signal: abort.signal,
            headers: { Accept: "application/json" },
          },
        );
        if (!active) return;
        if ([401, 403, 404, 410].includes(response.status)) {
          // A revoked or expired link must clear already-rendered content too.
          setSession(null);
          setError("unavailable");
          setLoading(false);
          return;
        }
        if (!response.ok) throw new Error("Could not fetch public agenda");
        const data = (await response.json()) as {
          session: PublicSession;
          sharing: typeof sharing;
        };
        if (!active) return;
        const safeSession = publicProjection(data.session);
        setSession(safeSession);
        setSharing(data.sharing ?? { mode: "visitor", allowComments: false });
        setSelectedPage((current) =>
          safeSession.pages?.some((page) => page.id === current) ? current : "",
        );
        setSelectedForm((current) =>
          data.sharing?.navigation?.some(
            (item) => item.kind === "form" && item.id === current,
          )
            ? current
            : "",
        );
        setError(null);
        setSelectedDay((current) =>
          safeSession.days.some((day) => day.id === current)
            ? current
            : (safeSession.days.find(
                (day) => day.id === data.sharing?.initialDayId,
              )?.id ??
              safeSession.days[0]?.id ??
              ""),
        );
        if (firstLoad) {
          firstLoad = false;
          const entry =
            data.sharing?.navigation?.find(
              (item) => item.id === data.sharing.initialContentId,
            ) ??
            data.sharing?.navigation?.find(
              (item) => item.id === data.sharing.initialDayId,
            ) ??
            data.sharing?.navigation?.[0];
          if (entry?.kind === "page") setSelectedPage(entry.id);
          if (entry?.kind === "form") setSelectedForm(entry.id);
          if (entry?.kind === "day") setSelectedDay(entry.id);
        }
      } catch {
        if (active) setError("network");
      } finally {
        if (active) {
          setLoading(false);
          next = setTimeout(refresh, 3000);
        }
      }
    };
    void refresh();
    return () => {
      active = false;
      abort.abort();
      clearTimeout(next);
    };
  }, [token, reload]);

  const { floating, openFloating, floatingNotice } = useFloatingWindow();
  useEffect(() => {
    // The always-on-top window keeps ticking while this tab is hidden.
    const owner = floating && !floating.closed ? floating : window;
    const interval = owner.setInterval(() => setNow(Date.now()), 500);
    return () => owner.clearInterval(interval);
  }, [floating]);

  const day =
    session?.days.find((candidate) => candidate.id === selectedDay) ??
    session?.days[0];
  const schedule = day ? scheduleTreeDay(day) : [];
  const columns =
    session?.columns.filter((column) => column.visibility === "public") ?? [];
  const dayDuration =
    day?.blocks.reduce((sum, block) => sum + blockDuration(block), 0) ?? 0;
  const message =
    error === "unavailable"
      ? t(
          "Ce lien n’est plus disponible. Il a peut-être expiré ou été désactivé par l’organisateur.",
          "This link is no longer available. It may have expired or been disabled by the organizer.",
        )
      : error === "fullscreen"
        ? t(
            "Le mode plein écran n’est pas disponible dans ce navigateur.",
            "Fullscreen is not available in this browser.",
          )
        : session
          ? t(
              "La connexion est interrompue. L’agenda affiché peut ne plus être à jour.",
              "The connection was interrupted. The displayed agenda may be out of date.",
            )
          : t(
              "Impossible de charger cet agenda. Vérifiez votre connexion puis réessayez.",
              "Could not load this agenda. Check your connection and try again.",
            );

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("fullscreen");
    }
  };
  const dateLabel = day?.date
    ? new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-GB", {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(new Date(`${day.date}T12:00:00Z`))
    : "";
  const navigation = sharing.navigation ?? [
    ...(session?.days ?? []).map((day) => ({
      kind: "day" as const,
      id: day.id,
      title: day.title,
    })),
    ...(session?.pages ?? []).map((page) => ({
      kind: "page" as const,
      id: page.id,
      title: page.title,
    })),
  ];

  return (
    <main className="public-page">
      <header className="public-header">
        <Brand />
        <div className="public-header-right">
          <span className="public-readonly">
            <Eye size={15} />
            {t("Agenda partagé", "Shared agenda")}
          </span>
          <LanguageSwitch />
        </div>
      </header>
      <div className="public-body">
        {loading && <Loading />}
        {error && <ErrorBanner message={message} retry={retry} />}
        {session && (
          <>
            <section className="public-intro">
              <div>
                <p className="public-eyebrow">
                  {t("Notre temps, ensemble", "Our time, together")}
                </p>
                <h1>{session.title}</h1>
                {session.description && (
                  <RichText
                    className="public-description"
                    value={session.description}
                  />
                )}
              </div>
              <div className="public-actions">
                <button
                  className="button secondary"
                  onClick={() => window.print()}
                >
                  <Printer size={16} />
                  {t("Imprimer", "Print")}
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    download(
                      "agenda.csv",
                      exportSessionCsv(session, locale),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  <Download size={16} />
                  CSV
                </button>
                <button
                  className="icon-button"
                  onClick={() => void fullscreen()}
                  title={t("Plein écran", "Fullscreen")}
                  aria-label={t("Plein écran", "Fullscreen")}
                >
                  <Maximize2 size={18} />
                </button>
              </div>
            </section>
            {session.run.status !== "idle" && (
              <section
                className="public-live"
                aria-label={t("Déroulement en direct", "Live session progress")}
              >
                <TimerContent session={session} now={now} />
                <button
                  className="public-floating-button"
                  onClick={() => void openFloating()}
                  title={t("Fenêtre au premier plan", "Always-on-top window")}
                  aria-label={t(
                    "Fenêtre au premier plan",
                    "Always-on-top window",
                  )}
                >
                  <PictureInPicture2 size={18} />
                </button>
                {floatingNotice && <p className="notice">{floatingNotice}</p>}
                {floating &&
                  createPortal(
                    <TimerContent session={session} now={now} compact />,
                    floating.document.body,
                  )}
              </section>
            )}
            {navigation.length > 1 && (
              <nav
                className="public-days"
                aria-label={t("Jours de la séance", "Session days")}
              >
                {navigation.map((value) => (
                  <button
                    key={value.id}
                    aria-current={
                      (
                        value.kind === "page"
                          ? selectedPage === value.id
                          : value.kind === "form"
                            ? selectedForm === value.id
                            : !selectedPage &&
                              !selectedForm &&
                              value.id === day?.id
                      )
                        ? "page"
                        : undefined
                    }
                    className={
                      (
                        value.kind === "page"
                          ? selectedPage === value.id
                          : value.kind === "form"
                            ? selectedForm === value.id
                            : !selectedPage &&
                              !selectedForm &&
                              value.id === day?.id
                      )
                        ? "active"
                        : ""
                    }
                    onClick={() => {
                      if (value.kind === "day") setSelectedDay(value.id);
                      setSelectedPage(value.kind === "page" ? value.id : "");
                      setSelectedForm(value.kind === "form" ? value.id : "");
                    }}
                  >
                    {value.title}
                  </button>
                ))}
              </nav>
            )}
            {selectedForm ? (
              <PublicForm
                token={token}
                endpoint={`/public/${encodeURIComponent(token)}/forms/${encodeURIComponent(selectedForm)}`}
                embedded
              />
            ) : selectedPage &&
              session.pages?.some((page) => page.id === selectedPage) ? (
              <PageView
                page={session.pages.find((page) => page.id === selectedPage)!}
              />
            ) : (
              <section
                className="public-agenda"
                aria-label={t("Programme de la séance", "Session agenda")}
              >
                <div className="public-day-heading">
                  <h2>{day?.title}</h2>
                  <div>
                    <span>
                      <CalendarDays size={15} />
                      {dateLabel}
                    </span>
                    <span>
                      <Clock3 size={15} />
                      {durationLabel(dayDuration)}
                    </span>
                    <span>
                      {day
                        ? allBlocks(day.blocks).filter(
                            (block) => !block.kind || block.kind === "activity",
                          ).length
                        : 0}{" "}
                      {t("activités", "activities")}
                    </span>
                  </div>
                </div>
                {schedule.length === 0 ? (
                  <p className="public-empty">
                    {t(
                      "Le programme sera bientôt disponible.",
                      "The program will be available soon.",
                    )}
                  </p>
                ) : (
                  <div className="public-table-wrap">
                    <table className="public-table">
                      <thead>
                        <tr>
                          <th scope="col">{t("Horaire", "Time")}</th>
                          <th scope="col">{t("Activité", "Activity")}</th>
                          {columns.map((column) => (
                            <th scope="col" key={column.id}>
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {schedule.map((item, index) => (
                          <Fragment key={item.block.id}>
                            {item.block.section &&
                              item.block.section !==
                                schedule[index - 1]?.block.section && (
                                <tr className="public-section">
                                  <th
                                    scope="rowgroup"
                                    colSpan={2 + columns.length}
                                  >
                                    {item.block.section}
                                  </th>
                                </tr>
                              )}
                            <tr
                              className={`public-block block-kind-${item.block.kind ?? "activity"} category-${item.block.category} ${session.run.blockId === item.block.id && session.run.status !== "idle" && session.run.status !== "finished" ? "is-current" : ""}`}
                            >
                              <td
                                className="public-time"
                                style={{
                                  borderLeftColor: session.categories?.find(
                                    (category) =>
                                      category.id === item.block.category,
                                  )?.color,
                                }}
                              >
                                <strong>{formatTime(item.startMinute)}</strong>
                                <span>
                                  {durationLabel(blockDuration(item.block))}
                                </span>
                              </td>
                              <th
                                className="public-block-title"
                                scope="row"
                                style={{
                                  paddingInlineStart: `${16 + item.depth * 16}px`,
                                }}
                              >
                                {item.roomPath.length > 0 && (
                                  <small className="public-room-label">
                                    {item.roomPath.join(" / ")}
                                  </small>
                                )}
                                <span>{item.block.title}</span>
                                {session.run.blockId === item.block.id &&
                                  session.run.status === "running" && (
                                    <small className="public-current-label">
                                      <span className="live-dot" />
                                      {t("En cours", "In progress")}
                                    </small>
                                  )}
                              </th>
                              {columns.map((column) => (
                                <td
                                  key={column.id}
                                  data-label={column.label}
                                  className={`public-field ${columnValue(item.block, column.id) ? "" : "is-empty"}`}
                                >
                                  {columnValue(item.block, column.id) ? (
                                    <RichText
                                      value={columnValue(item.block, column.id)}
                                    />
                                  ) : (
                                    <span className="public-empty-value">
                                      —
                                    </span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {schedule.length > 0 && (
                  <div className="public-end">
                    <span>
                      {formatTime(
                        Math.max(...schedule.map((item) => item.endMinute)),
                      )}
                    </span>
                    {t("Fin de la séance", "Session ends")}
                  </div>
                )}
              </section>
            )}
            {sharing.allowComments && sharing.mode === "visitor" && (
              <PublicDiscussion
                session={session}
                token={token}
                readOnly={sharing.readOnly}
              />
            )}
            <footer className="public-footer">
              <span>
                {error === "network" ? (
                  <>
                    <WifiOff size={14} />
                    {t("Connexion interrompue", "Connection interrupted")}
                  </>
                ) : (
                  <>
                    <span className="public-sync-dot" />
                    {t("Mis à jour automatiquement", "Updates automatically")}
                  </>
                )}
              </span>
              <span>
                {t("Horaires dans le fuseau", "Times in")} {session.timezone}
              </span>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
