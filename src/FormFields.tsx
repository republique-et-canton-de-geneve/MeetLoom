import { useId, useRef } from "react";
import type { FormAnswers, FormQuestion, SessionForm } from "../shared/content";
import { RichText } from "./RichText";
import { useI18n } from "./i18n";
import { FormImageInput } from "./FormImageInput";
import "./content.css";

export function questionTypeLabel(
  type: FormQuestion["type"],
  t: (fr: string, en: string) => string,
) {
  return {
    short: t("Réponse courte", "Short answer"),
    long: t("Réponse longue", "Long answer"),
    single: t("Choix unique", "Single choice"),
    multiple: t("Choix multiples", "Multiple choices"),
    scale: t("Échelle", "Scale"),
    matrix: t("Matrice", "Matrix"),
    image: t("Image", "Image"),
  }[type];
}
export function FormFields({
  form,
  answers,
  onChange,
  errors = {},
  disabled = false,
  onPendingChange,
}: {
  form: SessionForm;
  answers: FormAnswers;
  onChange: (answers: FormAnswers) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { t } = useI18n(),
    prefix = useId();
  const pendingImages = useRef(new Set<string>());
  const latestAnswers = useRef(answers);
  latestAnswers.current = answers;
  return (
    <div className="form-fields">
      {form.questions.map((question, index) => {
        const value = answers[question.id];
        const set = (next: FormAnswers[string]) => {
          const updated = { ...latestAnswers.current, [question.id]: next };
          latestAnswers.current = updated;
          onChange(updated);
        };
        return (
          <fieldset
            key={question.id}
            id={`question-${question.id}`}
            disabled={disabled}
            className={`form-question ${errors[question.id] ? "has-error" : ""}`}
          >
            <legend>
              {index + 1}. {question.title}
              {question.required && (
                <span
                  className="required-mark"
                  aria-label={t("obligatoire", "required")}
                >
                  {" "}
                  *
                </span>
              )}
            </legend>
            {question.description && <RichText value={question.description} />}
            {question.type === "image" && (
              <FormImageInput
                value={value}
                onChange={set}
                label={question.title}
                disabled={disabled}
                onBusyChange={(busy) => {
                  if (busy) pendingImages.current.add(question.id);
                  else pendingImages.current.delete(question.id);
                  onPendingChange?.(pendingImages.current.size > 0);
                }}
              />
            )}
            {question.type === "short" && (
              <input
                type="text"
                value={typeof value === "string" ? value : ""}
                maxLength={1000}
                required={question.required}
                aria-label={question.title}
                onChange={(event) => set(event.target.value)}
              />
            )}
            {question.type === "long" && (
              <textarea
                value={typeof value === "string" ? value : ""}
                maxLength={10000}
                rows={5}
                required={question.required}
                aria-label={question.title}
                onChange={(event) => set(event.target.value)}
              />
            )}
            {(question.type === "single" || question.type === "multiple") && (
              <div className="question-options">
                {question.options.map((option) => (
                  <label key={option.id}>
                    <input
                      type={question.type === "single" ? "radio" : "checkbox"}
                      name={`${prefix}-${question.id}`}
                      value={option.id}
                      checked={
                        question.type === "single"
                          ? value === option.id
                          : Array.isArray(value) && value.includes(option.id)
                      }
                      onChange={(event) => {
                        if (question.type === "single") set(option.id);
                        else
                          set(
                            event.target.checked
                              ? [
                                  ...(Array.isArray(value) ? value : []),
                                  option.id,
                                ]
                              : (Array.isArray(value) ? value : []).filter(
                                  (item) => item !== option.id,
                                ),
                          );
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            )}
            {question.type === "scale" && (
              <>
                <div className="scale-options">
                  {Array.from(
                    { length: question.max - question.min + 1 },
                    (_, i) => i + question.min,
                  ).map((number) => (
                    <label key={number}>
                      <input
                        type="radio"
                        name={`${prefix}-${question.id}`}
                        checked={value === number}
                        onChange={() => set(number)}
                      />
                      <span>{number}</span>
                    </label>
                  ))}
                </div>
                <div className="scale-labels">
                  <span>{question.minLabel}</span>
                  <span>{question.maxLabel}</span>
                </div>
              </>
            )}
            {question.type === "matrix" && (
              <div className="matrix-wrap">
                <table className="question-matrix">
                  <thead>
                    <tr>
                      <th scope="col">{t("Aspect", "Aspect")}</th>
                      {question.options.map((option) => (
                        <th key={option.id} scope="col">
                          {option.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {question.rows.map((row) => (
                      <tr key={row.id}>
                        <th scope="row">{row.label}</th>
                        {question.options.map((option) => (
                          <td key={option.id}>
                            <input
                              type="radio"
                              name={`${prefix}-${question.id}-${row.id}`}
                              aria-label={`${row.label} — ${option.label}`}
                              checked={
                                typeof value === "object" &&
                                !Array.isArray(value) &&
                                value !== null &&
                                value[row.id] === option.id
                              }
                              onChange={() =>
                                set({
                                  ...(typeof value === "object" &&
                                  !Array.isArray(value) &&
                                  value !== null
                                    ? value
                                    : {}),
                                  [row.id]: option.id,
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {errors[question.id] && (
              <p role="alert" className="field-error">
                {errors[question.id] === "INVALID_IMAGE"
                  ? t(
                      "Image invalide ou trop volumineuse : maximum 256 Ko par image et 512 Ko au total.",
                      "Invalid or oversized image: maximum 256 KB per image and 512 KB in total.",
                    )
                  : errors[question.id] === "REQUIRED"
                    ? t(
                        "Cette question est obligatoire.",
                        "This question is required.",
                      )
                    : t(
                        "Vérifiez cette réponse et complétez toutes les lignes requises.",
                        "Check this answer and complete all required rows.",
                      )}
              </p>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
