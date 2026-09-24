import { useRef } from "react";
import { useI18n } from "./i18n";

export default function ColumnResizer({
  label,
  width,
  change,
}: {
  label: string;
  width: number;
  change: (width: number) => void;
}) {
  const { t } = useI18n();
  const start = useRef<{ x: number; width: number } | null>(null);
  const resize = (value: number) =>
    change(Math.round(Math.max(120, Math.min(800, value))));
  return (
    <span
      className="column-resizer"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`${t("Largeur de", "Width of")} ${label}`}
      aria-valuemin={120}
      aria-valuemax={800}
      aria-valuenow={width}
      title={t(
        "Glisser pour redimensionner · flèches gauche/droite au clavier",
        "Drag to resize · left/right arrows on keyboard",
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        start.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current)
          resize(start.current.width + e.clientX - start.current.x);
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          resize(width + (e.key === "ArrowLeft" ? -20 : 20));
        }
      }}
    />
  );
}
