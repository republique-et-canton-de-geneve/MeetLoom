import type { PublicBlock, PublicSession, Session } from "./model.js";
import { runnableBlocks, timerView } from "./domain.js";
export type TimerVisualState = "normal" | "warning" | "critical";
export const TIMER_COLORS: Record<TimerVisualState, string> = {
  normal: "#91d5a1",
  warning: "#f3b552",
  critical: "#f17b79",
};
/** Visual thresholds are deliberately independent from configurable audio alerts. */
export function timerVisualState(
  remainingSeconds: number,
  durationSeconds: number,
): TimerVisualState {
  if (
    durationSeconds <= 0 ||
    !Number.isFinite(durationSeconds) ||
    !Number.isFinite(remainingSeconds)
  )
    return "normal";
  const fraction = remainingSeconds / durationSeconds;
  return fraction <= 0.05 ? "critical" : fraction <= 0.2 ? "warning" : "normal";
}
export function timerMinimapView(
  session: Session | PublicSession,
  block: PublicBlock,
  now: number,
) {
  const view = timerView(session, now),
    sequence = runnableBlocks([block]),
    index = sequence.findIndex((value) => value.id === view.block?.id);
  const active =
    ["running", "paused"].includes(session.run.status) && index >= 0;
  const seconds = sequence.reduce((sum, value) => sum + value.duration * 60, 0);
  const elapsed =
    sequence
      .slice(0, Math.max(0, index))
      .reduce((sum, value) => sum + value.duration * 60, 0) +
    Math.min(
      Math.max(0, view.elapsedSeconds),
      (view.block?.duration ?? 0) * 60,
    );
  return {
    active,
    progress:
      active && seconds > 0 ? Math.max(0, Math.min(1, elapsed / seconds)) : 0,
    state: timerVisualState(
      view.remainingSeconds,
      (view.block?.duration ?? 0) * 60,
    ),
  };
}
