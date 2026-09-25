import { useEffect, useState } from "react";
import type { Block, Session } from "../shared/model";
import { TIMER_COLORS, timerMinimapView } from "../shared/timer-visual";
import { serverNow } from "./clock";
/** Mounted only for the active top-level segment, so long agendas need one clock. */
export default function TimerMinimapProgress({
  session,
  block,
}: {
  session: Session;
  block: Block;
}) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(serverNow());
    if (session.run.status !== "running") return;
    const interval = window.setInterval(() => setNow(serverNow()), 250);
    return () => window.clearInterval(interval);
  }, [session.run]);
  const view = timerMinimapView(session, block, now);
  return view.active ? (
    <i
      className={`minimap-timer-progress timer-${view.state}`}
      aria-hidden="true"
      style={{
        width: `${view.progress * 100}%`,
        background: TIMER_COLORS[view.state],
      }}
    />
  ) : null;
}
