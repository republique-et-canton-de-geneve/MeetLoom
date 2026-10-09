import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Node as TiptapNode, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  ListTodo,
  Link2,
  Unlink,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
} from "lucide-react";
import {
  RICH_TEXT_LIMIT,
  richTextDocument,
  safeLink,
  serializeRichText,
} from "../shared/richtext";
import { RichText } from "./RichText";
import { useI18n } from "./i18n";
import { useMentionCollaborators } from "./MentionContext";
import type { Collaborator } from "../shared/comments";
import "./richtext.css";

const Mention = TiptapNode.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { id: { default: null }, label: { default: "" } };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    return ["span", { class: "rich-mention" }, `@${String(node.attrs.label)}`];
  },
  renderText({ node }) {
    return `@${String(node.attrs.label)}`;
  },
});

/** Where the editing bar goes: above the text by default, below it when the
 * text sits too close to the top of the window or of its scrolling panel,
 * and moved left when it would leave the window on the right. It floats, so
 * the text under the pointer never moves. */
function toolbarPlacement(
  box: { top: number; left: number },
  bar: { width: number; height: number },
  limits: { top: number; right: number },
): { below: boolean; shift: number } {
  return {
    below: box.top - bar.height - 4 < limits.top,
    shift: Math.min(0, limits.right - 8 - (box.left + bar.width)),
  };
}

/** The top of the area a bar above `element` can show in: the window, or a
 * scrolling ancestor that would clip it. */
function visibleTop(element: HTMLElement) {
  let top = 0;
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll|hidden)/.test(getComputedStyle(node).overflowY))
      top = Math.max(top, node.getBoundingClientRect().top);
  }
  return top;
}

export interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  compact?: boolean;
  className?: string;
  maxLength?: number;
}

