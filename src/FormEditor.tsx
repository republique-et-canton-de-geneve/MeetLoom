import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Plus,
  RotateCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { Session } from "../shared/model";
import {
  newQuestion,
  type FormAnswers,
  type FormPublication,
  type FormQuestion,
  type FormResponse,
  type SessionForm,
} from "../shared/content";
import { api, download, post } from "./api";
import { ErrorBanner, Loading } from "./ui";
import { RichTextEditor } from "./RichTextEditor";
import { RichText } from "./RichText";
import { FormFields, questionTypeLabel } from "./FormFields";
import { answerLabel, exportResponsesCsv } from "./form-export";
import { useI18n } from "./i18n";
import { QRCode } from "./QRCode";
import { FormResponseSummary } from "./FormResponseSummary";
import { FormAiSummary } from "./FormAiSummary";
import { isStoredFormImage } from "../shared/form-images";
import "./content.css";

export interface FormEditorProps {
  session: Session;
  formId: string;
  editable: boolean;
  aiEnabled?: boolean;
  update: (change: (session: Session) => Session) => void;
  flush: () => Promise<Session>;
}
type ResponsePage = {
  responses: FormResponse[];
  total: number;
  nextOffset: number | null;
};
export default function FormEditor({
  session,
  formId,
  editable,
  aiEnabled = false,
  update,
  flush,
}: FormEditorProps) {
  const { t, locale } = useI18n(),
    [tab, setTab] = useState<"edit" | "preview" | "share" | "responses">(
      "edit",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [publication, setPublication] = useState<FormPublication | null>(null),
    [link, setLink] = useState(""),
    [preview, setPreview] = useState<FormAnswers>({}),
    [responses, setResponses] = useState<FormResponse[]>([]),
    [total, setTotal] = useState(0),
    [nextOffset, setNextOffset] = useState<number | null>(null),
    [loading, setLoading] = useState(false),
    [expanded, setExpanded] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const form = session.forms?.find((value) => value.id === formId),
    base = `/sessions/${encodeURIComponent(session.id)}/forms/${encodeURIComponent(formId)}`;
  const change = (fn: (form: SessionForm) => SessionForm) =>
    update((current) => ({
      ...current,
      forms: current.forms?.map((value) =>
        value.id === formId ? fn(value) : value,
      ),
    }));
  useEffect(() => {
    setTab("edit");
    setError("");
    setPublication(null);
    setLink("");
    setPreview({});
    setResponses([]);
    setTotal(0);
    setNextOffset(null);
    setNotice("");
  }, [formId]);
  useEffect(() => {
    if (tab !== "share" || !editable) return;
    let active = true;
    setLoading(true);
    void api<{ publication: FormPublication | null }>(`${base}/publication`)
      .then((data) => {
        if (active) setPublication(data.publication);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, editable, tab]);
  const fetchResponses = async (offset = 0) => {
    setLoading(true);
    setError("");
    try {
      const data = await api<ResponsePage>(
        `${base}/responses?offset=${offset}`,
      );
      setResponses((prior) =>
        offset ? [...prior, ...data.responses] : data.responses,
      );
      setTotal(data.total);
      setNextOffset(data.nextOffset);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("Chargement impossible", "Could not load"),
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (tab === "responses" && editable) void fetchResponses();
  }, [base, editable, tab]);
  if (!form) return <p>{t("Formulaire introuvable", "Form not found")}</p>;
  const publish = async (action: "publish" | "unpublish" | "rotate") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await flush();
      const data = await post<{ publication: FormPublication }>(
        `${base}/${action}`,
        { version: saved.version },
      );
      setPublication(data.publication);
      if (data.publication.token)
        setLink(`${window.location.origin}/f/${data.publication.token}`);
      setNotice(
        action === "publish"
          ? t(
              "La version enregistrée du formulaire est publiée. Les modifications suivantes restent un brouillon jusqu’à la prochaine publication.",
              "The saved form is published. Subsequent edits stay in the draft until you publish again.",
            )
          : action === "unpublish"
            ? t(
                "Le formulaire est fermé. Les réponses existantes sont conservées.",
                "The form is closed. Existing responses are retained.",
              )
            : t(
                "Le lien a été renouvelé ; le précédent est révoqué.",
                "The link was renewed; the previous one is revoked.",
              ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("Action impossible", "Action failed"),
      );
    } finally {
      setBusy(false);
    }
  };
  const changeQuestion = (
    id: string,
    fn: (question: FormQuestion) => FormQuestion,
  ) =>
    change((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        question.id === id ? fn(question) : question,
      ),
    }));
  const move = (index: number, direction: number) =>
    change((current) => {
      const questions = [...current.questions],
        destination = index + direction;
      if (destination < 0 || destination >= questions.length) return current;
      [questions[index], questions[destination]] = [
        questions[destination],
        questions[index],
      ];
      return { ...current, questions };
    });
  const exportAll = async (exportCsv = true) => {
    setBusy(true);
    setError("");
    try {
      let offset: number | null = 0;
      const all: FormResponse[] = [];
      while (offset !== null) {
        const page: ResponsePage = await api<ResponsePage>(
          `${base}/responses?offset=${offset}`,
        );
        all.push(...page.responses);
        offset = page.nextOffset;
      }
      setResponses(all);
      setNextOffset(null);
      if (exportCsv)
        download(
          "form-responses.csv",
          exportResponsesCsv(all, locale),
          "text/csv;charset=utf-8",
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("Export impossible", "Export failed"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="content-page form-editor">
      <div className="content-heading">
        <div>
          <p className="eyebrow">{t("Formulaire de séance", "Session form")}</p>
          {editable ? (
            <input
              className="content-title-input"
              value={form.title}
              maxLength={200}
              aria-label={t("Titre du formulaire", "Form title")}
              onChange={(event) =>
                change((current) => ({ ...current, title: event.target.value }))
              }
            />
          ) : (
            <h1>{form.title}</h1>
          )}
        </div>
        <span className="content-status">
          {publication?.enabled
            ? t("Version publiée disponible", "Published version available")
            : t("Version de travail", "Working version")}
        </span>
      </div>
      <nav
        className="content-tabs"
        aria-label={t("Outils du formulaire", "Form tools")}
      >
        {(
          [
            "edit",
            "preview",
            ...(editable ? ["share", "responses"] : []),
          ] as const
        ).map((item) => (
          <button
            key={item}
            className={tab === item ? "active" : ""}
            aria-current={tab === item ? "page" : undefined}
            onClick={() => setTab(item as typeof tab)}
          >
            {
              {
                edit: t("Questions", "Questions"),
                preview: t("Aperçu", "Preview"),
                share: t("Publication", "Publication"),
                responses: t("Réponses", "Responses"),
              }[item as typeof tab]
            }
          </button>
        ))}
      </nav>
      {error && <ErrorBanner message={error} />}{" "}
      {notice && (
        <p role="status" className="content-notice">
          {notice}
        </p>
      )}
      {tab === "edit" && (
        <>
          <label>
            {t("Introduction", "Introduction")}
            <RichTextEditor
              value={form.description}
              disabled={!editable}
              ariaLabel={t("Introduction du formulaire", "Form introduction")}
              onChange={(description) =>
                change((current) => ({ ...current, description }))
              }
            />
          </label>
          {form.questions.map((question, index) => (
            <section
              className="question-editor"
              key={question.id}
              id={`question-${question.id}`}
            >
              <div className="question-editor-header">
                <strong>
                  {index + 1}. {questionTypeLabel(question.type, t)}
                </strong>
                <div>
                  {editable && (
                    <>
                      <button
                        className="icon-button"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        title={t("Monter", "Move up")}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={index === form.questions.length - 1}
                        onClick={() => move(index, 1)}
                        title={t("Descendre", "Move down")}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        className="icon-button danger-text"
                        title={t("Supprimer la question", "Delete question")}
                        onClick={() =>
                          change((current) => ({
                            ...current,
                            questions: current.questions.filter(
                              (item) => item.id !== question.id,
                            ),
                          }))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                  <button
                    className="icon-button"
                    title={t(
                      "Copier le lien de question",
                      "Copy question link",
                    )}
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.hash = `form=${form.id}&question=${question.id}`;
                      void navigator.clipboard
                        .writeText(url.href)
                        .then(() => setNotice(t("Lien copié", "Link copied")))
                        .catch(() => setNotice(url.href));
                    }}
                  >
                    <Copy size={15} />
                  </button>
                </div>
              </div>
              <label>
                {t("Question", "Question")}
                <input
                  value={question.title}
                  maxLength={200}
                  disabled={!editable}
                  onChange={(event) =>
                    changeQuestion(question.id, (current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <RichTextEditor
                value={question.description}
                disabled={!editable}
                ariaLabel={t("Aide pour la question", "Question help")}
                placeholder={t(
                  "Précisions facultatives…",
                  "Optional guidance…",
                )}
                onChange={(description) =>
                  changeQuestion(question.id, (current) => ({
                    ...current,
                    description,
                  }))
                }
              />
              {"options" in question && (
                <OptionEditor
                  title={t("Choix proposés", "Available choices")}
                  items={question.options}
                  editable={editable}
                  change={(options) =>
                    changeQuestion(question.id, (current) =>
                      "options" in current ? { ...current, options } : current,
                    )
                  }
                />
              )}
              {question.type === "matrix" && (
                <OptionEditor
                  title={t("Lignes à évaluer", "Rows to rate")}
                  items={question.rows}
                  editable={editable}
                  change={(rows) =>
                    changeQuestion(question.id, (current) =>
                      current.type === "matrix"
                        ? { ...current, rows }
                        : current,
                    )
                  }
                />
              )}
              {question.type === "scale" && (
                <div className="scale-settings">
                  <label>
                    {t("Minimum", "Minimum")}
                    <input
                      type="number"
                      min={0}
                      max={question.max - 1}
                      value={question.min}
                      disabled={!editable}
                      onChange={(event) =>
                        changeQuestion(question.id, (current) =>
                          current.type === "scale"
                            ? { ...current, min: Number(event.target.value) }
                            : current,
                        )
                      }
                    />
                  </label>
                  <label>
                    {t("Maximum", "Maximum")}
                    <input
                      type="number"
                      min={question.min + 1}
                      max={10}
                      value={question.max}
                      disabled={!editable}
                      onChange={(event) =>
                        changeQuestion(question.id, (current) =>
                          current.type === "scale"
                            ? { ...current, max: Number(event.target.value) }
                            : current,
                        )
                      }
                    />
                  </label>
                  <label>
                    {t("Libellé minimum", "Minimum label")}
                    <input
                      value={question.minLabel}
                      maxLength={100}
                      disabled={!editable}
                      onChange={(event) =>
                        changeQuestion(question.id, (current) =>
                          current.type === "scale"
                            ? { ...current, minLabel: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                  <label>
                    {t("Libellé maximum", "Maximum label")}
                    <input
                      value={question.maxLabel}
                      maxLength={100}
                      disabled={!editable}
                      onChange={(event) =>
                        changeQuestion(question.id, (current) =>
                          current.type === "scale"
                            ? { ...current, maxLabel: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>
                </div>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={question.required}
                  disabled={!editable}
                  onChange={(event) =>
                    changeQuestion(question.id, (current) => ({
                      ...current,
                      required: event.target.checked,
                    }))
                  }
                />
                {t("Réponse obligatoire", "Required answer")}
              </label>
            </section>
          ))}
          {editable && form.questions.length < 100 && (
            <div className="add-question-options">
              {(
                [
                  "short",
                  "long",
                  "single",
                  "multiple",
                  "scale",
                  "matrix",
                  "image",
                ] as const
              ).map((type) => (
                <button
                  className="button secondary"
                  key={type}
                  onClick={() =>
                    change((current) => ({
                      ...current,
                      questions: [
                        ...current.questions,
                        newQuestion(type, locale),
                      ],
                    }))
                  }
                >
                  <Plus size={15} />
                  {questionTypeLabel(type, t)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {tab === "preview" && (
        <>
          <p className="content-notice">
            <Eye size={16} />
            {t(
              "Aperçu du brouillon. Aucune réponse n’est enregistrée ici.",
              "Draft preview. No response is recorded here.",
            )}
          </p>
          <h2>{form.title}</h2>
          <RichText value={form.description} />
          <FormFields form={form} answers={preview} onChange={setPreview} />
        </>
      )}
      {tab === "share" && (
        <div className="form-sharing">
          {loading ? (
            <Loading />
          ) : (
            <>
              <h2>{t("Publier une version", "Publish a version")}</h2>
              <p>
                {t(
                  "Le lien donne accès uniquement à la version publiée de ce formulaire. Les réponses restent accessibles aux organisateurs et éditeurs de la séance.",
                  "The link grants access only to the published version of this form. Responses remain available to session owners and editors.",
                )}
              </p>
              <label>
                {t("Identité des répondants", "Respondent identity")}
                <select
                  value={form.identityMode}
                  disabled={busy}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      identityMode: event.target
                        .value as SessionForm["identityMode"],
                    }))
                  }
                >
                  <option value="automatic">
                    {t(
                      "Comptes connectés identifiés, autres anonymes",
                      "Identify signed-in accounts; others anonymous",
                    )}
                  </option>
                  <option value="optional">
                    {t(
                      "Laisser les comptes connectés choisir",
                      "Let signed-in accounts choose",
                    )}
                  </option>
                  <option value="anonymous">
                    {t("Toujours anonyme", "Always anonymous")}
                  </option>
                </select>
              </label>
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={busy || !form.questions.length}
                  onClick={() => void publish("publish")}
                >
                  <Send size={16} />
                  {publication?.enabled
                    ? t("Publier les modifications", "Publish changes")
                    : t("Publier", "Publish")}
                </button>
                {publication?.enabled && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void publish("unpublish")}
                  >
                    <X size={16} />
                    {t("Fermer le formulaire", "Close form")}
                  </button>
                )}
                {publication && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void publish("rotate")}
                  >
                    <RotateCw size={16} />
                    {t("Renouveler le lien", "Renew link")}
                  </button>
                )}
              </div>
              {link ? (
                <div className="form-published-link">
                  <label>
                    {t("Lien du formulaire", "Form link")}
                    <input
                      value={link}
                      readOnly
                      onFocus={(event) => event.target.select()}
                    />
                  </label>
                  <button
                    className="button secondary"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(link)
                        .then(() => setNotice(t("Lien copié", "Link copied")))
                        .catch(() =>
                          setNotice(
                            t(
                              "Sélectionnez le lien pour le copier.",
                              "Select the link to copy it.",
                            ),
                          ),
                        )
                    }
                  >
                    <Copy size={15} />
                    {t("Copier", "Copy")}
                  </button>
                  <a
                    className="button secondary"
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={15} />
                    {t("Ouvrir", "Open")}
                  </a>
                </div>
              ) : (
                publication && (
                  <p className="muted">
                    {t(
                      "Le lien secret est affiché uniquement lors de sa création. Si vous ne l’avez plus, renouvelez-le ; l’ancien lien sera révoqué.",
                      "The secret link is displayed only when created. Renew it if you no longer have it; the old link will be revoked.",
                    )}
                  </p>
                )
              )}
              {link && (
                <QRCode
                  value={link}
                  label={t("QR code du formulaire", "Form QR code")}
                />
              )}
            </>
          )}
        </div>
      )}
      {tab === "responses" && (
        <>
          <div className="content-heading">
            <h2>
              {total} {t("réponses", "responses")}
            </h2>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={loading}
                onClick={() => void fetchResponses()}
              >
                <RotateCw size={15} />
                {t("Actualiser", "Refresh")}
              </button>
              <button
                className="button secondary"
                disabled={busy || !total}
                onClick={() => void exportAll()}
              >
                <Download size={15} />
                CSV
              </button>
            </div>
          </div>
          <FormResponseSummary responses={responses} total={total} />
          {aiEnabled && (
            <FormAiSummary
              key={formId}
              sessionId={session.id}
              formId={formId}
              enabled={aiEnabled}
              total={total}
            />
          )}
          {responses.length < total && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void exportAll(false)}
            >
              {t(
                "Charger toutes les réponses pour la synthèse",
                "Load all responses for summary",
              )}
            </button>
          )}
          {responses.map((response) => (
            <section className="response-card" key={response.id}>
              <button
                className="response-summary"
                onClick={() =>
                  setExpanded(expanded === response.id ? null : response.id)
                }
                aria-expanded={expanded === response.id}
              >
                <span>
                  <strong>
                    {response.respondent?.name ?? t("Anonyme", "Anonymous")}
                  </strong>
                  {response.respondent?.email && (
                    <small>{response.respondent.email}</small>
                  )}
                </span>
                <span>
                  {new Date(response.createdAt).toLocaleString(locale)} · v
                  {response.revision}
                </span>
              </button>
              {expanded === response.id && (
                <dl>
                  {response.definition.questions.map((question) => (
                    <div key={question.id}>
                      <dt>{question.title}</dt>
                      <dd>
                        {question.type === "image" &&
                        isStoredFormImage(response.answers[question.id]) ? (
                          <a
                            href={`/api${base}/responses/${encodeURIComponent(response.id)}/images/${encodeURIComponent(question.id)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              loading="lazy"
                              src={`/api${base}/responses/${encodeURIComponent(response.id)}/images/${encodeURIComponent(question.id)}`}
                              alt={question.title}
                              style={{ maxWidth: "100%", maxHeight: 320 }}
                            />
                          </a>
                        ) : (
                          answerLabel(
                            question,
                            response.answers[question.id],
                          ) || "—"
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}
          {loading && <Loading />}
          {nextOffset !== null && (
            <button
              className="button secondary"
              disabled={loading}
              onClick={() => void fetchResponses(nextOffset)}
            >
              {t("Charger la suite", "Load more")}
            </button>
          )}
          {!loading && !total && (
            <p className="empty-state">
              {t(
                "Les réponses apparaîtront ici après publication et envoi.",
                "Responses will appear here after publication and submission.",
              )}
            </p>
          )}
        </>
      )}
    </article>
  );
}
function OptionEditor({
  title,
  items,
  editable,
  change,
}: {
  title: string;
  items: { id: string; label: string }[];
  editable: boolean;
  change: (items: { id: string; label: string }[]) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="option-editor">
      <strong>{title}</strong>
      {items.map((item, index) => (
        <div className="option-editor-row" key={item.id}>
          <input
            value={item.label}
            disabled={!editable}
            maxLength={300}
            aria-label={`${title} ${index + 1}`}
            onChange={(event) =>
              change(
                items.map((value) =>
                  value.id === item.id
                    ? { ...value, label: event.target.value }
                    : value,
                ),
              )
            }
          />
          {editable && (
            <button
              className="icon-button"
              disabled={items.length <= 1}
              title={t("Supprimer", "Delete")}
              onClick={() =>
                change(items.filter((value) => value.id !== item.id))
              }
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {editable && items.length < 30 && (
        <button
          className="button ghost small"
          onClick={() =>
            change([
              ...items,
              {
                id: crypto.randomUUID(),
                label: `${t("Choix", "Choice")} ${items.length + 1}`,
              },
            ])
          }
        >
          <Plus size={14} />
          {t("Ajouter", "Add")}
        </button>
      )}
    </div>
  );
}
