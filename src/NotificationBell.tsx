import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import type { TeamNotification } from "../shared/comments";
import { api, post } from "./api";
import { ErrorBanner, Modal } from "./ui";
import { useI18n } from "./i18n";
import "./comments.css";

export default function NotificationBell({
  onNavigate,
  navigate,
}: {
  onNavigate: (sessionId: string, blockId?: string, commentId?: string) => void;
  /** Opens a page, for notifications that do not concern a session. */
  navigate: (url: string) => void;
}) {
  const { t, locale } = useI18n(),
    [open, setOpen] = useState(false),
    [notifications, setNotifications] = useState<TeamNotification[]>([]),
    [unread, setUnread] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await api<{
      notifications: TeamNotification[];
      unread: number;
    }>("/notifications", { signal });
    if (!signal?.aborted) {
      setNotifications(data.notifications);
      setUnread(data.unread);
      setError("");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const poll = () => {
      if (pending || document.hidden) return;
      pending = true;
      void load(controller.signal)
        .catch((cause) => {
          if (!controller.signal.aborted) setError(cause.message);
        })
        .finally(() => (pending = false));
    };
    poll();
    const interval = setInterval(poll, 30000);
    window.addEventListener("meetloom:notifications", poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("meetloom:notifications", poll);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [load]);
  const describe = (notification: TeamNotification) => {
    const count = notification.count ?? 1;
    if (notification.kind === "visitor-comments")
      return count > 1 ? (
        <>
          <strong>
            {t(
              `${count} nouveaux commentaires de visiteurs`,
              `${count} new visitor comments`,
            )}
          </strong>{" "}
          · {t("dernier :", "latest:")} {notification.actor}
        </>
      ) : (
        <>
          <strong>{notification.actor}</strong>{" "}
          {t("a commenté via un lien visiteur", "commented on a visitor link")}
        </>
      );
    if (notification.kind === "feedback")
      return count > 1 ? (
        <strong>
          {t(
            `${count} nouveaux retours d’utilisateurs`,
            `${count} new user reports`,
          )}
        </strong>
      ) : (
        <>
          <strong>{notification.actor}</strong>{" "}
          {t(
            "a signalé un problème ou une idée",
            "reported a problem or an idea",
          )}
        </>
      );
    return (
      <>
        <strong>{notification.actor}</strong> {descriptions[notification.kind]}
      </>
    );
  };
  const descriptions: Record<
    Exclude<TeamNotification["kind"], "visitor-comments" | "feedback">,
    string
  > = {
    comment: t("a ajouté un commentaire", "added a comment"),
    reply: t("a répondu dans une discussion", "replied to a thread"),
    mention: t(
      "vous a mentionné dans un commentaire",
      "mentioned you in a comment",
    ),
    "block-mention": t(
      "vous a mentionné dans un bloc",
      "mentioned you in a block",
    ),
    "task-completed": t(
      "a terminé une tâche qui vous mentionne",
      "completed a task mentioning you",
    ),
  };
  return (
    <>
      <button
        className="icon-button notification-bell"
        title={t("Notifications", "Notifications")}
        aria-label={`${t("Notifications", "Notifications")}${unread ? ` (${unread})` : ""}`}
        onClick={() => {
          setOpen(true);
          void load().catch((cause) => setError(cause.message));
        }}
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="notification-count">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <Modal
          title={t("Notifications", "Notifications")}
          close={() => setOpen(false)}
        >
          <div className="notifications-panel">
            {error && <ErrorBanner message={error} />}
            <button
              className="button secondary small"
              disabled={busy || !unread}
              onClick={async () => {
                setBusy(true);
                try {
                  await post("/notifications/read", { all: true });
                  await load();
                } catch (cause) {
                  setError((cause as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <CheckCheck size={16} />
              {t("Tout marquer comme lu", "Mark all as read")}
            </button>
            {!notifications.length && (
              <p>
                {t(
                  "Aucune notification pour le moment.",
                  "No notifications yet.",
                )}
              </p>
            )}
            {notifications.map((notification) => (
              <button
                key={notification.id}
                className={`notification-item ${notification.readAt ? "" : "is-unread"}`}
                onClick={async () => {
                  try {
                    await post("/notifications/read", {
                      ids: [notification.id],
                    });
                    setUnread((value) =>
                      Math.max(0, value - (notification.readAt ? 0 : 1)),
                    );
                    setOpen(false);
                    if (notification.kind === "feedback")
                      navigate("/account/feedback-inbox");
                    else if (notification.sessionId)
                      onNavigate(
                        notification.sessionId,
                        notification.blockId ?? undefined,
                        notification.commentId ?? undefined,
                      );
                  } catch (cause) {
                    setError((cause as Error).message);
                  }
                }}
              >
                <span>{describe(notification)}</span>
                <b>
                  {notification.kind === "feedback"
                    ? t("Retours des utilisateurs", "User feedback")
                    : notification.sessionTitle}
                </b>
                <time dateTime={notification.createdAt}>
                  {new Date(notification.createdAt).toLocaleString(locale)}
                </time>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
