/** Versioned Tiptap JSON stored in existing string fields. Legacy strings stay plain text. */
export const RICH_TEXT_PREFIX = "meetloom:richtext:v1:";
export const RICH_TEXT_LIMIT = 30000;

export interface RichMark {
  type: string;
  attrs?: Record<string, string>;
}
export interface RichNode {
  type: string;
  text?: string;
  attrs?: Record<string, string | number | boolean>;
  marks?: RichMark[];
  content?: RichNode[];
}
export interface RichTask {
  path: number[];
  text: string;
  checked: boolean;
}

const nodes = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "hardBreak",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "mention",
]);
const plainMarks = new Set(["bold", "italic", "underline", "strike", "code"]);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function safeLink(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/u.test(value)
  )
    return;
  try {
    const url = new URL(value);
    if (
      ["http:", "https:", "mailto:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return value;
  } catch {
    /* Links must have an explicit supported protocol. */
  }
}
export function safeColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

/** Explicit attribute whitelist is shared by the editor, static renderer and exports. */
export function sanitizeRichDocument(value: unknown): RichNode | null {
  let count = 0;
  const clean = (input: unknown, depth: number): RichNode => {
    if (
      ++count > 2000 ||
      depth > 24 ||
      !object(input) ||
      typeof input.type !== "string" ||
      !nodes.has(input.type)
    )
      throw new Error("Invalid rich text document");
    const node: RichNode = { type: input.type };
    if (input.type === "text") {
      if (
        typeof input.text !== "string" ||
        !input.text.length ||
        input.text.length > RICH_TEXT_LIMIT
      )
        throw new Error("Invalid rich text node");
      node.text = input.text;
    }
    const attrs = object(input.attrs) ? input.attrs : {};
    if (input.type === "mention") {
      if (
        typeof attrs.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,120}$/.test(attrs.id) ||
        typeof attrs.label !== "string" ||
        !attrs.label.trim() ||
        attrs.label.length > 160
      )
        throw new Error("Invalid mention");
      node.attrs = { id: attrs.id, label: attrs.label };
    }
    if (input.type === "heading")
      node.attrs = {
        level: [1, 2, 3].includes(Number(attrs.level))
          ? Number(attrs.level)
          : 2,
      };
    if (input.type === "orderedList")
      node.attrs = {
        start:
          Number.isInteger(attrs.start) &&
          Number(attrs.start) > 0 &&
          Number(attrs.start) < 10000
            ? Number(attrs.start)
            : 1,
      };
    if (input.type === "taskItem")
      node.attrs = { checked: attrs.checked === true };
    if (Array.isArray(input.content))
      node.content = input.content.map((child) => clean(child, depth + 1));
    const children = node.content ?? [];
    const blocks = new Set([
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
    ]);
    const allowed =
      input.type === "doc" ||
      input.type === "blockquote" ||
      input.type === "listItem" ||
      input.type === "taskItem"
        ? blocks
        : input.type === "paragraph" || input.type === "heading"
          ? new Set(["text", "hardBreak", "mention"])
          : input.type === "codeBlock"
            ? new Set(["text"])
            : input.type === "bulletList" || input.type === "orderedList"
              ? new Set(["listItem"])
              : input.type === "taskList"
                ? new Set(["taskItem"])
                : new Set<string>();
    if (children.some((child) => !allowed.has(child.type)))
      throw new Error("Invalid rich text structure");
    if (
      ["listItem", "taskItem"].includes(input.type) &&
      children[0]?.type !== "paragraph"
    )
      throw new Error("Invalid list item");
    if (
      ["bulletList", "orderedList", "taskList", "blockquote"].includes(
        input.type,
      ) &&
      !children.length
    )
      throw new Error("Empty rich text container");
    if (input.type === "text" && Array.isArray(input.marks)) {
      if (input.marks.length > 12) throw new Error("Too many marks");
      node.marks = input.marks.flatMap((mark) => {
        if (!object(mark) || typeof mark.type !== "string") return [];
        if (plainMarks.has(mark.type)) return [{ type: mark.type }];
        const markAttrs = object(mark.attrs) ? mark.attrs : {};
        if (mark.type === "link") {
          const href = safeLink(markAttrs.href);
          return href ? [{ type: "link", attrs: { href } }] : [];
        }
        if (mark.type === "textStyle" || mark.type === "highlight") {
          const color = safeColor(markAttrs.color);
          return color ? [{ type: mark.type, attrs: { color } }] : [];
        }
        return [];
      });
    }
    return node;
  };
  try {
    const result = clean(value, 0);
    return result.type === "doc" ? result : null;
  } catch {
    return null;
  }
}

