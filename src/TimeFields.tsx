import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { runComparison, type RunComparison } from "../shared/domain";
import type { PublicBlock, RunState } from "../shared/model";
import { useI18n } from "./i18n";
import { parseClock, parseDuration, shiftClock } from "./time-input";
import { durationGapLabel, durationLabel } from "./ui";

/** The session's run, so a played block compares its actual time with its
 * plan. */
export const RunContext = createContext<
  | Pick<
      RunState,
      "status" | "blockId" | "plannedDurations" | "actualDurations"
    >
  | undefined
>(undefined);

export const actualDurationLabel = (seconds: number) =>
  seconds < 60 ? "< 1 min" : `${Math.floor(seconds / 60)} min`;

/** "On schedule", "1 h 15 min late": the gap in words, here and in past
 * runs. */
export const gapPhrase = (
  t: (fr: string, en: string) => string,
  minutes: number,
) =>
  minutes === 0
    ? t("Dans le temps prévu", "On schedule")
    : minutes > 0
      ? t(
          `${durationLabel(minutes)} de retard`,
          `${durationLabel(minutes)} late`,
        )
      : t(
          `${durationLabel(-minutes)} d’avance`,
          `${durationLabel(-minutes)} early`,
        );

/** The signed gap, coloured like the timer: blue early, amber late, red from
 * five minutes late. */
function GapBadge({
  comparison,
  hidden = false,
}: {
  comparison: RunComparison;
  hidden?: boolean;
}) {
  const { t } = useI18n();
  return (
    <span
      className="duration-gap"
      data-gap={comparison.state}
      title={gapPhrase(t, comparison.deltaMinutes)}
      aria-hidden={hidden || undefined}
    >
      {durationGapLabel(comparison.deltaMinutes)}
    </span>
  );
}

/** "Prévu 30 min · réel 31 min [+1 min]", for a group, a day or a session. */
export function RunCompare({ comparison }: { comparison: RunComparison }) {
  const { t } = useI18n();
  const planned = durationLabel(comparison.plannedMinutes),
    actual = durationLabel(comparison.actualMinutes),
    phrase = gapPhrase(t, comparison.deltaMinutes);
  return (
    <span
      className="run-compare"
      title={t(
        `Prévu au lancement du minuteur : ${planned} · réel : ${actual} · ${phrase}`,
        `Planned when the timer started: ${planned} · actual: ${actual} · ${phrase}`,
      )}
    >
      <span>{`${t("Prévu", "Planned")} ${planned} ·`}</span>
      <span>
        {t("réel", "actual")}{" "}
        <span className="run-compare-actual">{actual}</span>
      </span>
      <GapBadge comparison={comparison} />
    </span>
  );
}

