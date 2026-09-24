import { z } from "zod";
import type { Session } from "./model.js";
import { publicProjection } from "./domain.js";
import { INITIAL_RUN } from "./model.js";
import { idSchema } from "./validation.js";

export const sharingSchema = z
  .object({
    enabled: z.boolean().default(true),
    mode: z.enum(["visitor", "agenda"]).default("visitor"),
    dayIds: z.array(idSchema).max(30).optional(),
    pageIds: z.array(idSchema).max(30).optional(),
    formIds: z.array(idSchema).max(30).default([]),
    initialContentId: idSchema.nullable().optional(),
    initialDayId: idSchema.nullable().optional(),
    allowComments: z.boolean().default(false),
  })
  .strict();
export type SharingOptions = z.infer<typeof sharingSchema>;
export interface SharedNavigation {
  kind: "day" | "page" | "form";
  id: string;
  title: string;
}
export function sharedAgenda(session: Session, options: SharingOptions) {
  const selected = {
    ...session,
    pages:
      options.mode === "agenda"
        ? []
        : session.pages?.filter(
            (page) => !options.pageIds || options.pageIds.includes(page.id),
          ),
    days: session.days.filter(
      (day) => !options.dayIds || options.dayIds.includes(day.id),
    ),
    columns: options.mode === "agenda" ? [] : session.columns,
  };
  if (!selected.days.some((day) => day.id === selected.run.dayId))
    selected.run = {
      ...INITIAL_RUN,
      dayId: selected.days[0]?.id ?? "",
      revision: selected.run.revision,
    };
  const projection = publicProjection(selected);
  if (options.mode === "agenda") {
    delete projection.pages;
    delete projection.contentOrder;
  }
  return projection;
}
export interface VisitorComment {
  id: string;
  blockId: string | null;
  author: string;
  text: string;
  createdAt: string;
  parentId: string | null;
  resolved: boolean;
}