export function parseRichText(value: string): RichNode | null {
  if (!value.startsWith(RICH_TEXT_PREFIX) || value.length > RICH_TEXT_LIMIT)
    return null;
  try {
    return sanitizeRichDocument(
      JSON.parse(value.slice(RICH_TEXT_PREFIX.length)),
    );
  } catch {
    return null;
  }
}
export function plainTextDocument(value: string): RichNode {
  return {
    type: "doc",
    content: value.split(/\r?\n/u).map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}
export function richTextDocument(value: string): RichNode {
  return parseRichText(value) ?? plainTextDocument(value);
}
export function serializeRichText(value: unknown): string {
  const doc = sanitizeRichDocument(value);
  if (!doc) throw new Error("Invalid rich text document");
  const encoded = RICH_TEXT_PREFIX + JSON.stringify(doc);
  if (encoded.length > RICH_TEXT_LIMIT)
    throw new Error("Rich text exceeds the field size limit");
  return encoded;
}

function nodeText(node: RichNode, tasks = true): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "mention") return `@${node.attrs?.label ?? ""}`;
  if (node.type === "hardBreak") return "\n";
  const separator = [
    "doc",
    "bulletList",
    "orderedList",
    "taskList",
    "listItem",
    "taskItem",
    "blockquote",
  ].includes(node.type)
    ? "\n"
    : "";
  const text = (node.content ?? [])
    .map((child) => nodeText(child, tasks))
    .join(separator);
  return node.type === "taskItem" && tasks
    ? `[${node.attrs?.checked === true ? "x" : " "}] ${text}`
    : text;
}
export function richTextToPlain(value: string): string {
  const doc = parseRichText(value);
  return doc ? nodeText(doc) : value;
}

/** Identity comes from the stored user ID, never from a displayed name. */
export function richTextMentions(value: string): string[] {
  const doc = parseRichText(value),
    result = new Set<string>();
  const walk = (node: RichNode) => {
    if (node.type === "mention") result.add(String(node.attrs!.id));
    node.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return [...result];
}

export function completedTaskMentions(value: string): Set<string> {
  return new Set(completedTaskMentionCounts(value).keys());
}

export function completedTaskMentionCounts(value: string): Map<string, number> {
  const doc = parseRichText(value),
    counts = new Map<string, number>();
  const mentions = (node: RichNode, result: Set<string>) => {
    if (node.type === "taskItem") return;
    if (node.type === "mention") result.add(String(node.attrs!.id));
    node.content?.forEach((child) => mentions(child, result));
  };
  const walk = (node: RichNode) => {
    if (node.type === "taskItem" && node.attrs?.checked === true) {
      const result = new Set<string>();
      node.content?.forEach((child) => mentions(child, result));
      for (const mention of result)
        counts.set(mention, (counts.get(mention) ?? 0) + 1);
    }
    node.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return counts;
}

export function extractTasks(value: string): RichTask[] {
  const doc = parseRichText(value);
  if (!doc) return [];
  const result: RichTask[] = [];
  const walk = (node: RichNode, path: number[]) => {
    if (node.type === "taskItem") {
      const text = (node.content ?? [])
        .filter((child) => child.type !== "taskList")
        .map((child) => nodeText(child, false))
        .join("\n")
        .trim();
      if (text)
        result.push({ path, text, checked: node.attrs?.checked === true });
    }
    node.content?.forEach((child, index) => walk(child, [...path, index]));
  };
  walk(doc, []);
  return result;
}
export function setTaskChecked(
  value: string,
  path: number[],
  checked: boolean,
): string {
  const doc = parseRichText(value);
  if (!doc) throw new Error("Task source changed");
  let node = doc;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || !node.content?.[index])
      throw new Error("Task source changed");
    node = node.content[index];
  }
  if (node.type !== "taskItem") throw new Error("Task source changed");
  node.attrs = { checked };
  return serializeRichText(doc);
}
export function appendTask(value: string, text: string): string {
  const doc = richTextDocument(value);
  doc.content ??= [];
  const last = doc.content.at(-1);
  const item: RichNode = {
    type: "taskItem",
    attrs: { checked: false },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
  if (last?.type === "taskList") (last.content ??= []).push(item);
  else doc.content.push({ type: "taskList", content: [item] });
  return serializeRichText(doc);
}
export function extractMaterials(value: string): string[] {
  const doc = parseRichText(value);
  if (!doc)
    return value
      .split(/\r?\n/u)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "").trim())
      .filter(Boolean);
  const result: string[] = [];
  const walk = (node: RichNode) => {
    if (node.type === "listItem" || node.type === "taskItem") {
      const text = (node.content ?? [])
        .filter(
          (child) =>
            !["bulletList", "orderedList", "taskList"].includes(child.type),
        )
        .map((child) => nodeText(child, false))
        .join("\n")
        .trim();
      if (text) result.push(text);
      node.content
        ?.filter((child) =>
          ["bulletList", "orderedList", "taskList"].includes(child.type),
        )
        .forEach(walk);
    } else if (node.type === "paragraph" || node.type === "heading") {
      const text = nodeText(node, false).trim();
      if (text) result.push(text);
    } else node.content?.forEach(walk);
  };
  walk(doc);
  return result;
}
export function appendMaterial(value: string, text: string): string {
  const doc = richTextDocument(value);
  doc.content ??= [];
  const last = doc.content.at(-1);
  const item: RichNode = {
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
  if (last?.type === "bulletList") (last.content ??= []).push(item);
  else doc.content.push({ type: "bulletList", content: [item] });
  return serializeRichText(doc);
}
