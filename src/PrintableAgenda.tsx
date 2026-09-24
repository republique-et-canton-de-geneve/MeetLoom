import type { PublicSession, Session } from "../shared/model";
import {
  blockDuration,
  formatTime,
  publicProjection,
  scheduleTreeDay,
  totalDuration,
} from "../shared/domain";
import { columnValue } from "./export";
import { useI18n } from "./i18n";
import { durationLabel } from "./ui";
import { RichText } from "./RichText";
import "./richtext.css";
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from "./export-options";
import { exportMaterials } from "./export-documents";
import { scheduleExportDay } from "../shared/export-projection";
import { categoriesFor } from "./categories";
import "./export.css";

export function PrintableAgenda({
  session,
  privateAudience,
  options,
  preview = false,
}: {
  session: Session | PublicSession;
  privateAudience?: boolean;
  options?: PrintOptions;
  preview?: boolean;
}) {
  const { t, locale } = useI18n();
  const internal = privateAudience ?? "ownerId" in session;
  const source = internal ? session : publicProjection(session);
  const settings = { ...DEFAULT_PRINT_OPTIONS, ...options };
  return (
    <article
      className={`print-agenda print-layout-${settings.layout} ${settings.dayPageBreak ? "print-day-break" : ""} ${preview ? "print-preview-document" : ""}`}
      style={{ fontFamily: settings.font, fontSize: `${settings.fontSize}pt` }}
    >
      {!preview && (
        <style>{`@page { size: ${settings.paper} ${settings.landscape ? "landscape" : "portrait"}; margin: 15mm; }`}</style>
      )}
      <header>
        <span>meetloom</span>
        <strong>
          {internal
            ? t(
                "Document d’équipe — contient les notes internes",
                "Team document — includes internal notes",
              )
            : t("Agenda partagé", "Shared agenda")}
        </strong>
      </header>
      <h1>{source.title}</h1>
      <RichText value={source.description} />
      <p className="print-meta">
        {durationLabel(totalDuration(source))} · {source.timezone}
      </p>
      {settings.categoryLegend && (
        <div className="print-category-legend">
          {categoriesFor(locale, source.categories)
            .filter((category) =>
              source.days.some((day) =>
                scheduleTreeDay(day).some(
                  (row) => row.block.category === category.id,
                ),
              ),
            )
            .map((category) => (
              <span key={category.id}>
                <i style={{ background: category.color }} />
                {category.label}
              </span>
            ))}
        </div>
      )}
      <div className="print-days">
        {source.days.map((day) => {
          const rows = scheduleExportDay(session, day);
          return (
            <section className="print-day" key={day.id}>
              <h2>
                {day.title} ·{" "}
                {new Date(`${day.date}T12:00:00`).toLocaleDateString(locale)}
              </h2>
              {rows.map((item, index) => (
                <div
                  className={`print-block block-kind-${item.block.kind ?? "activity"} ${settings.blocksPerPage > 0 && index > 0 && index % settings.blocksPerPage === 0 ? "print-explicit-break" : ""}`}
                  key={item.block.id}
                  style={{
                    marginInlineStart: `${item.depth * 12}px`,
                    borderInlineStart: settings.categoryColors
                      ? `3px solid ${source.categories?.find((category) => category.id === item.block.category)?.color ?? ({ opening: "#2D7A68", discussion: "#597AC4", activity: "#8D67B2", break: "#AE823B", decision: "#BB6172", closing: "#497884" } as Record<string, string>)[item.block.category] ?? "#64748B"}`
                      : undefined,
                    paddingInlineStart: settings.categoryColors
                      ? "10px"
                      : undefined,
                  }}
                >
                  {item.block.section !== rows[index - 1]?.block.section &&
                    item.block.section && <h3>{item.block.section}</h3>}
                  {item.roomPath.join(" / ") !==
                    rows[index - 1]?.roomPath.join(" / ") &&
                    item.roomPath.length > 0 && (
                      <p className="print-room">{item.roomPath.join(" / ")}</p>
                    )}
                  <div className="print-block-heading">
                    <span>
                      {formatTime(item.startMinute)} –{" "}
                      {formatTime(item.endMinute)}
                    </span>
                    <h4>{item.block.title}</h4>
                    <span>{durationLabel(blockDuration(item.block))}</span>
                  </div>
                  {!["overview", "multiday"].includes(settings.layout) &&
                    source.columns
                      .filter((column) => columnValue(item.block, column.id))
                      .map((column) => (
                        <div className="print-field" key={column.id}>
                          <strong>
                            {column.label}
                            {column.visibility === "team"
                              ? ` · ${t("interne", "internal")}`
                              : ""}
                          </strong>
                          <RichText
                            value={columnValue(item.block, column.id)}
                          />
                        </div>
                      ))}
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {source.pages?.map((page) => (
        <section className="print-day" key={page.id}>
          <h2>
            {page.title}
            {internal && page.visibility === "team"
              ? ` · ${t("interne", "internal")}`
              : ""}
          </h2>
          {page.sections.map((section) => (
            <div className="print-field" key={section.id}>
              <RichText value={section.content} />
            </div>
          ))}
        </section>
      ))}
      {settings.includeMaterials && (
        <section className="print-day">
          <h2>{t("Matériel à préparer", "Materials to prepare")}</h2>
          <ul>
            {exportMaterials(source).map((item, index) => (
              <li key={index}>
                ☐ {item.text}{" "}
                <small>
                  · {item.day} / {item.block}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
