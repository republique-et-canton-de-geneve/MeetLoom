import { createElement, memo } from "react";
import { renderJSONContentToReactElement } from "@tiptap/static-renderer/json/react";
import { parseRichText, safeColor, safeLink } from "../shared/richtext";

/** Render JSON with explicit React elements; never accept HTML or extension-supplied attributes. */
export const RichText = memo(function RichText({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const doc = parseRichText(value);
  if (!doc)
    return (
      <div className={`rich-text rich-text-plain ${className}`}>{value}</div>
    );
  const rendered = renderJSONContentToReactElement({
    nodeMapping: {
      doc: ({ children }) => <>{children}</>,
      text: ({ node }) => <>{node.text}</>,
      mention: ({ node }) => (
        <span className="rich-mention">@{node.attrs?.label}</span>
      ),
      paragraph: ({ children }) => <p>{children || <br />}</p>,
      heading: ({ node, children }) =>
        createElement(`h${node.attrs?.level ?? 2}`, {}, children),
      hardBreak: () => <br />,
      bulletList: ({ children }) => <ul>{children}</ul>,
      orderedList: ({ node, children }) => (
        <ol start={node.attrs?.start}>{children}</ol>
      ),
      listItem: ({ children }) => <li>{children}</li>,
      taskList: ({ children }) => <ul data-type="taskList">{children}</ul>,
      taskItem: ({ node, children }) => (
        <li data-type="taskItem" data-checked={node.attrs?.checked === true}>
          <span className="task-checkbox" aria-hidden="true">
            {node.attrs?.checked === true ? "☑" : "☐"}
          </span>
          <div>{children}</div>
        </li>
      ),
      blockquote: ({ children }) => <blockquote>{children}</blockquote>,
      codeBlock: ({ children }) => (
        <pre>
          <code>{children}</code>
        </pre>
      ),
      horizontalRule: () => <hr />,
    },
    markMapping: {
      bold: ({ children }) => <strong>{children}</strong>,
      italic: ({ children }) => <em>{children}</em>,
      underline: ({ children }) => <u>{children}</u>,
      strike: ({ children }) => <s>{children}</s>,
      code: ({ children }) => <code>{children}</code>,
      link: ({ mark, children }) => {
        const href = safeLink(mark.attrs?.href);
        return href ? (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        ) : (
          <>{children}</>
        );
      },
      textStyle: ({ mark, children }) => (
        <span style={{ color: safeColor(mark.attrs?.color) }}>{children}</span>
      ),
      highlight: ({ mark, children }) => (
        <mark style={{ backgroundColor: safeColor(mark.attrs?.color) }}>
          {children}
        </mark>
      ),
    },
    unhandledNode: () => <></>,
    unhandledMark: ({ children }) => <>{children}</>,
  })({ content: doc });
  return <div className={`rich-text ${className}`}>{rendered}</div>;
});
