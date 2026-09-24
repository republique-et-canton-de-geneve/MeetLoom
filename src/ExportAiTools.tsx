import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { ExportAiProposal } from "../shared/export-ai";
import type { ExportOptions } from "../shared/export-projection";
import type { PrintOptions } from "./export-options";
import { post } from "./api";
import { useI18n } from "./i18n";
import { ErrorBanner } from "./ui";
export default function ExportAiTools({
  sessionId,
  enabled,
  selection,
  options,
  prepare,
  onApply,
}: {
  sessionId: string;
  enabled: boolean;
  selection: ExportOptions;
  options: PrintOptions;
  prepare?: () => Promise<unknown>;
  onApply: (proposal: ExportAiProposal) => void;
}) {
  const { t, locale } = useI18n(),
    [mode, setMode] = useState<"settings" | "slides">("settings"),
    [prompt, setPrompt] = useState(""),
    [proposal, setProposal] = useState<ExportAiProposal | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generate = async () => {
    setBusy(true);
    setError("");
    setProposal(null);
    try {
      await prepare?.();
      setProposal(
        await post<ExportAiProposal>(`/sessions/${sessionId}/export/ai`, {
          mode,
          prompt,
          locale,
          selection,
          options,
        }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details>
      <summary>
        {t(
          "Proposer des réglages ou un plan avec l’IA interne",
          "Propose settings or an outline with internal AI",
        )}
      </summary>
      <p className="muted">
        {t(
          "Seul le contenu sélectionné pour cet export sera transmis au modèle interne, y compris les informations internes si vous avez choisi Équipe. Aucun fichier ni préréglage n’est créé sans votre action.",
          "Only content selected for this export is sent to the internal model, including internal information when Team is selected. No file or preset is created without your action.",
        )}
      </p>
      <label>
        {t("Proposition", "Proposal")}
        <select
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as typeof mode);
            setProposal(null);
          }}
        >
          <option value="settings">
            {t("Réglages du document", "Document settings")}
          </option>
          <option value="slides">
            {t("Plan PowerPoint", "PowerPoint outline")}
          </option>
        </select>
      </label>
      <label>
        {t("Votre demande", "Your request")}
        <textarea
          maxLength={4000}
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t(
            "Ex. un aide-mémoire compact pour les animateurs, lisible sur A4.",
            "E.g. a compact facilitator handout, readable on A4 paper.",
          )}
        />
      </label>
      <button
        className="button secondary"
        disabled={!enabled || busy || !prompt.trim()}
        onClick={() => void generate()}
      >
        <Sparkles size={16} />
        {busy ? t("Proposition…", "Proposing…") : t("Proposer", "Propose")}
      </button>
      {!enabled && (
        <p className="muted">
          {t(
            "L’IA interne doit être configurée.",
            "Internal AI must be configured.",
          )}
        </p>
      )}
      {error && <ErrorBanner message={error} />}{" "}
      {proposal && (
        <section className="ai-operation">
          <p>{proposal.answer}</p>
          <p>
            {proposal.options.paper} · {proposal.options.font}{" "}
            {proposal.options.fontSize} pt · {proposal.options.layout}
          </p>
          {!!proposal.outline.length && (
            <ol>
              {proposal.outline
                .filter((slide) => slide.enabled)
                .map((slide) => (
                  <li key={slide.id}>{slide.title}</li>
                ))}
            </ol>
          )}
          <button
            className="button primary"
            onClick={() => {
              onApply(proposal);
              setProposal(null);
            }}
          >
            {t("Appliquer cette proposition", "Apply this proposal")}
          </button>
          <button
            className="button secondary"
            onClick={() => setProposal(null)}
          >
            {t("Rejeter", "Reject")}
          </button>
        </section>
      )}
    </details>
  );
}
