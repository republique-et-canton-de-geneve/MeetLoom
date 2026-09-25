import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { User } from "../shared/model";
import { api } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";

type Activity = {
  version: string;
  revision: string | null;
  checkedAt: number;
  sessions: {
    id: string;
    title: string;
    owner: string;
    timer: {
      status: "running" | "paused" | "scheduled";
      day: string | null;
      block: string | null;
      since: number | null;
    } | null;
    editors: number;
    visitorLinks: number;
  }[];
};

/** What an administrator checks before updating the application: the
 * installed version and the sessions an update could disturb. */
export default function AdminActivity({ user }: { user: User }) {
  const { t, locale } = useI18n();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setActivity(await api<Activity>("/admin/activity"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!user.isAdmin) return;
    let active = true;
    api<Activity>("/admin/activity")
      .then((value) => active && setActivity(value))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [user.isAdmin]);
  if (!user.isAdmin) return null;
  const time = (at: number) =>
    new Date(at).toLocaleString(locale, {
      ...((activity?.checkedAt ?? at) - at > 12 * 60 * 60 * 1000
        ? { day: "2-digit", month: "2-digit" }
        : {}),
      hour: "2-digit",
      minute: "2-digit",
    });
  const count = activity?.sessions.length ?? 0;
  const describe = (session: Activity["sessions"][number]) => {
    const parts: string[] = [];
    const timer = session.timer;
    if (timer?.status === "scheduled")
      parts.push(
        t(
          `Minuteur programmé à ${time(timer.since ?? 0)}`,
          `Timer scheduled for ${time(timer.since ?? 0)}`,
        ),
      );
    else if (timer) {
      parts.push(
        timer.status === "running"
          ? t("Animée en ce moment", "Being facilitated")
          : t("Minuteur en pause", "Timer paused"),
      );
      if (timer.block)
        parts.push(timer.day ? `${timer.block} (${timer.day})` : timer.block);
      if (timer.since)
        parts.push(
          t(`depuis ${time(timer.since)}`, `since ${time(timer.since)}`),
        );
    }
    if (session.editors > 0)
      parts.push(
        t(
          `${session.editors} personne${session.editors > 1 ? "s" : ""} dans l’éditeur`,
          `${session.editors} ${session.editors > 1 ? "people" : "person"} editing`,
        ),
      );
    if (session.visitorLinks > 0)
      parts.push(
        t(
          `${session.visitorLinks} lien${session.visitorLinks > 1 ? "s" : ""} visiteur suivi${session.visitorLinks > 1 ? "s" : ""}`,
          `${session.visitorLinks} visitor link${session.visitorLinks > 1 ? "s" : ""} followed`,
        ),
      );
    return parts;
  };
  return (
    <section className="admin-accounts admin-activity account-section">
      <h2>
        {t("Activité en cours", "Current activity")}
        {activity &&
          ` · ${
            count
              ? t(
                  `${count} séance${count > 1 ? "s" : ""}`,
                  `${count} session${count > 1 ? "s" : ""}`,
                )
              : t("aucune séance", "no session")
          }`}
      </h2>
      {error && <ErrorBanner message={error} />}
      {activity && (
        <>
          <p className="muted">
            {t("Version installée : ", "Installed version: ")}
            <strong>{activity.version}</strong>
            {activity.revision && ` (${activity.revision.slice(0, 7)})`}
          </p>
          <p role="status">
            {count
              ? t(
                  "Une mise à jour remplace les serveurs un par un : personne ne perd son travail, mais les minuteurs et les pages visiteurs peuvent se figer quelques secondes. Si possible, attendez la fin de ces séances.",
                  "An update replaces servers one at a time: nobody loses work, but timers and visitor pages may freeze for a few seconds. If you can, wait until these sessions end.",
                )
              : t(
                  "Aucune séance en cours : vous pouvez mettre à jour sans déranger personne.",
                  "No session in progress: you can update without disturbing anyone.",
                )}
          </p>
          <ul className="admin-activity-list">
            {activity.sessions.map((session) => (
              <li key={session.id}>
                <strong>{session.title}</strong>
                <small>{session.owner}</small>
                <span>{describe(session).join(" · ")}</span>
              </li>
            ))}
          </ul>
          <div className="button-row">
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} />
              {t("Actualiser", "Refresh")}
            </button>
            <small className="muted">
              {t(
                `Vérifié à ${new Date(activity.checkedAt).toLocaleTimeString(locale)}`,
                `Checked at ${new Date(activity.checkedAt).toLocaleTimeString(locale)}`,
              )}
            </small>
          </div>
        </>
      )}
    </section>
  );
}
