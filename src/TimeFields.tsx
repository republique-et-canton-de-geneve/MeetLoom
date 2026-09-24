import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useI18n } from "./i18n";
import { parseClock, parseDuration, shiftClock } from "./time-input";

/** Seconds actually spent per block during the current run, by block ID. */
export const ActualDurationsContext = createContext<
  Record<string, number> | undefined
>(undefined);

export const actualDurationLabel = (seconds: number) =>
  seconds < 60 ? "< 1 min" : `${Math.floor(seconds / 60)} min`;

export function DurationField({
  value,
  change,
  label,
  readOnly = false,
  blockId,
}: {
  value: number;
  change: (value: number) => void;
  label: string;
  readOnly?: boolean;
  /** Shows the block's actual duration once the timer has moved past it. */
  blockId?: string;
}) {
  const { t } = useI18n();
  const actuals = useContext(ActualDurationsContext);
  const actual = blockId === undefined ? undefined : actuals?.[blockId];
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
  if (actual !== undefined && !showPlanned) {
    const seconds = Math.round(actual);
    const spent = `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
    const explanation = t(
      `Durée réelle : ${spent} · prévue : ${displayValue} min`,
      `Actual duration: ${spent} · planned: ${displayValue} min`,
    );
    return (
      <button
        type="button"
        className="actual-duration"
        title={
          readOnly
            ? explanation
            : `${explanation} · ${t("cliquer pour modifier la durée prévue", "click to edit the planned duration")}`
        }
        aria-label={`${label} · ${explanation}`}
        disabled={readOnly}
        onClick={() => setShowPlanned(true)}
      >
        {actualDurationLabel(actual)}
      </button>
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
