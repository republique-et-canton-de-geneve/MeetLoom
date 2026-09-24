import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { X, Sprout, Globe2 } from "lucide-react";
import { useI18n } from "./i18n";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-symbol">
        <Sprout size={25} strokeWidth={2.4} />
      </span>
      {!compact && (
        <span>
          meet<span className="brand-light">loom</span>
        </span>
      )}
    </span>
  );
}
export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <button
      className="language-button"
      onClick={() => setLocale(locale === "fr" ? "en" : "fr")}
      aria-label={t("Switch to English", "Passer en français")}
    >
      <Globe2 size={16} />
      {locale.toUpperCase()}
    </button>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    ref.current?.showModal();
    const el = ref.current;
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          onClick={close}
          aria-label={t("Fermer", "Close")}
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Inspector({
  title,
  subtitle,
  children,
  close,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
}) {
  const { t } = useI18n();
  const [width, setWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem("meetloom-inspector-width"));
      return value >= 320 && value <= 800 ? value : 420;
    } catch {
      return 420;
    }
  });
  const drag = useRef<{ x: number; width: number } | null>(null);
  const root = useRef<HTMLElement>(null);
  // Focus moves into the panel so Escape closes it without a click first, and
  // goes back to the control that opened it when it closes.
  useEffect(() => {
    const panel = root.current;
    const opener = document.activeElement as HTMLElement | null;
    if (!panel?.contains(opener)) panel?.focus();
    return () => {
      if (opener?.isConnected && !panel?.isConnected) opener.focus();
    };
  }, []);
  const resize = (value: number) => {
    const next = Math.max(320, Math.min(800, value));
    setWidth(next);
    try {
      localStorage.setItem("meetloom-inspector-width", String(next));
    } catch {
      // Storage unavailable (private browsing): the width stays for this tab.
    }
  };
  return (
    <aside
      ref={root}
      tabIndex={-1}
      className="editor-inspector"
      style={{ "--inspector-width": `${width}px` } as CSSProperties}
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div
        className="inspector-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Largeur du panneau", "Panel width")}
        aria-valuemin={320}
        aria-valuemax={800}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (drag.current)
            resize(drag.current.width + drag.current.x - event.clientX);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            resize(width + (event.key === "ArrowLeft" ? 20 : -20));
          }
          if (event.key === "Home") {
            event.preventDefault();
            resize(420);
          }
        }}
      />
      <header className="inspector-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          onClick={close}
          aria-label={t("Fermer le panneau", "Close panel")}
        >
          <X size={20} />
        </button>
      </header>
      <div className="inspector-content">{children}</div>
    </aside>
  );
}

export function ErrorBanner({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      {retry && <button onClick={retry}>{t("Réessayer", "Try again")}</button>}
    </div>
  );
}
export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading">
      <span className="spinner" />
      {t("Chargement…", "Loading…")}
    </div>
  );
}
export function durationLabel(duration: number) {
  // Durations read in whole minutes, rounded down, whatever is stored.
  const value = Math.floor(duration + 1e-9);
  return value >= 60
    ? `${Math.floor(value / 60)} h${value % 60 ? ` ${value % 60} min` : ""}`
    : `${value} min`;
}
export function Avatar({
  name,
  small = false,
  src,
}: {
  name: string;
  small?: boolean;
  src?: string;
}) {
  if (
    src &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(src)
  )
    return (
      <img
        className={`avatar ${small ? "avatar-small" : ""}`}
        src={src}
        alt={name}
      />
    );
  return (
    <span className={`avatar ${small ? "avatar-small" : ""}`}>
      {name
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()}
    </span>
  );
}
