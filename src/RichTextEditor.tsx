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
        <ActiveEditor {...props} />
      ) : (
        <div
          className="rich-editor-preview"
          tabIndex={0}
          role="textbox"
          aria-label={props.ariaLabel}
          aria-multiline="true"
          onMouseDown={(event) => {
            event.preventDefault();
            flushSync(() => setActive(true));
          }}
          onFocus={() => setActive(true)}
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
}: RichTextEditorProps) {
  const { t } = useI18n();
  const collaborators = useMentionCollaborators();
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
    autofocus: "end",
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
    // first click and immediately typed characters land in the editable view.
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)),
    );
    editor.view.focus();
  }, [editor]);
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
            editor.chain().focus().toggleHighlight({ color: "#fff1a8" }).run(),
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
