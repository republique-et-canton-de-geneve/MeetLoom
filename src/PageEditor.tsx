import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Printer, Trash2 } from "lucide-react";
import type { SessionPage } from "../shared/content";
import { RichTextEditor } from "./RichTextEditor";
import { RichText } from "./RichText";
import { useI18n } from "./i18n";
import "./content.css";

export function PageView({ page }: { page: SessionPage }) {
  return (
    <article className="content-page">
      <h1>{page.title}</h1>
      {page.sections.map((section) => (
        <section
          key={section.id}
          id={`section-${section.id}`}
          className="page-section"
        >
          <RichText value={section.content} />
        </section>
      ))}
    </article>
  );
}
export function PageEditor({
  page,
  editable,
  onChange,
}: {
  page: SessionPage;
  editable: boolean;
  onChange: (page: SessionPage) => void;
}) {
  const { t } = useI18n(),
    [message, setMessage] = useState("");
  const move = (index: number, direction: number) => {
    const sections = [...page.sections];
    const destination = index + direction;
    if (destination < 0 || destination >= sections.length) return;
    [sections[index], sections[destination]] = [
      sections[destination],
      sections[index],
    ];
    onChange({ ...page, sections });
  };
  return (
    <article className="content-page page-editor">
      <div className="content-heading">
        <div>
          <p className="eyebrow">
            {t("Document de séance", "Session document")}
          </p>
          {editable ? (
            <input
              className="content-title-input"
              value={page.title}
              maxLength={200}
              aria-label={t("Titre de la page", "Page title")}
              onChange={(event) =>
                onChange({ ...page, title: event.target.value })
              }
            />
          ) : (
            <h1>{page.title}</h1>
          )}
        </div>
        <button className="button secondary" onClick={() => window.print()}>
          <Printer size={16} />
          {t("Imprimer / PDF", "Print / PDF")}
        </button>
      </div>
      {editable && (
        <label className="content-audience">
          {t("Visible par", "Visible to")}
          <select
            value={page.visibility}
            onChange={(event) =>
              onChange({
                ...page,
                visibility: event.target.value as SessionPage["visibility"],
              })
            }
          >
            <option value="team">{t("Équipe uniquement", "Team only")}</option>
            <option value="public">
              {t("Équipe et lien visiteur", "Team and visitor link")}
            </option>
          </select>
        </label>
      )}
      {message && (
        <p role="status" className="muted">
          {message}
        </p>
      )}
      {page.sections.map((section, index) => (
        <section
          className="page-section"
          id={`section-${section.id}`}
          key={section.id}
        >
          <div className="page-section-actions">
            <span>
              {t("Section", "Section")} {index + 1}
            </span>
            <button
              className="icon-button"
              title={t("Copier le lien direct", "Copy direct link")}
              onClick={() => {
                const link = new URL(window.location.href);
                link.hash = `page=${encodeURIComponent(page.id)}&section=${encodeURIComponent(section.id)}`;
                void navigator.clipboard
                  .writeText(link.href)
                  .then(() =>
                    setMessage(
                      t("Lien de section copié", "Section link copied"),
                    ),
                  )
                  .catch(() => setMessage(link.href));
              }}
            >
              <Copy size={14} />
            </button>
            {editable && (
              <>
                <button
                  className="icon-button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  title={t("Monter", "Move up")}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="icon-button"
                  disabled={index === page.sections.length - 1}
                  onClick={() => move(index, 1)}
                  title={t("Descendre", "Move down")}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  className="icon-button danger-text"
                  onClick={() =>
                    onChange({
                      ...page,
                      sections: page.sections.filter(
                        (item) => item.id !== section.id,
                      ),
                    })
                  }
                  title={t("Supprimer la section", "Delete section")}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
          <RichTextEditor
            value={section.content}
            onChange={(content) =>
              onChange({
                ...page,
                sections: page.sections.map((item) =>
                  item.id === section.id ? { ...item, content } : item,
                ),
              })
            }
            disabled={!editable}
            ariaLabel={`${t("Section", "Section")} ${index + 1}`}
            placeholder={t(
              "Brief, objectifs, compte rendu…",
              "Brief, goals, report…",
            )}
          />
        </section>
      ))}
      {editable && page.sections.length < 100 && (
        <button
          className="button secondary"
          onClick={() =>
            onChange({
              ...page,
              sections: [
                ...page.sections,
                { id: crypto.randomUUID(), content: "" },
              ],
            })
          }
        >
          <Plus size={16} />
          {t("Ajouter une section", "Add section")}
        </button>
      )}
    </article>
  );
}
export default PageEditor;
