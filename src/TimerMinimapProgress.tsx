import { useEffect, useState } from "react";
import type { Block, Session } from "../shared/model";
import { TIMER_COLORS, timerMinimapView } from "../shared/timer-visual";
import { serverNow } from "./clock";
/** Mounted only for the current step (an activity or a parallel block), so
 * long agendas need one clock. */
export default function TimerMinimapProgress({
  session,
  block,
  vertical = false,
}: {
  session: Session;
  block: Block;
  /** Fill from the top, along the minimap's time axis: a parallel block's
   * rooms side by side all progress together. */
  vertical?: boolean;
}) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(serverNow());
    if (session.run.status !== "running") return;
    const interval = window.setInterval(() => setNow(serverNow()), 250);
    return () => window.clearInterval(interval);
  }, [session.run]);
  const view = timerMinimapView(session, block, now),
    size = `${view.progress * 100}%`;
  return view.active ? (
    <i
      className={`minimap-timer-progress timer-${view.state}${vertical ? " minimap-timer-vertical" : ""}`}
      aria-hidden="true"
      style={{
        ...(vertical ? { height: size } : { width: size }),
        background: TIMER_COLORS[view.state],
      }}
    />
  ) : null;
}
