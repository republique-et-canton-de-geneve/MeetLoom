import { Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Session } from "../shared/model";
import { allBlocks, mapBlocks } from "../shared/domain";
import { useI18n } from "./i18n";
import { Modal } from "./ui";
import {
  categoriesFor,
  DEFAULT_CATEGORY_IDS,
  type CategoryDefinition,
} from "./categories";

export default function CategoryPanel({
  session,
  editable,
  update,
  close,
}: {
  session: Session;
  editable: boolean;
  update: (fn: (session: Session) => Session) => void;
  close: () => void;
}) {
  const { t, locale } = useI18n();
  const categories = categoriesFor(locale, session.categories);
  const change = (category: CategoryDefinition) =>
    update((s) => ({
      ...s,
      categories: [
        ...(s.categories ?? []).filter((c) => c.id !== category.id),
        category,
      ],
    }));
  return (
    <Modal
      title={t("Catégories de la séance", "Session categories")}
      subtitle={t(
        "Personnalisez les noms et les couleurs qui structurent votre agenda.",
        "Customise the names and colours that organise your agenda.",
      )}
      close={close}
    >
      {categories.map((category) => {
        const builtin = DEFAULT_CATEGORY_IDS.includes(
          category.id as (typeof DEFAULT_CATEGORY_IDS)[number],
        );
        const count = session.days
          .flatMap((d) => allBlocks(d.blocks))
          .filter((b) => b.category === category.id).length;
        return (
          <div className="category-setting" key={category.id}>
            <input
              type="color"
              aria-label={`${t("Couleur de", "Colour of")} ${category.label}`}
              value={category.color}
              disabled={!editable}
              onChange={(e) => change({ ...category, color: e.target.value })}
            />
            <input
              aria-label={t("Nom de catégorie", "Category name")}
              value={category.label}
              maxLength={80}
              readOnly={!editable}
              onChange={(e) => change({ ...category, label: e.target.value })}
            />
            <span>{count}</span>
            <button
              className="icon-button"
              disabled={
                !editable ||
                (builtin &&
                  !(session.categories ?? []).some((c) => c.id === category.id))
              }
              title={
                builtin
                  ? t(
                      "Rétablir la catégorie par défaut",
                      "Reset default category",
                    )
                  : t(
                      "Supprimer et classer les blocs en Discussion",
                      "Delete and move blocks to Discussion",
                    )
              }
              onClick={() =>
                update((s) => ({
                  ...s,
                  categories: (s.categories ?? []).filter(
                    (c) => c.id !== category.id,
                  ),
                  ...(!builtin
                    ? {
                        days: s.days.map((d) => ({
                          ...d,
                          blocks: mapBlocks(d.blocks, (b) =>
                            b.category === category.id
                              ? { ...b, category: "discussion" }
                              : b,
                          ),
                        })),
                      }
                    : {}),
                }))
              }
            >
              {builtin ? <RotateCcw size={15} /> : <Trash2 size={15} />}
            </button>
          </div>
        );
      })}
      {editable && (session.categories?.length ?? 0) < 30 && (
        <button
          className="button secondary"
          onClick={() =>
            change({
              id: crypto.randomUUID(),
              label: t("Nouvelle catégorie", "New category"),
              color: "#8ba7c6",
            })
          }
        >
          <Plus size={16} />
          {t("Ajouter une catégorie", "Add category")}
        </button>
      )}
      <div className="modal-actions">
        <button className="button primary" onClick={close}>
          {t("Terminé", "Done")}
        </button>
      </div>
    </Modal>
  );
}
