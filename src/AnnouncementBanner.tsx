import { useEffect, useState } from "react";
import { Megaphone, TriangleAlert } from "lucide-react";
import { api } from "./api";

export interface Announcement {
  message: string;
  tone: "info" | "warning";
  updatedAt: string;
}
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

/** The administrators' message, on every page for accounts, for as long as
 * they keep it: it cannot be closed. */
export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
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
  if (!announcement) return null;
  const Icon = announcement.tone === "warning" ? TriangleAlert : Megaphone;
  return (
    <div
      className={`announcement-banner ${announcement.tone}`}
      role={announcement.tone === "warning" ? "alert" : "status"}
    >
      <Icon size={17} aria-hidden="true" />
      <p>{linkified(announcement.message)}</p>
    </div>
  );
}
