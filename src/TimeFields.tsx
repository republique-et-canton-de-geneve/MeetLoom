import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useI18n } from "./i18n";
import { parseClock, parseDuration, shiftClock } from "./time-input";

export function DurationField({
  value,
  change,
  label,
  readOnly = false,
}: {
  value: number;
  change: (value: number) => void;
  label: string;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const displayValue = Number(value.toFixed(2)).toString();
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
    const parsed = parseDuration(draft);
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
      Math.max(0, (parseDuration(draft) ?? value) + amount),
    );
    setDraft(String(next));
    edited.current = false;
    setInvalid(false);
    change(next);
  };
  return (
    <span className={`duration-field ${invalid ? "invalid" : ""}`}>
      <input
        value={draft}
        inputMode="decimal"
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
      {!readOnly && (
        <span className="duration-steppers">
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${t("Réduire :", "Shorten:")} ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => step(-1)}
            disabled={value === 0}
          >
            <Minus size={11} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${t("Prolonger :", "Extend:")} ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => step(1)}
            disabled={value >= 1440}
          >
            <Plus size={11} />
          </button>
        </span>
      )}
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
