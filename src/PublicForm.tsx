import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import {
  validateFormAnswers,
  type FormAnswers,
  type PublicFormData,
} from "../shared/content";
import { api, post, ApiError } from "./api";
import { Brand, ErrorBanner, LanguageSwitch, Loading } from "./ui";
import { RichText } from "./RichText";
import { FormFields } from "./FormFields";
import { useI18n } from "./i18n";
import "./content.css";
import "./richtext.css";

export default function PublicForm({
  token,
  endpoint,
  embedded = false,
}: {
  token: string;
  endpoint?: string;
  embedded?: boolean;
}) {
  const path = endpoint ?? `/forms/${encodeURIComponent(token)}`;
  const { t } = useI18n(),
    [data, setData] = useState<PublicFormData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [answers, setAnswers] = useState<FormAnswers>({}),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [shareIdentity, setShareIdentity] = useState(false),
    [busy, setBusy] = useState(false),
    [preparingImages, setPreparingImages] = useState(false),
    [sent, setSent] = useState(false),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const submissionId = useRef(crypto.randomUUID());
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setNeedsRefresh(false);
    setData(null);
    setSent(false);
    setAnswers({});
    setBusy(false);
    setPreparingImages(false);
    setErrors({});
    setShareIdentity(false);
    submissionId.current = crypto.randomUUID();
    void api<PublicFormData>(path, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : t("Formulaire indisponible", "Form unavailable"),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [path, reload]);
  const identified =
    !!data?.identity &&
    (data.form.identityMode === "automatic" ||
      (data.form.identityMode === "optional" && shareIdentity));
  return (
    <section className={`public-form-page ${embedded ? "embedded-form" : ""}`}>
      {!embedded && (
        <header className="public-form-header">
          <Brand />
          <LanguageSwitch />
        </header>
      )}
      <div className="public-form-body">
        {loading && <Loading />}
        {error && (
          <ErrorBanner
            message={error}
            retry={data ? undefined : () => setReload((value) => value + 1)}
          />
        )}
        {needsRefresh && (
          <button
            className="button secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            {t(
              "Recharger le formulaire et recommencer les réponses",
              "Reload the form and restart answers",
            )}
          </button>
        )}
        {sent ? (
          <section className="form-success" role="status">
            <CheckCircle2 size={38} />
            <h1>
              {t("Merci pour votre réponse", "Thank you for your response")}
            </h1>
            <p>
              {t(
                "Votre retour a bien été enregistré. Vous pouvez fermer cette page.",
                "Your feedback has been recorded. You can close this page.",
              )}
            </p>
          </section>
        ) : (
          data && (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || preparingImages || needsRefresh) return;
                const current = generation.current;
                const checked = validateFormAnswers(data.form, answers);
                setErrors(checked.errors);
                if (Object.keys(checked.errors).length) {
                  setTimeout(
                    () =>
                      document
                        .querySelector<HTMLElement>(".form-question.has-error")
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        }),
                    0,
                  );
                  return;
                }
                setBusy(true);
                setError("");
                void post(`${path}/responses`, {
                  revision: data.revision,
                  submissionId: submissionId.current,
                  answers: checked.answers,
                  shareIdentity,
                })
                  .then(() => {
                    if (current === generation.current) setSent(true);
                  })
                  .catch((cause) => {
                    if (current !== generation.current) return;
                    setNeedsRefresh(
                      cause instanceof ApiError &&
                        cause.code === "FORM_CHANGED",
                    );
                    setError(
                      cause instanceof ApiError && cause.code === "FORM_CHANGED"
                        ? t(
                            "Le formulaire a changé. Rechargez-le pour répondre à sa dernière version.",
                            "This form changed. Reload it to answer its latest version.",
                          )
                        : cause instanceof Error
                          ? cause.message
                          : t("Envoi impossible", "Could not submit"),
                    );
                  })
                  .finally(() => {
                    if (current === generation.current) setBusy(false);
                  });
              }}
            >
              <p className="eyebrow">{data.sessionTitle}</p>
              <h1>{data.form.title}</h1>
              <RichText value={data.form.description} />
              <p className="muted">
                {t(
                  "Les questions marquées * sont obligatoires.",
                  "Questions marked * are required.",
                )}
              </p>
              <FormFields
                form={data.form}
                answers={answers}
                onChange={setAnswers}
                errors={errors}
                disabled={busy}
                onPendingChange={setPreparingImages}
              />
              <div className="form-identity">
                <strong>
                  {t("Identité de cette réponse", "Identity for this response")}
                </strong>
                {data.form.identityMode === "optional" && data.identity && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={shareIdentity}
                      disabled={busy}
                      onChange={(event) =>
                        setShareIdentity(event.target.checked)
                      }
                    />
                    {t(
                      "Joindre mon identité à ma réponse",
                      "Include my identity with my response",
                    )}
                  </label>
                )}
                <p>
                  {identified
                    ? `${data.identity!.name} · ${data.identity!.email}`
                    : t(
                        "Anonyme — aucun nom ni compte ne sera enregistré avec votre réponse.",
                        "Anonymous — no name or account will be stored with your response.",
                      )}
                </p>
              </div>
              <button
                className="button primary"
                type="submit"
                disabled={busy || preparingImages || needsRefresh}
              >
                <Send size={16} />
                {preparingImages
                  ? t("Préparation de l’image…", "Preparing image…")
                  : busy
                    ? t("Envoi…", "Submitting…")
                    : t("Envoyer ma réponse", "Submit my response")}
              </button>
            </form>
          )
        )}
      </div>
    </section>
  );
}
