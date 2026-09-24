import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { FormAiSummary as Summary } from "../shared/form-analysis";
import { post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";
export function FormAiSummary({
  sessionId,
  formId,
  enabled,
  total,
}: {
  sessionId: string;
  formId: string;
  enabled: boolean;
  total: number;
}) {
  const { t, locale } = useI18n(),
    [result, setResult] = useState<Summary | null>(null),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="form-summary">
      <h3>
        <Sparkles size={17} />{" "}
        {t("Synthèse par l’IA interne", "Internal AI summary")}
      </h3>
      <p className="muted">
        {t(
          "Cette action transmet les réponses au modèle interne. Les identités des comptes sont retirées ; les textes libres peuvent contenir des informations personnelles. Vérifiez la synthèse avant de la diffuser.",
          "This action sends responses to the internal model. Account identities are removed; free text may contain personal information. Review the summary before sharing it.",
        )}
      </p>
      <label>
        {t("Question facultative", "Optional question")}
        <textarea
          value={prompt}
          maxLength={2000}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <button
        className="button secondary"
        disabled={!enabled || !total || busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void post<Summary>(`/sessions/${sessionId}/forms/${formId}/summary`, {
            locale,
            prompt,
          })
            .then(setResult)
            .catch((cause) => setError(cause.message))
            .finally(() => setBusy(false));
        }}
      >
        <Sparkles size={15} />
        {busy
          ? t("Analyse…", "Analyzing…")
          : t("Analyser les réponses", "Analyze responses")}
      </button>
      {!enabled && (
        <p className="muted">
          {t(
            "Le modèle interne n’est pas configuré.",
            "The internal model is not configured.",
          )}
        </p>
      )}
      {error && <ErrorBanner message={error} />}{" "}
      {result && (
        <>
          <p className="muted">
            {result.included}/{result.total}{" "}
            {t("réponses analysées", "responses analyzed")}
            {result.partial
              ? ` · ${t("Échantillon des réponses les plus récentes ; synthèse partielle.", "Sample of the most recent responses; partial summary.")}`
              : ""}
          </p>
          <div style={{ whiteSpace: "pre-wrap" }}>{result.summary}</div>
        </>
      )}
    </section>
  );
}
