import { useEffect, useRef, useState } from "react";
import { FORM_IMAGE_MAX_BYTES, parseFormImage } from "../shared/form-images";
import { useI18n } from "./i18n";

/** Re-encode locally to remove embedded metadata and keep form submissions small. */
async function prepareImage(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("INVALID_IMAGE");
  // Decode the selected bytes directly. A temporary blob URL is not an allowed
  // image source under the application's self/data Content-Security-Policy.
  const image = await createImageBitmap(file);
  try {
    if (
      !image.width ||
      !image.height ||
      image.width * image.height > 40_000_000
    )
      throw new Error("INVALID_IMAGE");
    const ratio = Math.min(1, 1280 / Math.max(image.width, image.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("INVALID_IMAGE");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    if (parseFormImage(png)) return png;
    for (const quality of [0.9, 0.75, 0.6, 0.45, 0.3]) {
      const jpeg = canvas.toDataURL("image/jpeg", quality);
      if (parseFormImage(jpeg)) return jpeg;
    }
    throw new Error("INVALID_IMAGE");
  } finally {
    image.close();
  }
}
export function FormImageInput({
  value,
  onChange,
  label,
  disabled,
  onBusyChange,
}: {
  value: unknown;
  onChange: (value: string) => void;
  label: string;
  disabled: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0),
    change = useRef(onChange),
    pending = useRef(onBusyChange);
  change.current = onChange;
  pending.current = onBusyChange;
  useEffect(
    () => () => {
      generation.current++;
      pending.current?.(false);
    },
    [],
  );
  return (
    <div className="form-image-input">
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={label}
        disabled={disabled || busy}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const current = ++generation.current;
          setBusy(true);
          pending.current?.(true);
          setError("");
          try {
            const result = await prepareImage(file);
            if (current === generation.current) change.current(result);
          } catch {
            if (current === generation.current)
              setError(
                t(
                  "Choisissez une image PNG, JPEG ou WebP de moins de 5 Mo. Si elle reste trop volumineuse après réduction, recadrez-la.",
                  "Choose a PNG, JPEG or WebP image under 5 MB. If it remains too large after resizing, crop it.",
                ),
              );
          } finally {
            if (current === generation.current) {
              setBusy(false);
              pending.current?.(false);
            }
          }
        }}
      />
      <p className="muted">
        {t(
          "Image réduite localement à 1 280 px ; métadonnées retirées. Évitez les informations permettant de vous identifier si vous répondez anonymement.",
          "Image resized locally to 1,280 px; metadata removed. Avoid identifying information when responding anonymously.",
        )}{" "}
        {Math.round(FORM_IMAGE_MAX_BYTES / 1024)} {t("Ko", "KB")}{" "}
        {t(
          "maximum par image, 512 Ko par réponse.",
          "maximum per image, 512 KB per submission.",
        )}
      </p>
      {busy && (
        <p role="status">{t("Préparation de l’image…", "Preparing image…")}</p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {parseFormImage(value) && (
        <div>
          <img
            src={value as string}
            alt={t("Aperçu de votre réponse", "Your image response preview")}
            style={{ maxWidth: "100%", maxHeight: 260 }}
          />
          <button
            type="button"
            className="text-button"
            disabled={disabled || busy}
            onClick={() => change.current("")}
          >
            {t("Retirer l’image", "Remove image")}
          </button>
        </div>
      )}
    </div>
  );
}
