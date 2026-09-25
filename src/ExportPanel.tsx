import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Copy,
  Eye,
  LockKeyhole,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type { PublicSession, Session } from "../shared/model";
import { useI18n } from "./i18n";
import { ErrorBanner, Modal } from "./ui";
import { exportSessionCsv } from "./export";
import {
  documentFilename,
  exportProjection,
  powerpointBlob,
  saveBlob,
  wordBlob,
  defaultSlideOutline,
  type ExportSlide,
} from "./export-documents";
import {
  DEFAULT_PRINT_OPTIONS,
  type PrintOptions,
  type ExportPreset,
} from "./export-options";
import { PrintableAgenda } from "./PrintableAgenda";
import { api, post } from "./api";
import { allBlocks } from "../shared/domain";
import { categoriesFor } from "./categories";
import { copyExportTable } from "./export-clipboard";
import ExportAiTools from "./ExportAiTools";
import "./export.css";

export default function ExportPanel({
  session,
  close,
  print,
  aiEnabled = false,
  flush,
}: {
  session: Session;
  close: () => void;
  aiEnabled?: boolean;
  flush?: () => Promise<Session>;
  print: (
    session: PublicSession,
    privateAudience: boolean,
    options: PrintOptions,
  ) => void;
}) {
  const { t, locale } = useI18n();
  const [audience, setAudience] = useState<"team" | "public">("public"),
    [days, setDays] = useState(new Set(session.days.map((day) => day.id))),
    [columns, setColumns] = useState(
      new Set(session.columns.map((column) => column.id)),
    ),
    [pages, setPages] = useState(
      new Set(session.pages?.map((page) => page.id) ?? []),
    ),
    [options, setOptions] = useState<PrintOptions>(DEFAULT_PRINT_OPTIONS),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [presets, setPresets] = useState<ExportPreset[]>([]),
    [presetName, setPresetName] = useState(""),
    [presetId, setPresetId] = useState(""),
    [preview, setPreview] = useState(false),
    [notice, setNotice] = useState(""),
    [outline, setOutline] = useState<ExportSlide[]>([]),
    [speakerNotes, setSpeakerNotes] = useState(false),
    [noteColumns, setNoteColumns] = useState(
      new Set(session.columns.map((column) => column.id)),
    ),
    [blocks, setBlocks] = useState(
      new Set(
        session.days.flatMap((day) =>
          allBlocks(day.blocks).map((block) => block.id),
        ),
      ),
    ),
    [categoryIds, setCategoryIds] = useState(
      new Set(
        categoriesFor(locale, session.categories).map(
          (category) => category.id,
        ),
      ),
    ),
    [formId, setFormId] = useState(""),
    [defaultsLoading, setDefaultsLoading] = useState(!!session.workspaceId);
  useEffect(() => {
    let active = true;
    void api<{ presets: ExportPreset[] }>("/export/presets")
      .then((result) => {
        if (active) setPresets(result.presets);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!session.workspaceId) return;
    const controller = new AbortController();
    void api<{ export: { audience: "team" | "public"; landscape: boolean } }>(
      `/sessions/${session.id}/workspace-defaults`,
      { signal: controller.signal },
    )
      .then((value) => {
        setAudience(value.export.audience);
        setOptions((current) => ({
          ...current,
          landscape: value.export.landscape,
        }));
      })
      .catch((error) => {
        if (error.name !== "AbortError") setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDefaultsLoading(false);
      });
    return () => controller.abort();
  }, [session.id, session.workspaceId]);
  const result = useMemo(
    () =>
      exportProjection(session, {
        audience,
        dayIds: [...days],
        columnIds: [...columns],
        pageIds: [...pages],
        blockIds: [...blocks],
        categoryIds: [...categoryIds],
        landscape: false,
      }),
    [session, audience, days, columns, pages, blocks, categoryIds],
  );
  useEffect(
    () =>
      setOutline((previous) => [
        ...defaultSlideOutline(result, locale),
        ...previous.filter(
          (slide) =>
            slide.kind === "form" &&
            session.forms?.some((form) => form.id === slide.targetId),
        ),
      ]),
    [result, locale],
  );
  const allowed = session.columns.filter(
      (column) => audience === "team" || column.visibility === "public",
    ),
    allowedPages =
      session.pages?.filter(
        (page) => audience === "team" || page.visibility === "public",
      ) ?? [];
  const change = <K extends keyof PrintOptions>(
    key: K,
    value: PrintOptions[K],
  ) => setOptions((current) => ({ ...current, [key]: value }));
  const toggle = (
    setter: (change: (current: Set<string>) => Set<string>) => void,
    id: string,
    checked: boolean,
  ) =>
    setter((current) => {
      const next = new Set(current);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  const exportFile = async (format: "docx" | "pptx" | "csv") => {
    setBusy(format);
    setError("");
    try {
      const blob =
        format === "docx"
          ? await wordBlob(result, locale, { ...options, audience })
          : format === "pptx"
            ? await powerpointBlob(result, locale, audience, {
                ...options,
                outline,
                speakerNotes,
                noteColumnIds: [...noteColumns],
              })
            : new Blob([exportSessionCsv(result, locale)], {
                type: "text/csv;charset=utf-8",
              });
      saveBlob(blob, documentFilename(session.title, format));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : t(
              "Document impossible à générer.",
              "Could not generate the document.",
            ),
      );
    } finally {
      setBusy("");
    }
  };
  const move = (index: number, offset: number) =>
    setOutline((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  const addForm = async () => {
    const form = session.forms?.find((form) => form.id === formId);
    if (!form) return;
    setBusy("form");
    setError("");
    try {
      const response = await post<{ share: { token: string } }>(
        `/sessions/${session.id}/shares`,
        {
          label: `${t("Présentation", "Presentation")} · ${form.title}`.slice(
            0,
            120,
          ),
          mode: "visitor",
          dayIds: [],
          pageIds: [],
          formIds: [form.id],
          initialContentId: form.id,
          allowComments: false,
        },
      );
      setOutline((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          kind: "form",
          targetId: form.id,
          title: form.title,
          enabled: true,
          url: `${window.location.origin}/s/${response.share.token}`,
        },
      ]);
      setFormId("");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <Modal
      wide
      title={t("Exporter la séance", "Export session")}
      subtitle={t(
        "Préparez le document et vérifiez son aperçu avant de le diffuser.",
        "Prepare the document and review its preview before sharing.",
      )}
      close={close}
    >
      <fieldset
        disabled={defaultsLoading}
        className="workspace-export-fieldset"
      >
        <div className="export-panel">
          {error && <ErrorBanner message={error} />}
          {notice && <p role="status">{notice}</p>}
          <div className="export-presets">
            <select
              aria-label={t("Préréglages personnels", "Personal presets")}
              value={presetId}
              onChange={(event) => {
                setPresetId(event.target.value);
                const preset = presets.find(
                  (preset) => preset.id === event.target.value,
                );
                if (preset) {
                  setAudience(preset.audience);
                  setOptions(preset.options);
                  setPresetName(preset.name);
                }
              }}
            >
              <option value="">
                {t("Réglages personnalisés", "Custom settings")}
              </option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            {presetId && (
              <button
                className="icon-button"
                aria-label={t("Supprimer ce préréglage", "Delete this preset")}
                onClick={() => {
                  void api(`/export/presets/${presetId}`, { method: "DELETE" })
                    .then(() => {
                      setPresets((current) =>
                        current.filter((preset) => preset.id !== presetId),
                      );
                      setPresetId("");
                    })
                    .catch((error) => setError(error.message));
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
            <input
              maxLength={120}
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder={t("Nom du nouveau préréglage", "New preset name")}
            />
            {presetId && (
              <button
                className="button secondary"
                disabled={!presetName.trim() || !!busy}
                onClick={() => {
                  setBusy("preset");
                  void api<{ preset: ExportPreset }>(
                    `/export/presets/${presetId}`,
                    {
                      method: "PUT",
                      body: JSON.stringify({
                        name: presetName.trim(),
                        audience,
                        options,
                      }),
                    },
                  )
                    .then(({ preset }) => {
                      setPresets((current) =>
                        current.map((value) =>
                          value.id === preset.id ? preset : value,
                        ),
                      );
                      setNotice(t("Préréglage mis à jour.", "Preset updated."));
                    })
                    .catch((error) => setError(error.message))
                    .finally(() => setBusy(""));
                }}
              >
                <Save size={16} />
                {t("Mettre à jour / renommer", "Update / rename")}
              </button>
            )}
            <button
              className="button secondary"
              disabled={!presetName.trim() || !!busy}
              onClick={() => {
                setBusy("preset");
                void post<{ preset: ExportPreset }>("/export/presets", {
                  name: presetName,
                  audience,
                  options,
                })
                  .then(({ preset }) => {
                    setPresets((current) => [...current, preset]);
                    setPresetId(preset.id);
                    setPresetName("");
                  })
                  .catch((error) => setError(error.message))
                  .finally(() => setBusy(""));
              }}
            >
              <Save size={16} />
              {t("Enregistrer", "Save")}
            </button>
          </div>
          <label>
            {t("Destinataires", "Audience")}
            <select
              value={audience}
              onChange={(event) =>
                setAudience(event.target.value as "team" | "public")
              }
            >
              <option value="public">
                {t(
                  "Participants — informations publiques",
                  "Participants — public information",
                )}
              </option>
              <option value="team">
                {t(
                  "Équipe — informations internes possibles",
                  "Team — may contain internal information",
                )}
              </option>
            </select>
          </label>
          {audience === "team" && (
            <p className="privacy-explainer">
              <LockKeyhole size={18} />
              {t(
                "Vérifiez les colonnes et Pages internes sélectionnées avant diffusion.",
                "Check selected internal columns and Pages before sharing.",
              )}
            </p>
          )}
          <fieldset className="export-choices">
            <legend>{t("Jours", "Days")}</legend>
            {session.days.map((day) => (
              <label className="checkbox-row" key={day.id}>
                <input
                  type="checkbox"
                  checked={days.has(day.id)}
                  onChange={(event) =>
                    toggle(setDays, day.id, event.target.checked)
                  }
                />
                {day.title}
              </label>
            ))}
          </fieldset>
          <fieldset className="export-choices">
            <legend>{t("Colonnes", "Columns")}</legend>
            {allowed.map((column) => (
              <label className="checkbox-row" key={column.id}>
                <input
                  type="checkbox"
                  checked={columns.has(column.id)}
                  onChange={(event) =>
                    toggle(setColumns, column.id, event.target.checked)
                  }
                />
                {column.label}
                {column.visibility === "team" && <LockKeyhole size={12} />}
              </label>
            ))}
          </fieldset>
          {!!allowedPages.length && (
            <fieldset className="export-choices">
              <legend>Pages</legend>
              {allowedPages.map((page) => (
                <label className="checkbox-row" key={page.id}>
                  <input
                    type="checkbox"
                    checked={pages.has(page.id)}
                    onChange={(event) =>
                      toggle(setPages, page.id, event.target.checked)
                    }
                  />
                  {page.title}
                  {page.visibility === "team" && <LockKeyhole size={12} />}
                </label>
              ))}
            </fieldset>
          )}
          <div className="export-options-grid">
            <label>
              {t("Papier", "Paper")}
              <select
                value={options.paper}
                onChange={(event) =>
                  change("paper", event.target.value as PrintOptions["paper"])
                }
              >
                <option>A4</option>
                <option>Letter</option>
                <option>Legal</option>
              </select>
            </label>
            <label>
              {t("Orientation", "Orientation")}
              <select
                value={options.landscape ? "landscape" : "portrait"}
                onChange={(event) =>
                  change("landscape", event.target.value === "landscape")
                }
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">{t("Paysage", "Landscape")}</option>
              </select>
            </label>
            <label>
              {t("Police", "Font")}
              <select
                value={options.font}
                onChange={(event) =>
                  change("font", event.target.value as PrintOptions["font"])
                }
              >
                {["Arial", "Calibri", "Georgia"].map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </select>
            </label>
            <label>
              {t("Taille du texte (PDF/Word)", "Text size (PDF/Word)")}
              <select
                value={options.fontSize}
                onChange={(event) =>
                  change(
                    "fontSize",
                    Number(event.target.value) as PrintOptions["fontSize"],
                  )
                }
              >
                {[9, 10, 11, 12, 14].map((size) => (
                  <option key={size} value={size}>
                    {size} pt
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Mise en page", "Layout")}
              <select
                value={options.layout}
                onChange={(event) =>
                  change("layout", event.target.value as PrintOptions["layout"])
                }
              >
                <option value="detailed">{t("Détaillée", "Detailed")}</option>
                <option value="table">{t("Tableau", "Table")}</option>
                <option value="compact">{t("Compacte", "Compact")}</option>
                <option value="overview">
                  {t("Vue par jour", "Day overview")}
                </option>
                <option value="multiday">
                  {t("Vue multijour", "Multi-day overview")}
                </option>
                <option value="details">
                  {t("Détails seuls", "Details only")}
                </option>
              </select>
            </label>
          </div>
          <div className="export-choices">
            <label>
              {t(
                "Saut de page tous les… blocs",
                "Page break after every… blocks",
              )}
              <select
                value={options.blocksPerPage ?? 0}
                onChange={(event) =>
                  change("blocksPerPage", Number(event.target.value))
                }
              >
                {[0, 1, 2, 3, 5, 10, 20, 30].map((value) => (
                  <option key={value} value={value}>
                    {value || t("Automatique", "Automatic")}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                "includeMaterials",
                "dayPageBreak",
                "categoryColors",
                "categoryLegend",
              ] as const
            ).map((key) => (
              <label className="checkbox-row" key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) => change(key, event.target.checked)}
                />
                {
                  {
                    includeMaterials: t(
                      "Liste du matériel sélectionné",
                      "Selected materials list",
                    ),
                    categoryLegend: t(
                      "Légende des catégories",
                      "Category legend",
                    ),
                    dayPageBreak: t(
                      "Un jour par page",
                      "New page for each day",
                    ),
                    categoryColors: t(
                      "Couleurs des catégories (PDF)",
                      "Category colors (PDF)",
                    ),
                  }[key]
                }
              </label>
            ))}
          </div>
          <p className="muted">
            {t(
              "Les sauts explicites sont indiqués dans l’aperçu. Un contenu plus long qu’une page est réparti par le navigateur ou Word ; le dialogue d’impression affiche la pagination définitive.",
              "Explicit breaks are shown in the preview. Content longer than one page is split by the browser or Word; the print dialog shows final pagination.",
            )}
          </p>
          <details>
            <summary>
              {t(
                "Filtrer les blocs et catégories",
                "Filter blocks and categories",
              )}
            </summary>
            <fieldset className="export-choices">
              <legend>{t("Catégories", "Categories")}</legend>
              {categoriesFor(locale, session.categories).map((category) => (
                <label className="checkbox-row" key={category.id}>
                  <input
                    type="checkbox"
                    checked={categoryIds.has(category.id)}
                    onChange={(event) =>
                      toggle(setCategoryIds, category.id, event.target.checked)
                    }
                  />
                  {category.label}
                </label>
              ))}
            </fieldset>
            <div className="slide-outline">
              {session.days
                .filter((day) => days.has(day.id))
                .flatMap((day) =>
                  allBlocks(day.blocks).map((block) => (
                    <label className="checkbox-row" key={block.id}>
                      <input
                        type="checkbox"
                        checked={blocks.has(block.id)}
                        onChange={(event) =>
                          setBlocks((current) => {
                            const next = new Set(current);
                            for (const item of allBlocks([block]))
                              event.target.checked
                                ? next.add(item.id)
                                : next.delete(item.id);
                            return next;
                          })
                        }
                      />
                      {day.title} · {block.title}
                      {block.kind && block.kind !== "activity"
                        ? ` (${block.kind})`
                        : ""}
                    </label>
                  )),
                )}
            </div>
            <p className="muted">
              {t(
                "Les groupes nécessaires restent comme repères. Les horaires initiaux des blocs sélectionnés sont conservés.",
                "Required group headings remain as context. Selected blocks retain their original times.",
              )}
            </p>
          </details>
          <button
            className="button secondary"
            onClick={() => setPreview(!preview)}
          >
            <Eye size={16} />
            {preview
              ? t("Masquer l’aperçu", "Hide preview")
              : t("Afficher l’aperçu du document", "Show document preview")}
          </button>
          {preview && (
            <div className="export-preview">
              <PrintableAgenda
                session={result}
                privateAudience={audience === "team"}
                options={options}
                preview
              />
            </div>
          )}
          <details>
            <summary>
              {t(
                "PowerPoint : plan des diapositives",
                "PowerPoint: slide outline",
              )}
            </summary>
            <p className="muted">
              {t(
                "Choisissez et ordonnez les diapositives. Les textes longs continuent sur plusieurs diapositives. Modifier les données sélectionnées régénère le plan.",
                "Choose and order slides. Long text continues across multiple slides. Changing selected data regenerates the outline.",
              )}
            </p>
            <div className="slide-outline">
              {outline.map((slide, index) => (
                <div className="slide-outline-row" key={slide.id}>
                  <input
                    type="checkbox"
                    checked={slide.enabled}
                    aria-label={t("Inclure", "Include") + " " + slide.title}
                    onChange={(event) =>
                      setOutline((current) =>
                        current.map((item) =>
                          item.id === slide.id
                            ? { ...item, enabled: event.target.checked }
                            : item,
                        ),
                      )
                    }
                  />
                  <small>{slide.kind}</small>
                  <input
                    type="text"
                    value={slide.title}
                    maxLength={200}
                    aria-label={t("Titre de diapositive", "Slide title")}
                    onChange={(event) =>
                      setOutline((current) =>
                        current.map((item) =>
                          item.id === slide.id
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <button
                    className="icon-button"
                    disabled={index === 0}
                    aria-label={t("Monter", "Move up")}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={index === outline.length - 1}
                    aria-label={t("Descendre", "Move down")}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              ))}
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={speakerNotes}
                onChange={(event) => setSpeakerNotes(event.target.checked)}
              />
              {t(
                "Placer le détail des blocs dans les notes du présentateur",
                "Place block details in speaker notes",
              )}
            </label>
            {speakerNotes && (
              <fieldset className="export-choices">
                <legend>
                  {t("Champs placés dans les notes", "Fields placed in notes")}
                </legend>
                {result.columns.map((column) => (
                  <label className="checkbox-row" key={column.id}>
                    <input
                      type="checkbox"
                      checked={noteColumns.has(column.id)}
                      onChange={(event) =>
                        toggle(setNoteColumns, column.id, event.target.checked)
                      }
                    />
                    {column.label}
                  </label>
                ))}
              </fieldset>
            )}
            {!!session.forms?.length && (
              <div className="export-presets">
                <select
                  aria-label={t("Formulaire pour QR", "Form for QR")}
                  value={formId}
                  onChange={(event) => setFormId(event.target.value)}
                >
                  <option value="">
                    {t(
                      "Choisir un formulaire publié",
                      "Choose a published form",
                    )}
                  </option>
                  {session.forms.map((form) => (
                    <option key={form.id} value={form.id}>
                      {form.title}
                    </option>
                  ))}
                </select>
                <button
                  className="button secondary"
                  disabled={!formId || !!busy}
                  onClick={() => void addForm()}
                >
                  <Plus size={16} />
                  {t(
                    "Créer un lien et ajouter le QR",
                    "Create a link and add QR",
                  )}
                </button>
                <p className="muted">
                  {t(
                    "Le formulaire doit déjà être publié. Ce clic crée un lien visiteur limité à ce formulaire, révocable depuis Partager.",
                    "The form must already be published. This creates a visitor link restricted to that form, revocable from Share.",
                  )}
                </p>
              </div>
            )}
          </details>
          <button
            className="button secondary"
            onClick={() =>
              void copyExportTable(result, locale)
                .then(() =>
                  setNotice(
                    t(
                      "Tableau copié : collez-le dans Word, Excel ou un message.",
                      "Table copied: paste it into Word, Excel or a message.",
                    ),
                  ),
                )
                .catch(() =>
                  setError(
                    t(
                      "Copie refusée par le navigateur. Utilisez l’export Word ou CSV.",
                      "Browser clipboard access was denied. Use Word or CSV export.",
                    ),
                  ),
                )
            }
          >
            <Copy size={16} />
            {t("Copier le tableau", "Copy table")}
          </button>
          {aiEnabled && (
            <ExportAiTools
              sessionId={session.id}
              enabled={aiEnabled}
              prepare={flush}
              options={options}
              selection={{
                audience,
                dayIds: [...days],
                columnIds: [...columns],
                pageIds: [...pages],
                blockIds: [...blocks],
                categoryIds: [...categoryIds],
                landscape: options.landscape,
              }}
              onApply={(proposal) => {
                setOptions(proposal.options);
                if (proposal.outline.length)
                  setOutline((current) => [
                    ...proposal.outline,
                    ...current.filter((slide) => slide.kind === "form"),
                  ]);
                setPreview(true);
              }}
            />
          )}
          <div className="export-buttons">
            <button
              className="button primary"
              disabled={
                (!result.days.length && !result.pages?.length) || !!busy
              }
              onClick={() => print(result, audience === "team", options)}
            >
              <Download size={16} />
              {t("Imprimer / PDF", "Print / PDF")}
            </button>
            {(["docx", "pptx", "csv"] as const).map((format) => (
              <button
                key={format}
                className="button secondary"
                disabled={
                  !!busy ||
                  (format === "pptx"
                    ? !outline.some((slide) => slide.enabled)
                    : !result.days.length && !result.pages?.length)
                }
                onClick={() => void exportFile(format)}
              >
                {busy === format
                  ? "…"
                  : format === "docx"
                    ? "Word"
                    : format === "pptx"
                      ? "PowerPoint"
                      : "CSV"}
              </button>
            ))}
          </div>
          <p className="muted">
            {t(
              "Les documents sont générés dans le navigateur, sans service externe. Les préréglages personnels conservent uniquement vos réglages de présentation.",
              "Documents are generated in your browser, without an external service. Personal presets store presentation settings only.",
            )}
          </p>
        </div>
      </fieldset>
    </Modal>
  );
}
