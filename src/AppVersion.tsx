import { useEffect, useState } from "react";
import { api } from "./api";

/** The installed version, for anyone signed in (support requests, checking
 * that an update went through). */
export default function AppVersion() {
  const [about, setAbout] = useState<{
    version: string;
    revision: string | null;
  } | null>(null);
  useEffect(() => {
    void api<{ version: string; revision: string | null }>("/about")
      .then(setAbout)
      .catch(() => setAbout(null));
  }, []);
  if (!about) return null;
  return (
    <p className="muted app-version">
      MeetLoom {about.version}
      {about.revision && ` · ${about.revision.slice(0, 7)}`}
    </p>
  );
}