export function DurationField({
  value,
  change,
  label,
  readOnly = false,
  block,
}: {
  value: number;
  change: (value: number) => void;
  label: string;
  readOnly?: boolean;
  /** Compares the block's actual time with its plan once the timer has
   * moved past it. */
  block?: PublicBlock;
}) {
  const { t } = useI18n();
  const run = useContext(RunContext);
  const comparison = run && block ? runComparison(run, [block]) : null;
  const [showPlanned, setShowPlanned] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showPlanned) input.current?.focus();
  }, [showPlanned]);
  const displayValue = String(Math.floor(value + 1e-9));
  const [draft, setDraft] = useState(displayValue);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const edited = useRef(false);
  const skipBlur = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(displayValue);
  }, [value]);
  const commit = () => {
    if (!edited.current) {
      setDraft(displayValue);
      return true;
    }
    const typed = parseDuration(draft);
    const parsed = typed === null ? null : Math.floor(typed + 1e-9);
    if (parsed === null) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    setDraft(String(parsed));
    edited.current = false;
    if (parsed !== value) change(parsed);
    return true;
  };
  const step = (amount: number) => {
    const next = Math.min(
      1440,
      Math.max(0, Math.floor((parseDuration(draft) ?? value) + 1e-9) + amount),
    );
    setDraft(String(next));
    edited.current = false;
    setInvalid(false);
    change(next);
  };
  if (comparison && !showPlanned) {
    // The plan is the one captured when the timer started: extensions and
    // applied actual durations change the agenda, not the comparison.
    const planned = comparison.plannedMinutes;
    // Whole seconds rounded down, like the chip and the gap.
    const seconds = comparison.actualSeconds;
    const spent = `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
    const phrase = gapPhrase(t, comparison.deltaMinutes);
    const explanation =
      t(
        `Durée réelle : ${spent} · prévue : ${planned} min · ${phrase}`,
        `Actual duration: ${spent} · planned: ${planned} min · ${phrase}`,
      ) +
      (Number(displayValue) !== planned
        ? t(
            ` · durée dans l’agenda : ${displayValue} min`,
            ` · duration in the agenda: ${displayValue} min`,
          )
        : "");
    return (
      <span className="duration-compare">
        <button
          type="button"
          className="actual-duration"
          title={
            readOnly
              ? explanation
              : `${explanation} · ${t("cliquer pour modifier la durée dans l’agenda", "click to edit the duration in the agenda")}`
          }
          aria-label={`${label} · ${explanation}`}
          disabled={readOnly}
          onClick={() => setShowPlanned(true)}
        >
          {actualDurationLabel(comparison.actualSeconds)}
        </button>
        <GapBadge comparison={comparison} hidden />
        <span className="planned-duration" aria-hidden="true">
          {/* A narrow column wraps it before the number, never before "min". */}
          {t(`prévu ${planned}\u00a0min`, `planned ${planned}\u00a0min`)}
        </span>
      </span>
    );
  }
  const stepButton = (direction: -1 | 1) =>
    !readOnly && (
      <button
        type="button"
        tabIndex={-1}
        className="duration-step"
        aria-label={`${direction < 0 ? t("Réduire :", "Shorten:") : t("Prolonger :", "Extend:")} ${label}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => step(direction)}
        disabled={direction < 0 ? value === 0 : value >= 1440}
      >
        {direction < 0 ? <Minus size={11} /> : <Plus size={11} />}
      </button>
    );
  return (
    <span className={`duration-field ${invalid ? "invalid" : ""}`}>
      {stepButton(-1)}
      <input
        ref={input}
        value={draft}
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid}
        title={
          invalid
            ? t(
                "Saisissez une durée de 0 à 1440 minutes",
                "Enter a duration from 0 to 1440 minutes",
              )
            : t(
                "Minutes, 1h30 ou 1:30 · ↑↓ pour ajuster · Maj = 5 min",
                "Minutes, 1h30 or 1:30 · ↑↓ to adjust · Shift = 5 min",
              )
        }
        readOnly={readOnly}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => {
          edited.current = true;
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={() => {
          focused.current = false;
          if (!readOnly && !skipBlur.current) commit();
          skipBlur.current = false;
          setShowPlanned(false);
        }}
        onKeyDown={(e) => {
          if (readOnly || e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            if (commit()) {
              skipBlur.current = true;
              e.currentTarget.blur();
            }
          }
          if (e.key === "Escape") {
            edited.current = false;
            skipBlur.current = true;
            setDraft(displayValue);
            setInvalid(false);
            e.currentTarget.blur();
          }
          if (["ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            step((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 5 : 1));
          }
        }}
      />
      <span>min</span>
      {stepButton(1)}
    </span>
  );
}

export function ClockField({
  value,
  change,
  label,
  readOnly = false,
}: {
  value: string;
  change: (value: string) => void;
  label: string;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value),
    [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const edited = useRef(false);
  const skipBlur = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = () => {
    if (!edited.current) {
      setDraft(value);
      return true;
    }
    const parsed = parseClock(draft);
    if (parsed === null) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    setDraft(parsed);
    edited.current = false;
    if (parsed !== value) change(parsed);
    return true;
  };
  return (
    <input
      className="clock-field"
      value={draft}
      inputMode="numeric"
      aria-label={label}
      aria-invalid={invalid}
      title={
        invalid
          ? t(
              "Saisissez une heure valide, par exemple 9:30",
              "Enter a valid time, for example 9:30",
            )
          : t(
              "9:30, 9h30 ou 930 · ↑↓ pour ajuster · Maj = 5 min",
              "9:30, 9h30 or 930 · ↑↓ to adjust · Shift = 5 min",
            )
      }
      readOnly={readOnly}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onChange={(e) => {
        edited.current = true;
        setDraft(e.target.value);
        setInvalid(false);
      }}
      onBlur={() => {
        focused.current = false;
        if (!readOnly && !skipBlur.current) commit();
        skipBlur.current = false;
      }}
      onKeyDown={(e) => {
        if (readOnly || e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          if (commit()) {
            skipBlur.current = true;
            e.currentTarget.blur();
          }
        }
        if (e.key === "Escape") {
          edited.current = false;
          skipBlur.current = true;
          setDraft(value);
          setInvalid(false);
          e.currentTarget.blur();
        }
        if (["ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          const next = shiftClock(
            parseClock(draft) ?? value,
            (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 5 : 1),
          );
          setDraft(next);
          edited.current = false;
          setInvalid(false);
          change(next);
        }
      }}
    />
  );
}
