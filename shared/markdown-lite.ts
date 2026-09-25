/**
 * The small Markdown subset language models write (headings, lists, bold,
 * italic, code), parsed into plain data so the interface renders it as
 * elements. Never produces HTML: anything else stays literal text.
 */
export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}
export interface ListItem {
  inline: Inline[];
  children: ListItem[];
  ordered: boolean;
}
export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; inline: Inline[] }
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "list"; ordered: boolean; items: ListItem[] };

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  // `code`, **bold**, __bold__, *italic*, _italic_ (not inside words).
  const pattern =
    /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ text: match[1], code: true });
    else if (match[2] !== undefined || match[3] !== undefined)
      for (const inner of parseInline(match[2] ?? match[3]))
        parts.push({ ...inner, bold: true });
    else
      for (const inner of parseInline(match[4] ?? match[5]))
        parts.push({ ...inner, italic: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

const bullet = /^(\s*)(?:[-*•+]|(\d+)[.)])\s+(.*)$/;

export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: Inline[][] | null = null;
  let list: Extract<MarkdownBlock, { type: "list" }> | null = null;
  let baseIndent = 0;
  const close = () => {
    paragraph = null;
    list = null;
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      close();
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      close();
      blocks.push({
        type: "heading",
        level: Math.min(heading[1].length, 3) as 1 | 2 | 3,
        inline: parseInline(heading[2]),
      });
      continue;
    }
    const item = bullet.exec(line);
    if (item) {
      paragraph = null;
      const indent = item[1].replace(/\t/g, "  ").length;
      const entry: ListItem = {
        inline: parseInline(item[3]),
        children: [],
        ordered: item[2] !== undefined,
      };
      if (!list) {
        list = { type: "list", ordered: entry.ordered, items: [] };
        blocks.push(list);
        baseIndent = indent;
      }
      const parent = list.items.at(-1);
      // One level of nesting is enough for model answers.
      if (indent > baseIndent && parent) parent.children.push(entry);
      else list.items.push(entry);
      continue;
    }
    if (list) {
      // A continuation line of the last item.
      const last: ListItem = list.items.at(-1)!;
      const target = last.children.at(-1) ?? last;
      target.inline.push({ text: " " }, ...parseInline(line.trim()));
      continue;
    }
    if (!paragraph) {
      paragraph = [];
      blocks.push({ type: "paragraph", lines: paragraph });
    }
    paragraph.push(parseInline(line.trim()));
  }
  return blocks;
}
