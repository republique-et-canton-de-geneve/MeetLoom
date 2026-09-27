import { useRef, useState } from "react";
import { FileUp, Plus, Sparkles, ArrowLeft } from "lucide-react";
import type { Session } from "../shared/model";
import { sessionInputSchema } from "../shared/validation";
import { allBlocks, mapBlocks } from "../shared/domain";
import { richTextToPlain } from "../shared/richtext";
import { mergeImportedAgenda } from "../shared/import-agenda";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_TEXT,
  linesToAgenda,
  tableToAgenda,
  type ExtractedDocument,
  type TableMapping,
} from "../shared/document-import";
import { post } from "./api";
import { parseDuration } from "./time-input";
import { useI18n } from "./i18n";
import { ErrorBanner, Loading, Modal } from "./ui";
import "./import.css";

export interface ImportPanelProps {
  session: Session;
  dayId: string;
  update: (fn: (session: Session) => Session) => void;
  close: () => void;
  enabled?: boolean;
}
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("IMPORT_FILE_INVALID"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}
export default function ImportPanel({
  session,
  update,
  close,
  enabled = false,
}: ImportPanelProps) {
  const { locale, t } = useI18n();
  const [document, setDocument] = useState<ExtractedDocument | null>(null),
    [incoming, setIncoming] = useState<Session | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [text, setText] = useState(""),
    [tableIndex, setTableIndex] = useState(0),
    [instructions, setInstructions] = useState(""),
    [defaultDuration, setDefaultDuration] = useState(5),
    [mapping, setMapping] = useState<TableMapping>({
      title: 0,
      header: true,
      defaultDuration: 5,
    });
  const requestId = useRef(0);
  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("IMPORT_DURATION"))
      return (
        t(
          "Une durée est invalide. Utilisez des minutes ou un format comme 1h15. Ligne : ",
          "A duration is invalid. Use minutes or a format such as 1h15. Row: ",
        ) + (message.split(":")[1] ?? "—")
      );
    if (message.startsWith("IMPORT_TITLE"))
      return (
        t("Le titre est vide à la ligne ", "The title is empty on row ") +
        (message.split(":")[1] ?? "—")
      );
    if (message === "IMPORT_EMPTY")
      return t(
        "Le document ne contient aucun bloc à importer.",
        "The document has no blocks to import.",
      );
    if (error instanceof Error && error.name === "ZodError")
      return t(
        "L’agenda dépasse une limite ou contient un champ invalide (titre : 200 caractères, 1 000 blocs, 30 jours).",
        "The agenda exceeds a limit or contains an invalid field (title: 200 characters, 1,000 blocks, 30 days).",
      );
    return message;
  };
  const inspect = async (file?: File) => {
    if (!file) return;
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    setIncoming(null);
    setDocument(null);
    try {
      if (file.size > DOCUMENT_MAX_BYTES)
        throw new Error(
          t("Le fichier dépasse 5 Mo.", "The file exceeds 5 MB."),
        );
      if (file.name.toLowerCase().endsWith(".json")) {
        const result = sessionInputSchema.parse(JSON.parse(await file.text()));
        if (id === requestId.current) setIncoming(result);
      } else {
        const result = await post<{ document: ExtractedDocument }>(
          "/import/extract",
          { name: file.name, base64: await base64(file), locale },
        );
        if (id !== requestId.current) return;
        setDocument(result.document);
        setText(result.document.text);
        setTableIndex(0);
        const first = result.document.tables[0];
        const headers =
          first?.rows[0]?.map((value) => value.toLowerCase().trim()) ?? [];
        const find = (pattern: RegExp) => {
          const index = headers.findIndex((value) => pattern.test(value));
          return index < 0 ? undefined : index;
        };
        setMapping({
          title: find(/^(titre|title|activité|activity|bloc|block)$/) ?? 0,
          duration: find(/^(durée|duration|minutes)$/),
          description:
            result.document.kind === "pptx"
              ? 1
              : find(/^(description|détails|details|notes)$/),
          facilitator: find(/^(responsable|facilitator|speaker|intervenant)$/),
          section: find(/^(section|groupe|group)$/),
          header: result.document.kind !== "pptx",
          defaultDuration,
        });
      }
    } catch (error) {
      if (id === requestId.current) setError(report(error));
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };
  const build = (mode: "table" | "lines") => {
    setError("");
    try {
      setIncoming(
        mode === "table"
          ? tableToAgenda(
              document!.tables[tableIndex],
              { ...mapping, defaultDuration },
              locale,
              parseDuration,
            )
          : linesToAgenda(
              text,
              document?.name ?? t("Import de texte", "Text import"),
              locale,
              defaultDuration,
            ),
      );
    } catch (error) {
      setError(report(error));
    }
  };
  const ai = async () => {
    const id = ++requestId.current;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ session: Session }>("/import/agenda", {
        name: document?.name ?? "",
        text,
        locale,
        instructions,
      });
      if (id === requestId.current) setIncoming(result.session);
    } catch (error) {
      if (id === requestId.current) setError(report(error));
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };
  const apply = () => {
    if (!incoming) return;
    try {
      mergeImportedAgenda(session, incoming, { fillEmptyDays: true });
      update((current) =>
        mergeImportedAgenda(current, incoming, { fillEmptyDays: true }),
      );
      close();
    } catch (error) {
      setError(report(error));
    }
  };
  const modify = (
    id: string,
    change: Partial<Session["days"][number]["blocks"][number]>,
  ) =>
    setIncoming((current) =>
      current
        ? {
            ...current,
            days: current.days.map((day) => ({
              ...day,
              blocks: mapBlocks(day.blocks, (block) =>
                block.id === id ? { ...block, ...change } : block,
              ),
            })),
          }
        : null,
    );
  const table = document?.tables[tableIndex];
  const columnNames = table
    ? Array.from(
        {
          length: Math.max(
            0,
            ...table.rows.slice(0, 20).map((row) => row.length),
          ),
        },
        (_, index) =>
          mapping.header
            ? table.rows[0]?.[index] || `${t("Colonne", "Column")} ${index + 1}`
            : `${t("Colonne", "Column")} ${index + 1}`,
      )
    : [];
  const warnings: Record<string, string> = {
    IMPORT_FORMATTING_OMITTED: t(
      "Le texte est extrait ; vérifiez les tableaux et la mise en page.",
      "Text was extracted; review tables and layout.",
    ),
    IMPORT_FORMULAS_CACHED: t(
      "Les cellules utilisent les valeurs enregistrées dans le fichier. Les formules ne sont pas exécutées.",
      "Cells use saved values from the file. Formulas are not executed.",
    ),
    IMPORT_SCAN_NO_TEXT: t(
      "Ce PDF ne contient pas de texte extractible. Exportez les pages utiles en PNG/JPEG pour l’OCR du modèle interne.",
      "This PDF has no extractable text. Export relevant pages as PNG/JPEG to use internal-model OCR.",
    ),
    IMPORT_OCR_REVIEW: t(
      "Texte reconnu par le modèle interne : vérifiez les noms, les durées et les chiffres.",
      "Text recognized by the internal model: check names, durations and numbers.",
    ),
  };
  return (
    <Modal
      wide
      title={t("Importer un agenda", "Import an agenda")}
      subtitle={t(
        "Choisissez un document, vérifiez son contenu et ajoutez les nouveaux jours. Les champs importés restent privés.",
        "Choose a document, review its content and add new days. Imported fields stay private.",
      )}
      close={() => {
        requestId.current++;
        close();
      }}
    >
      <div className="document-import">
        {error && <ErrorBanner message={error} />} {busy && <Loading />}
        {!incoming && (
          <>
            <label className="file-drop">
              <FileUp size={28} />
              <span>
                {t(
                  "JSON MeetLoom, Word, PowerPoint, Excel, PDF, CSV, texte ou image · 5 Mo maximum",
                  "MeetLoom JSON, Word, PowerPoint, Excel, PDF, CSV, text or image · 5 MB maximum",
                )}
              </span>
              <input
                type="file"
                disabled={busy}
                accept=".json,.docx,.pptx,.xlsx,.pdf,.csv,.tsv,.txt,.md,.markdown,.png,.jpg,.jpeg"
                onChange={(event) => void inspect(event.target.files?.[0])}
              />
            </label>
            <p className="muted">
              {t(
                "Les fichiers sont traités temporairement. Les images nécessitent le modèle de vision interne ; les autres formats sont extraits localement sur le serveur.",
                "Files are processed temporarily. Images require the internal vision model; other formats are extracted locally on the server.",
              )}
            </p>
            {document?.warnings.map((warning) => (
              <p key={warning} role="status" className="import-notice">
                {warnings[warning] ?? warning}
              </p>
            ))}
            {!!document?.tables.length && (
              <section className="import-mapping">
                <h3>{t("Colonnes du document", "Document columns")}</h3>
                {document.tables.length > 1 && (
                  <label>
                    {t("Feuille", "Sheet")}
                    <select
                      value={tableIndex}
                      onChange={(event) =>
                        setTableIndex(Number(event.target.value))
                      }
                    >
                      {document.tables.map((table, index) => (
                        <option value={index} key={index}>
                          {table.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={mapping.header}
                    onChange={(event) =>
                      setMapping({ ...mapping, header: event.target.checked })
                    }
                  />
                  {t(
                    "La première ligne contient les titres des colonnes",
                    "First row contains column headings",
                  )}
                </label>
                <div className="import-columns">
                  {(
                    [
                      "title",
                      "duration",
                      "description",
                      "facilitator",
                      "section",
                    ] as const
                  ).map((key) => (
                    <label key={key}>
                      {
                        {
                          title: t("Titre", "Title"),
                          duration: t("Durée", "Duration"),
                          description: t("Description", "Description"),
                          facilitator: t("Responsable", "Facilitator"),
                          section: t("Section", "Section"),
                        }[key]
                      }
                      <select
                        value={mapping[key] ?? ""}
                        onChange={(event) =>
                          setMapping({
                            ...mapping,
                            [key]:
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value),
                          })
                        }
                      >
                        {key !== "title" && (
                          <option value="">{t("Ignorer", "Skip")}</option>
                        )}
                        {columnNames.map((name, index) => (
                          <option key={index} value={index}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="import-table-scroll">
                  <table>
                    <tbody>
                      {table?.rows.slice(0, 6).map((row, index) => (
                        <tr key={index}>
                          {row.map((cell, column) => (
                            <td key={column}>{cell.slice(0, 160)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => build("table")}
                >
                  {t(
                    "Prévisualiser les lignes de ce tableau",
                    "Preview rows from this table",
                  )}
                </button>
              </section>
            )}
            <label>
              {t(
                "Durée par défaut si absente (minutes)",
                "Default duration when missing (minutes)",
              )}
              <input
                type="number"
                min="0"
                max="1440"
                value={defaultDuration}
                onChange={(event) =>
                  setDefaultDuration(Number(event.target.value))
                }
              />
            </label>
            <label>
              {t(
                "Texte à convertir (modifiable)",
                "Text to convert (editable)",
              )}
              <textarea
                className="import-text"
                value={text}
                maxLength={DOCUMENT_MAX_TEXT}
                onChange={(event) => setText(event.target.value)}
                placeholder={t(
                  "Collez un agenda ou choisissez un fichier. Une ligne peut devenir un bloc.",
                  "Paste an agenda or choose a file. Each line can become a block.",
                )}
              />
            </label>
            <div className="import-actions">
              <button
                className="button secondary"
                disabled={!text.trim() || busy}
                onClick={() => build("lines")}
              >
                {t("Un bloc par ligne", "One block per line")}
              </button>
            </div>
            {enabled && (
              <section className="import-ai">
                <h3>
                  <Sparkles size={18} />
                  {t(
                    "Structurer avec l’IA interne",
                    "Structure with internal AI",
                  )}
                </h3>
                <p className="muted">
                  {t(
                    "En cliquant, vous transmettez ce texte au modèle interne configuré. Vous pourrez corriger sa proposition avant l’import.",
                    "Clicking sends this text to the configured internal model. You can edit its proposal before importing.",
                  )}
                </p>
                <label>
                  {t("Consignes facultatives", "Optional instructions")}
                  <textarea
                    value={instructions}
                    maxLength={4000}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder={t(
                      "Ex. conserver les temps annoncés et regrouper les sujets par thème.",
                      "E.g. preserve stated times and group related topics.",
                    )}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={!text.trim() || busy}
                  onClick={() => void ai()}
                >
                  <Sparkles size={16} />
                  {t("Proposer un agenda", "Propose an agenda")}
                </button>
              </section>
            )}
          </>
        )}
        {incoming && (
          <section className="import-review">
            <h3>{incoming.title}</h3>
            <p>
              {incoming.days.length} {t("jours", "days")} ·{" "}
              {incoming.days.reduce(
                (count, day) => count + allBlocks(day.blocks).length,
                0,
              )}{" "}
              {t("blocs à ajouter", "blocks to add")}
            </p>
            <p className="import-notice">
              {t(
                "Les descriptions, responsables et colonnes privées importés ne seront pas publiés aux visiteurs. Aucune modification existante ne sera écrasée.",
                "Imported private descriptions, facilitators and columns will not be published to visitors. Existing edits will be preserved.",
              )}
            </p>
            {incoming.days.map((day) => (
              <div key={day.id}>
                <h4>{day.title}</h4>
                {allBlocks(day.blocks).map((block) => (
                  <div className="import-block" key={block.id}>
                    <label>
                      {t("Titre", "Title")}
                      <input
                        value={block.title}
                        maxLength={200}
                        onChange={(event) =>
                          modify(block.id, { title: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("Minutes", "Minutes")}
                      <input
                        type="number"
                        min="0"
                        max="1440"
                        value={block.duration}
                        disabled={!!block.kind && block.kind !== "activity"}
                        onChange={(event) =>
                          modify(block.id, {
                            duration: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <details>
                      <summary>{t("Description", "Description")}</summary>
                      <textarea
                        value={richTextToPlain(block.description)}
                        maxLength={30000}
                        onChange={(event) =>
                          modify(block.id, { description: event.target.value })
                        }
                      />
                    </details>
                  </div>
                ))}
              </div>
            ))}
            <div className="import-actions">
              <button
                className="button secondary"
                onClick={() => setIncoming(null)}
              >
                <ArrowLeft size={16} />
                {t("Revenir au document", "Back to document")}
              </button>
              <button className="button primary" onClick={apply}>
                <Plus size={16} />
                {t("Ajouter à la séance", "Add to session")}
              </button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