/** Only the focused cell mounts ProseMirror, keeping large agendas inexpensive. */
export function RichTextEditor(props: RichTextEditorProps) {
  const [active, setActive] = useState(false);
  // Where the preview was clicked, so the caret lands there.
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  if (props.disabled)
    return <RichText value={props.value} className={props.className} />;
  return (
    <div
      className={`rich-editor ${props.compact ? "rich-editor-compact" : ""} ${props.className ?? ""}`}
      onBlur={(event) => {
        const container = event.currentTarget;
        // Replacing the preview generates a blur with relatedTarget=null. Wait
        // until the newly attached ProseMirror view receives focus before closing.
        queueMicrotask(() => {
          if (
            container.isConnected &&
            !container.contains(document.activeElement)
          )
            setActive(false);
        });
      }}
    >
      {active ? (
        <ActiveEditor {...props} point={point} />
      ) : (
        <div
          className="rich-editor-preview"
          tabIndex={0}
          role="textbox"
          aria-label={props.ariaLabel}
          aria-multiline="true"
          onMouseDown={(event) => {
            event.preventDefault();
            const at = { x: event.clientX, y: event.clientY };
            flushSync(() => {
              setPoint(at);
              setActive(true);
            });
          }}
          onFocus={() => {
            setPoint(null);
            setActive(true);
          }}
          onClick={() => setActive(true)}
        >
          {props.value ? (
            <RichText value={props.value} />
          ) : (
            <span className="rich-placeholder">{props.placeholder ?? "…"}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ActiveEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  maxLength = RICH_TEXT_LIMIT,
  point,
}: RichTextEditorProps & { point: { x: number; y: number } | null }) {
  const { t } = useI18n();
  const collaborators = useMentionCollaborators();
  // Only the opening click places the caret; later clicks are the editor's.
  const opening = useRef(point);
  const change = useRef(onChange),
    lastEmitted = useRef(value);
  change.current = onChange;
  const [error, setError] = useState(""),
    [linkOpen, setLinkOpen] = useState(false),
    [link, setLink] = useState("");
  const [mentionQuery, setMentionQuery] = useState<{
      from: number;
      to: number;
      query: string;
    } | null>(null),
    [mentionIndex, setMentionIndex] = useState(0);
  const options = mentionQuery
    ? collaborators
        .filter((member) =>
          member.name
            .toLocaleLowerCase()
            .includes(mentionQuery.query.toLocaleLowerCase()),
        )
        .slice(0, 8)
    : [];
  const mentionKeys = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const updateMention = (current: Editor) => {
    const { selection } = current.state;
    if (!selection.empty) {
      setMentionQuery(null);
      return;
    }
    const before = selection.$from.parent.textBetween(
        0,
        selection.$from.parentOffset,
        "\n",
        "\ufffc",
      ),
      match = before.match(/(?:^|\s)@([\p{L}\p{N}_. -]*)$/u);
    setMentionQuery(
      match
        ? {
            from: selection.from - match[1].length - 1,
            to: selection.from,
            query: match[1],
          }
        : null,
    );
    setMentionIndex(0);
  };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: false,
          isAllowedUri: (url) => !!safeLink(url),
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Mention,
    ],
    content: richTextDocument(value),
    // Focus is set below, where the text was clicked: Tiptap's own autofocus
    // would move the caret to the end and scroll the page there.
    autofocus: false,
    immediatelyRender: true,
    editorProps: {
      handleKeyDown: (_view, event) => mentionKeys.current(event),
      attributes: {
        class: "rich-text rich-editor-content",
        role: "textbox",
        "aria-label": ariaLabel ?? t("Texte mis en forme", "Formatted text"),
        "aria-multiline": "true",
        "data-placeholder": placeholder ?? "",
      },
    },
    onUpdate: ({ editor: current }) => {
      updateMention(current);
      try {
        const next = current.isEmpty
          ? ""
          : serializeRichText(current.getJSON());
        if (next.length > maxLength) throw new Error("Field limit");
        lastEmitted.current = next;
        change.current(next);
        setError("");
      } catch {
        setError(
          t(
            "Ce champ est trop long. Réduisez le contenu pour enregistrer.",
            "This field is too long. Shorten the content to save it.",
          ),
        );
      }
    },
    onSelectionUpdate: ({ editor: current }) => updateMention(current),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            underline: current.isActive("underline"),
            bulletList: current.isActive("bulletList"),
            orderedList: current.isActive("orderedList"),
            taskList: current.isActive("taskList"),
            link: current.isActive("link"),
            highlight: current.isActive("highlight"),
            heading: [1, 2, 3].find((level) =>
              current.isActive("heading", { level }),
            ),
          }
        : null,
  });
  useLayoutEffect(() => {
    if (!editor) return;
    // EditorContent attaches in its layout lifecycle. Focus synchronously so the
    // first click and immediately typed characters land in the editable view,
    // at the clicked spot (the text is laid out exactly like the preview).
    const { doc } = editor.state,
      at = opening.current;
    const hit = at ? editor.view.posAtCoords({ left: at.x, top: at.y }) : null;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        hit
          ? TextSelection.near(doc.resolve(hit.pos))
          : TextSelection.atEnd(doc),
      ),
    );
    editor.view.focus();
  }, [editor]);
  const floating = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ below: false, shift: 0 });
  useLayoutEffect(() => {
    const place = () => {
      const bar = floating.current,
        box = bar?.parentElement;
      if (!bar || !box) return;
      const next = toolbarPlacement(
        box.getBoundingClientRect(),
        { width: bar.offsetWidth, height: bar.offsetHeight },
        { top: visibleTop(box), right: document.documentElement.clientWidth },
      );
      setPlacement((current) =>
        current.below === next.below && current.shift === next.shift
          ? current
          : next,
      );
    };
    place();
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [linkOpen]);
  useEffect(() => {
    if (editor && value !== lastEmitted.current) {
      editor.commands.setContent(richTextDocument(value), {
        emitUpdate: false,
      });
      lastEmitted.current = value;
    }
  }, [editor, value]);
  if (!editor) return <RichText value={value} />;
  const chooseMention = (member: Collaborator) => {
    if (!mentionQuery) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: mentionQuery.from, to: mentionQuery.to }, [
        { type: "mention", attrs: { id: member.id, label: member.name } },
        { type: "text", text: " " },
      ])
      .run();
    setMentionQuery(null);
  };
  mentionKeys.current = (event) => {
    if (!mentionQuery) return false;
    if (event.key === "Escape") {
      setMentionQuery(null);
      return true;
    }
    if (!options.length) return false;
    if (event.key === "ArrowDown") {
      setMentionIndex((value) => (value + 1) % options.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      setMentionIndex((value) => (value + options.length - 1) % options.length);
      return true;
    }
    if (event.key === "Enter") {
      chooseMention(options[mentionIndex % options.length]);
      return true;
    }
    return false;
  };
  const button = (
    label: string,
    icon: ReactNode,
    action: () => void,
    pressed?: boolean,
  ) => (
    <button
      type="button"
      className="rich-tool"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {icon}
    </button>
  );
  const applyLink = () => {
    const href = safeLink(link.trim());
    if (!href) {
      setError(
        t(
          "Utilisez une adresse https://, http:// ou mailto: valide.",
          "Use a valid https://, http:// or mailto: address.",
        ),
      );
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
    setError("");
  };
  return (
    <>
      <div
        ref={floating}
        className={`rich-floating ${placement.below ? "below" : ""}`}
        style={{ left: placement.shift }}
      >
        <div
          className="rich-toolbar"
          role="toolbar"
          aria-label={t("Mise en forme", "Text formatting")}
        >
          {button(
            t("Gras", "Bold"),
            <Bold size={15} />,
            () => editor.chain().focus().toggleBold().run(),
            state?.bold,
          )}
          {button(
            t("Italique", "Italic"),
            <Italic size={15} />,
            () => editor.chain().focus().toggleItalic().run(),
            state?.italic,
          )}
          {button(
            t("Souligné", "Underline"),
            <Underline size={15} />,
            () => editor.chain().focus().toggleUnderline().run(),
            state?.underline,
          )}
          <span className="rich-toolbar-divider" />
          {([1, 2, 3] as const).map((level) => (
            <span key={level}>
              {button(
                `${t("Titre", "Heading")} ${level}`,
                `H${level}`,
                () => editor.chain().focus().toggleHeading({ level }).run(),
                state?.heading === level,
              )}
            </span>
          ))}
          {!!collaborators.length &&
            button(
              t("Mentionner un collaborateur", "Mention a collaborator"),
              "@",
              () => {
                editor.commands.focus();
                const { from, to } = editor.state.selection;
                setMentionQuery({ from, to, query: "" });
                setMentionIndex(0);
              },
            )}
          {button(
            t("Liste à puces", "Bullet list"),
            <List size={15} />,
            () => editor.chain().focus().toggleBulletList().run(),
            state?.bulletList,
          )}
          {button(
            t("Liste numérotée", "Numbered list"),
            <ListOrdered size={15} />,
            () => editor.chain().focus().toggleOrderedList().run(),
            state?.orderedList,
          )}
          {button(
            t("Liste de tâches", "Task list"),
            <ListTodo size={15} />,
            () => editor.chain().focus().toggleTaskList().run(),
            state?.taskList,
          )}
          {button(
            t("Insérer un lien", "Insert link"),
            <Link2 size={15} />,
            () => {
              setLink(editor.getAttributes("link").href ?? "https://");
              setLinkOpen(!linkOpen);
            },
            state?.link,
          )}
          {state?.link &&
            button(
              t("Retirer le lien", "Remove link"),
              <Unlink size={15} />,
              () => editor.chain().focus().unsetLink().run(),
            )}
          <label
            className="rich-color"
            title={t("Couleur du texte", "Text color")}
          >
            <span aria-hidden="true">A</span>
            <input
              type="color"
              aria-label={t("Couleur du texte", "Text color")}
              defaultValue="#354d46"
              onInput={(event) =>
                editor.chain().focus().setColor(event.currentTarget.value).run()
              }
            />
          </label>
          {button(
            t("Surligner", "Highlight"),
            <Highlighter size={15} />,
            () =>
              editor
                .chain()
                .focus()
                .toggleHighlight({ color: "#fff1a8" })
                .run(),
            state?.highlight,
          )}
          {button(
            t("Retirer la mise en forme", "Clear formatting"),
            <Eraser size={15} />,
            () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
          )}
          {button(t("Annuler", "Undo"), <Undo2 size={15} />, () =>
            editor.chain().focus().undo().run(),
          )}
          {button(t("Rétablir", "Redo"), <Redo2 size={15} />, () =>
            editor.chain().focus().redo().run(),
          )}
        </div>
        {linkOpen && (
          <div className="rich-link-form">
            <input
              type="url"
              autoFocus
              value={link}
              aria-label={t("Adresse du lien", "Link address")}
              onChange={(event) => setLink(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyLink();
                }
                if (event.key === "Escape") {
                  setLinkOpen(false);
                  editor.commands.focus();
                }
              }}
            />
            <button
              type="button"
              className="button secondary small"
              onClick={applyLink}
            >
              {t("Appliquer", "Apply")}
            </button>
          </div>
        )}
      </div>
      <EditorContent editor={editor} />
      {mentionQuery && !!collaborators.length && (
        <div
          className="rich-mention-options"
          role="listbox"
          aria-label={t("Collaborateurs", "Collaborators")}
        >
          {options.length ? (
            options.map((member, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                key={member.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseMention(member)}
              >
                @{member.name}
              </button>
            ))
          ) : (
            <span>
              {t(
                "Aucun collaborateur correspondant",
                "No matching collaborator",
              )}
            </span>
          )}
        </div>
      )}
      {error && (
        <p className="rich-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
