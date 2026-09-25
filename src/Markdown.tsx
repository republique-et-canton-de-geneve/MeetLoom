import { Fragment, type ReactNode } from "react";
import {
  parseMarkdown,
  type Inline,
  type ListItem,
} from "../shared/markdown-lite";

const inline = (parts: Inline[]) =>
  parts.map((part, index) => {
    let node: ReactNode = part.code ? <code>{part.text}</code> : part.text;
    if (part.italic) node = <em>{node}</em>;
    if (part.bold) node = <strong>{node}</strong>;
    return <Fragment key={index}>{node}</Fragment>;
  });

const list = (items: ListItem[], ordered: boolean) => {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag>
      {items.map((item, index) => (
        <li key={index}>
          {inline(item.inline)}
          {!!item.children.length &&
            list(item.children, item.children[0].ordered)}
        </li>
      ))}
    </Tag>
  );
};

/** Text written by a language model, with its light Markdown rendered as
 * elements (see shared/markdown-lite.ts). Never injects HTML. */
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {parseMarkdown(text).map((block, index) => {
        if (block.type === "heading") {
          const Tag = (["h3", "h4", "h5"] as const)[block.level - 1];
          return <Tag key={index}>{inline(block.inline)}</Tag>;
        }
        if (block.type === "list")
          return (
            <Fragment key={index}>{list(block.items, block.ordered)}</Fragment>
          );
        return (
          <p key={index}>
            {block.lines.map((line, row) => (
              <Fragment key={row}>
                {row > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
