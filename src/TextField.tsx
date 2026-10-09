import { useState, type ComponentProps } from "react";
import { keptText } from "./text-input";

/** A text input bound to a saved field that trims or normalizes what it
 * stores. While it has focus it keeps what is typed when the saved copy
 * only differs by that normalization (see keptText). */
export function TextField({
  value,
  change,
  normalize,
  onBlur,
  ...input
}: Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  change: (value: string) => void;
  normalize?: (text: string) => string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <input
      {...input}
      value={keptText(typed, value, normalize)}
      onChange={(event) => {
        setTyped(event.target.value);
        change(event.target.value);
      }}
      onBlur={(event) => {
        setTyped(null);
        onBlur?.(event);
      }}
    />
  );
}
