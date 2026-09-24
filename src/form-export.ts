import type { Answer, FormQuestion, FormResponse } from "../shared/content";
import type { Locale } from "../shared/model";
import { csvCell } from "./export";

export function answerLabel(
  question: FormQuestion,
  value: Answer | undefined,
): string {
  if (value === undefined) return "";
  if (question.type === "image") return "[Image]";
  if (question.type === "single" || question.type === "multiple") {
    const ids = Array.isArray(value) ? value : [value];
    return ids
      .map(
        (id) =>
          question.options.find((option) => option.id === id)?.label ??
          String(id),
      )
      .join(" · ");
  }
  if (
    question.type === "matrix" &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    return question.rows
      .flatMap((row) =>
        Object.hasOwn(value, row.id)
          ? [
              `${row.label}: ${question.options.find((option) => option.id === value[row.id])?.label ?? value[row.id]}`,
            ]
          : [],
      )
      .join("\n");
  return String(value);
}
export function exportResponsesCsv(
  responses: FormResponse[],
  locale: Locale,
): string {
  const questions = new Map<string, string>();
  for (const response of responses)
    for (const question of response.definition.questions)
      if (!questions.has(question.id))
        questions.set(question.id, question.title);
  const rows: Array<Array<string | number>> = [
    [
      locale === "fr" ? "Date" : "Date",
      locale === "fr" ? "Répondant" : "Respondent",
      "Email",
      locale === "fr" ? "Version" : "Revision",
      ...questions.values(),
    ],
  ];
  for (const response of responses)
    rows.push([
      response.createdAt,
      response.respondent?.name ?? (locale === "fr" ? "Anonyme" : "Anonymous"),
      response.respondent?.email ?? "",
      response.revision,
      ...[...questions.keys()].map((id) => {
        const question = response.definition.questions.find(
          (value) => value.id === id,
        );
        return question ? answerLabel(question, response.answers[id]) : "";
      }),
    ]);
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
