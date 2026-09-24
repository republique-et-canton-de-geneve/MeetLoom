import type { FormQuestion, FormResponse } from "../shared/content";
import { useI18n } from "./i18n";

export function FormResponseSummary({
  responses,
  total,
}: {
  responses: FormResponse[];
  total: number;
}) {
  const { t } = useI18n();
  const questions = new Map<string, FormQuestion>();
  for (const response of responses)
    for (const question of response.definition.questions)
      if (!questions.has(question.id)) questions.set(question.id, question);
  return responses.length > 0 ? (
    <section className="response-overview">
      <h3>{t("Synthèse", "Summary")}</h3>
      <p className="muted">
        {responses.length} / {total}{" "}
        {t("réponses chargées", "loaded responses")}
      </p>
      {[...questions.values()]
        .filter(
          (question) => question.type !== "short" && question.type !== "long",
        )
        .map((question) => {
          const values = responses
            .filter((response) =>
              response.definition.questions.some(
                (value) =>
                  value.id === question.id && value.type === question.type,
              ),
            )
            .map((response) => response.answers[question.id])
            .filter((value) => value !== undefined);
          return (
            <section className="response-question-summary" key={question.id}>
              <h4>{question.title}</h4>
              {question.type === "image" && (
                <p>
                  {values.length}{" "}
                  {t(
                    "image(s) reçue(s) — ouvrir une réponse pour les consulter.",
                    "image response(s) — open a response to view them.",
                  )}
                </p>
              )}
              {(question.type === "single" || question.type === "multiple") &&
                question.options.map((option) => {
                  const count = values.filter(
                    (value) =>
                      value === option.id ||
                      (Array.isArray(value) && value.includes(option.id)),
                  ).length;
                  return (
                    <div className="response-count" key={option.id}>
                      <span>{option.label}</span>
                      <meter
                        min={0}
                        max={Math.max(1, values.length)}
                        value={count}
                      />
                      <strong>{count}</strong>
                    </div>
                  );
                })}
              {question.type === "scale" && (
                <p>
                  {t("Moyenne", "Average")} :{" "}
                  <strong>
                    {values.length
                      ? (
                          values.reduce<number>(
                            (sum, value) =>
                              sum + (typeof value === "number" ? value : 0),
                            0,
                          ) / values.length
                        ).toFixed(2)
                      : "—"}
                  </strong>{" "}
                  / {question.max} · {values.length}{" "}
                  {t("réponses", "responses")}
                </p>
              )}
              {question.type === "matrix" && (
                <div className="matrix-wrap">
                  <table className="question-matrix">
                    <thead>
                      <tr>
                        <th>{t("Aspect", "Aspect")}</th>
                        {question.options.map((option) => (
                          <th key={option.id}>{option.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {question.rows.map((row) => (
                        <tr key={row.id}>
                          <th>{row.label}</th>
                          {question.options.map((option) => (
                            <td key={option.id}>
                              {
                                values.filter(
                                  (value) =>
                                    typeof value === "object" &&
                                    !Array.isArray(value) &&
                                    value !== null &&
                                    value[row.id] === option.id,
                                ).length
                              }
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
    </section>
  ) : null;
}
