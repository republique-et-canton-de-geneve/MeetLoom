import { useEffect, useState } from "react";
import { useI18n } from "./i18n";

/** QR pixels are generated locally. The encoded link is never sent to an image service. */
export function QRCode({
  value,
  size = 180,
  label,
}: {
  value: string;
  size?: number;
  label?: string;
}) {
  const { t } = useI18n(),
    [image, setImage] = useState("");
  useEffect(() => {
    let active = true;
    setImage("");
    if (value.length > 2048) return;
    void import("qrcode")
      .then((module) =>
        module.toDataURL(value, {
          width: size,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#23391cff", light: "#ffffffff" },
        }),
      )
      .then((data) => {
        if (active) setImage(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value, size]);
  return image ? (
    <figure className="local-qr">
      <img
        src={image}
        width={size}
        height={size}
        alt={
          label ??
          t("QR code du lien de partage", "QR code for the sharing link")
        }
      />
      <figcaption>
        <a href={image} download="meetloom-qr.png">
          {t("Télécharger le QR code", "Download QR code")}
        </a>
      </figcaption>
    </figure>
  ) : null;
}
export default QRCode;
