import { useEffect, useState } from "react";
import { Megaphone, TriangleAlert, X } from "lucide-react";
import { api } from "./api";
import { useI18n } from "./i18n";

export interface Announcement {
  message: string;
  tone: "info" | "warning";
  updatedAt: string;
}
const DISMISSED = "meetloom.announcement.dismissed";
const REFRESH_MS = 5 * 60_000;

/** An http(s) address, normalized; anything else is not a link. */
function webAddress(text: string) {
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Addresses in the message become links; the rest stays text. */
function linkified(message: string) {
  return message.split(/(https?:\/\/[^\s<>"]+)/g).map((part, index) => {
    const href = index % 2 ? webAddress(part) : null;
    return href ? (
      <a key={index} href={href} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    );
  });
}

/** The administrators' message, on every page for accounts. Closing it
 * hides this message in this browser until they change it. */
export default function AnnouncementBanner() {
  const { t } = useI18n();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    const load = () =>
      api<{ announcement: Announcement | null }>("/announcement")
        .then((result) => setAnnouncement(result.announcement))
        .catch(() => {});
    void load();
    const timer = setInterval(load, REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  if (!announcement || dismissed === announcement.updatedAt) return null;
  const Icon = announcement.tone === "warning" ? TriangleAlert : Megaphone;
  return (
    <div
      className={`announcement-banner ${announcement.tone}`}
      role={announcement.tone === "warning" ? "alert" : "status"}
    >
      <Icon size={17} aria-hidden="true" />
      <p>{linkified(announcement.message)}</p>
      <button
        className="icon-button"
        title={t("Masquer ce message", "Hide this message")}
        aria-label={t("Masquer ce message", "Hide this message")}
        onClick={() => {
          setDismissed(announcement.updatedAt);
          try {
            localStorage.setItem(DISMISSED, announcement.updatedAt);
          } catch {
            // Hidden for this page view only.
          }
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
