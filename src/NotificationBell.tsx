import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Volume2, VolumeX } from "lucide-react";
import type { TeamNotification } from "../shared/comments";
import { api, post } from "./api";
import { ErrorBanner, Modal } from "./ui";
import { useI18n } from "./i18n";
import "./comments.css";

const SOUND = "meetloom.notification-sound";
let audio: AudioContext | null = null;
/** Browsers only allow sound after an interaction with the page: the audio
 * context is prepared on the first click or key press. */
function prepareAudio() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    /* No Web Audio: notifications stay silent. */
  }
}
/** Two short, soft notes: noticeable without startling a room. */
function chime() {
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime;
  for (const [offset, frequency] of [
    [0, 880],
    [0.14, 1320],
  ]) {
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.12, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.35);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.4);
  }
}
/** Unread events, grouped ones counted in full, so a second visitor comment
 * on the same session rings too. */
const pending = (notifications: TeamNotification[]) =>
  notifications
    .filter((notification) => !notification.readAt)
    .reduce((sum, notification) => sum + (notification.count ?? 1), 0);

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
    [busy, setBusy] = useState(false),
    [sound, setSound] = useState(() => {
      try {
        return localStorage.getItem(SOUND) !== "off";
      } catch {
        return true;
      }
    });
  const soundOn = useRef(sound),
    seen = useRef<number | null>(null);
  useEffect(() => {
    soundOn.current = sound;
  }, [sound]);
  useEffect(() => {
    window.addEventListener("pointerdown", prepareAudio);
    window.addEventListener("keydown", prepareAudio);
    return () => {
      window.removeEventListener("pointerdown", prepareAudio);
      window.removeEventListener("keydown", prepareAudio);
    };
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await api<{
      notifications: TeamNotification[];
      unread: number;
    }>("/notifications", { signal });
    if (!signal?.aborted) {
      // Only something new rings: not what was already there on arrival.
      const count = pending(data.notifications);
      if (seen.current !== null && count > seen.current && soundOn.current)
        chime();
      seen.current = count;
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
    // A visitor's comment should show within seconds, and at once when the
    // organizer comes back to this window (focus, not only a tab switch).
    const interval = setInterval(poll, 15000);
    window.addEventListener("meetloom:notifications", poll);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("meetloom:notifications", poll);
      window.removeEventListener("focus", poll);
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
            <button
              className="text-button notification-sound"
              aria-pressed={sound}
              onClick={() => {
                const next = !sound;
                setSound(next);
                try {
                  localStorage.setItem(SOUND, next ? "on" : "off");
                } catch {
                  /* Storage is optional. */
                }
                if (next) {
                  prepareAudio();
                  chime();
                }
              }}
            >
              {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
              {sound
                ? t("Son des notifications activé", "Notification sound on")
                : t("Son des notifications coupé", "Notification sound off")}
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
