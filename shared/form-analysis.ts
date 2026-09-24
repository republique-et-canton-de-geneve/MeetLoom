import type { FormQuestion, FormResponse } from "./content.js";
import { richTextToPlain } from "./richtext.js";
/** No respondent account, email, response ID or submission time enters the AI context. */
export function formResponseContext(response: FormResponse) {
  const label = (question: FormQuestion, value: unknown): unknown => {
    if (question.type === "image")
      return value ? "[Image response: omitted from text analysis]" : "";
    if (
      (question.type === "single" || question.type === "multiple") &&
      "options" in question
    ) {
      const option = (id: unknown) =>
        question.options.find((option) => option.id === id)?.label ?? "";
      return Array.isArray(value) ? value.map(option) : option(value);
    }
    if (question.type === "matrix" && typeof value === "object" && value) {
      return question.rows.map((row) => ({
        row: row.label,
        answer:
          question.options.find(
            (option) =>
              option.id === (value as Record<string, unknown>)[row.id],
          )?.label ?? "",
      }));
    }
    return typeof value === "string" ? richTextToPlain(value) : (value ?? "");
  };
  return {
    questions: response.definition.questions.map((question) => ({
      question: question.title,
      type: question.type,
      answer: label(question, response.answers[question.id]),
    })),
  };
}
export interface FormAiSummary {
  summary: string;
  included: number;
  total: number;
  partial: boolean;
}
