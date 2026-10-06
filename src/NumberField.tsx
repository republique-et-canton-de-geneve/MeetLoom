import { useState, type ComponentProps } from "react";
import { parseNumberInput } from "./number-input";

/** A number input that keeps what is typed on screen, passes on only values
 * within bounds, and shows the last accepted value again on leaving. */
export function NumberField({
  value,
  change,
  min,
  max,
  integer,
  ...input
}: Omit<
  ComponentProps<"input">,
  "type" | "value" | "onChange" | "onBlur" | "min" | "max"
> & {
  value: number;
  change: (value: number) => void;
  min: number;
  max: number;
  integer?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...input}
      type="number"
      min={min}
      max={max}
      value={draft ?? value}
      onChange={(event) => {
        setDraft(event.target.value);
        const typed = parseNumberInput(event.target.value, {
          min,
          max,
          integer,
        });
        if (typed !== null && typed !== value) change(typed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
