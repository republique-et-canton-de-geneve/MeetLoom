import { useEffect, useState } from "react";
import {
  Check,
  MessageSquare,
  Plus,
  Send,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import type { Session, SessionSummary } from "../shared/model";
import type { WorkspaceSummary } from "../shared/workspaces";
import type {
  AiConversation,
  AiInstructionSet,
  AiMessage,
  AiOperation,
} from "../shared/ai";
import { allBlocks } from "../shared/domain";
import { richTextToPlain } from "../shared/richtext";
import { api, post } from "./api";
import { ErrorBanner, Inspector, Loading } from "./ui";
import { useI18n } from "./i18n";
import McpPanel from "./McpPanel";
import "./ai.css";

export interface AiPanelProps {
  session: Session;
  dayId: string;
  enabled: boolean;
  editable: boolean;
  isAdmin?: boolean;
  initialBlockId?: string;
  update: (fn: (session: Session) => Session) => void;
  flush: () => Promise<Session>;
  reload: () => Promise<void>;
  close: () => void;
}
type ConversationData = {
  conversation: AiConversation;
  messages: AiMessage[];
  contextSummary?: { sessions: number; truncated: boolean };
};
export default function AiPanel({
  session,
  dayId,
  enabled,
  editable,
  isAdmin = false,
  initialBlockId,
  flush,
  reload,
  close,
}: AiPanelProps) {
  const { t, locale } = useI18n(),
    [tab, setTab] = useState<
      "chat" | "preferences" | "instructions" | "connectors"
    >("chat"),
    [conversations, setConversations] = useState<AiConversation[]>([]),
    [conversation, setConversation] = useState<AiConversation | null>(null),
    [messages, setMessages] = useState<AiMessage[]>([]),
    [sessions, setSessions] = useState<SessionSummary[]>([]),
    [instructions, setInstructions] = useState<AiInstructionSet[]>([]),
    [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]),
    [instructionWorkspace, setInstructionWorkspace] = useState(""),
    [contextMode, setContextMode] =
      useState<AiConversation["contextMode"]>("current"),
    [contextIds, setContextIds] = useState<string[]>([]),
    [includePrivate, setIncludePrivate] = useState(false),
    [instructionSetId, setInstructionSetId] = useState(""),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preferences, setPreferences] = useState(""),
    [instructionTitle, setInstructionTitle] = useState(""),
    [instructionContent, setInstructionContent] = useState(""),
    [editingInstruction, setEditingInstruction] = useState<string | null>(null),
    [targetBlock, setTargetBlock] = useState(initialBlockId ?? "");
  useEffect(() => {
    if (initialBlockId) setTargetBlock(initialBlockId);
  }, [initialBlockId]);
  const base = `/sessions/${encodeURIComponent(session.id)}/ai/conversations`;
  const managedWorkspaces = workspaces.filter(
    (workspace) => workspace.role === "admin",
  );
  const manageInstructions = isAdmin || managedWorkspaces.length > 0;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setConversation(null);
    setMessages([]);
    void Promise.all([
      api<{ conversations: AiConversation[] }>(base),
      api<{ sessions: SessionSummary[] }>("/sessions"),
      api<{ instructions: AiInstructionSet[] }>("/ai/instructions"),
      api<{ content: string }>("/ai/preferences"),
      api<{ workspaces: WorkspaceSummary[] }>("/workspaces"),
    ])
      .then(([chats, list, sets, prefs, spaces]) => {
        if (!active) return;
        setConversations(chats.conversations);
        setSessions(list.sessions);
        setInstructions(sets.instructions);
        setPreferences(prefs.content);
        setWorkspaces(spaces.workspaces);
        if (!isAdmin)
          setInstructionWorkspace(
            spaces.workspaces.find((workspace) => workspace.role === "admin")
              ?.id ?? "",
          );
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base]);
  const load = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const data = await api<ConversationData>(`${base}/${id}`);
      setConversation(data.conversation);
      setMessages(data.messages);
      setContextMode(data.conversation.contextMode);
      setContextIds(data.conversation.contextIds);
      setIncludePrivate(data.conversation.includePrivate);
      setInstructionSetId(data.conversation.instructionSetId ?? "");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remember = (data: ConversationData) => {
    setConversation(data.conversation);
    setMessages(data.messages);
    setConversations((prior) => [
      data.conversation,
      ...prior.filter((value) => value.id !== data.conversation.id),
    ]);
  };
  const ask = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await flush();
      let current = conversation;
      if (!current) {
        const created = await post<ConversationData>(base, {
          title: prompt.trim().slice(0, 90),
          contextMode,
          contextIds,
          includePrivate,
          instructionSetId: instructionSetId || null,
        });
        current = created.conversation;
        remember(created);
      }
      const data = await post<ConversationData>(
        `${base}/${current.id}/messages`,
        {
          prompt: prompt.trim(),
          locale,
          version: saved.version,
          revision: current.revision,
          dayId,
        },
      );
      remember(data);
      if (data.contextSummary?.truncated)
        setNotice(
          t(
            `Le contexte de ${data.contextSummary.sessions} séances a été abrégé pour respecter la limite du modèle. Sélectionnez une séance précise pour travailler sur ses détails.`,
            `Context from ${data.contextSummary.sessions} sessions was shortened to fit the model limit. Select a specific session to work on its details.`,
          ),
        );
      setPrompt("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const decide = async (message: AiMessage, decision: "apply" | "reject") => {
    if (!conversation) return;
    setBusy(true);
    setError("");
    try {
      const saved = decision === "apply" ? await flush() : session;
      const result = await post<{ message: AiMessage }>(
        `${base}/${conversation.id}/messages/${message.id}/decision`,
        { decision, version: saved.version, locale },
      );
      setMessages((prior) =>
        prior.map((value) =>
          value.id === message.id ? result.message : value,
        ),
      );
      if (decision === "apply") {
        await reload();
        setNotice(
          t(
            "Proposition appliquée et enregistrée.",
            "Proposal applied and saved.",
          ),
        );
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selectedDay = session.days.find((day) => day.id === dayId),
    blocks = selectedDay ? allBlocks(selectedDay.blocks) : [];
  const quick = (action: string) =>
    setPrompt(
      targetBlock
        ? `${action}\n${t("Bloc ciblé", "Target block")}: ${targetBlock} (${blocks.find((block) => block.id === targetBlock)?.title ?? ""})`
        : action,
    );
  return (
    <Inspector
      title={t("Assistant de préparation", "Planning assistant")}
      subtitle={t(
        "Votre IA interne, avec des propositions à vérifier.",
        "Your internal AI, with proposals to review.",
      )}
      close={close}
    >
      <div className="ai-workbench">
        <div className="ai-tabs">
          <button
            className={tab === "chat" ? "active" : ""}
            onClick={() => setTab("chat")}
          >
            <MessageSquare size={15} />
            {t("Conversations", "Conversations")}
          </button>
          <button
            className={tab === "preferences" ? "active" : ""}
            onClick={() => setTab("preferences")}
          >
            <Settings2 size={15} />
            {t("Mes préférences", "My preferences")}
          </button>
          <button
            className={tab === "connectors" ? "active" : ""}
            onClick={() => setTab("connectors")}
          >
            {t("Connecteurs", "Connectors")}
          </button>
          {manageInstructions && (
            <button
              className={tab === "instructions" ? "active" : ""}
              onClick={() => setTab("instructions")}
            >
              {t("Consignes", "Instructions")}
            </button>
          )}
        </div>
        {error && <ErrorBanner message={error} />}{" "}
        {notice && (
          <p role="status" className="content-notice">
            {notice}
          </p>
        )}{" "}
        {loading && <Loading />}
        {!enabled && (
          <p className="privacy-explainer">
            {t(
              "L’assistant attend la configuration du service IA interne par un administrateur. Aucun fournisseur externe n’est utilisé par défaut.",
              "An administrator needs to configure the internal AI service. No external provider is used by default.",
            )}
          </p>
        )}
        {tab === "connectors" && <McpPanel sessionId={session.id} />}
        {tab === "chat" && (
          <>
            <div className="ai-conversation-picker">
              <select
                value={conversation?.id ?? ""}
                disabled={busy}
                aria-label={t("Conversation", "Conversation")}
                onChange={(event) => {
                  if (event.target.value) void load(event.target.value);
                  else {
                    setConversation(null);
                    setMessages([]);
                    setContextMode("current");
                    setIncludePrivate(false);
                  }
                }}
              >
                <option value="">
                  {t("Nouvelle conversation", "New conversation")}
                </option>
                {conversations.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.title}
                  </option>
                ))}
              </select>
              {conversation && (
                <button
                  className="icon-button danger-text"
                  disabled={busy}
                  title={t("Supprimer la conversation", "Delete conversation")}
                  onClick={() => {
                    setBusy(true);
                    void api(`${base}/${conversation.id}`, { method: "DELETE" })
                      .then(() => {
                        setConversations((values) =>
                          values.filter(
                            (value) => value.id !== conversation.id,
                          ),
                        );
                        setConversation(null);
                        setMessages([]);
                      })
                      .catch((cause) => setError(cause.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <details className="ai-context" open={!conversation}>
              <summary>
                {t("Contexte envoyé au modèle", "Context sent to the model")}
              </summary>
              <label>
                {t("Agendas", "Agendas")}
                <select
                  value={contextMode}
                  disabled={!!conversation || busy}
                  onChange={(event) =>
                    setContextMode(event.target.value as typeof contextMode)
                  }
                >
                  <option value="none">{t("Aucun agenda", "No agenda")}</option>
                  <option value="current">
                    {t("Séance actuelle", "Current session")}
                  </option>
                  <option value="workspace">
                    {t(
                      "Espace actuel (séances non archivées)",
                      "Current workspace (active agendas)",
                    )}
                  </option>
                  <option value="all">
                    {t(
                      "Tous mes espaces autorisés (séances non archivées)",
                      "All authorized workspaces (active agendas)",
                    )}
                  </option>
                  <option value="selected">
                    {t(
                      "Séances choisies (5 maximum)",
                      "Selected sessions (up to 5)",
                    )}
                  </option>
                </select>
              </label>
              {["workspace", "all"].includes(contextMode) && (
                <p className="muted">
                  {t(
                    "La liste des séances accessibles est fixée au début de la conversation (200 maximum) et les droits sont revérifiés à chaque demande. Les contenus longs sont abrégés ; le modèle peut uniquement proposer des modifications de la séance ouverte.",
                    "Accessible agendas are fixed when the conversation starts (up to 200), and permissions are checked for every request. Long content is shortened; the model can only propose changes to the open session.",
                  )}
                  {conversation && ` (${conversation.contextIds.length})`}
                </p>
              )}
              {contextMode === "selected" && (
                <div className="ai-context-list">
                  {sessions
                    .filter((value) => !value.archived)
                    .map((value) => (
                      <label key={value.id} className="checkbox-label">
                        <input
                          type="checkbox"
                          disabled={
                            !!conversation ||
                            busy ||
                            (!contextIds.includes(value.id) &&
                              contextIds.length >= 5)
                          }
                          checked={contextIds.includes(value.id)}
                          onChange={(event) =>
                            setContextIds((ids) =>
                              event.target.checked
                                ? [...ids, value.id]
                                : ids.filter((id) => id !== value.id),
                            )
                          }
                        />
                        {value.title} ·{" "}
                        {workspaces.find(
                          (workspace) => workspace.id === value.workspaceId,
                        )?.name ?? t("Personnel", "Personal")}
                      </label>
                    ))}
                </div>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={includePrivate}
                  disabled={!!conversation || busy || contextMode === "none"}
                  onChange={(event) => setIncludePrivate(event.target.checked)}
                />
                {t(
                  "Inclure les notes et pages internes de ces séances",
                  "Include internal notes and pages from these sessions",
                )}
              </label>
              <label>
                {t("Jeu de consignes", "Instruction set")}
                <select
                  value={instructionSetId}
                  disabled={!!conversation || busy}
                  onChange={(event) => setInstructionSetId(event.target.value)}
                >
                  <option value="">{t("Aucun", "None")}</option>
                  {instructions.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.title}
                    </option>
                  ))}
                </select>
              </label>
              <small>
                {t(
                  "La conversation est privée à votre compte. Créez-en une nouvelle pour changer de contexte. Les participants, jetons et réponses aux formulaires ne sont pas envoyés automatiquement.",
                  "The conversation is private to your account. Start a new one to change context. Members, tokens and form responses are not sent automatically.",
                )}
              </small>
            </details>
            <div className="ai-messages" aria-live="polite">
              {messages.map((message) => (
                <section
                  key={message.id}
                  className={`ai-message ai-message-${message.role}`}
                >
                  <div className="ai-message-heading">
                    <strong>
                      {message.role === "user"
                        ? t("Vous", "You")
                        : t("Assistant", "Assistant")}
                    </strong>
                    <time>
                      {new Date(message.createdAt).toLocaleTimeString(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{message.content}</p>
                  {!!message.operations?.length && (
                    <div className="ai-change-set">
                      <strong>
                        {t("Modifications proposées", "Proposed changes")} (
                        {message.operations.length})
                      </strong>
                      {message.operations.map((operation, index) => (
                        <OperationPreview
                          key={index}
                          operation={operation}
                          session={session}
                        />
                      ))}
                      {message.decision === "pending" ? (
                        <div className="button-row">
                          <button
                            className="button primary"
                            disabled={busy || !editable}
                            onClick={() => void decide(message, "apply")}
                          >
                            <Check size={15} />
                            {t("Appliquer", "Apply")}
                          </button>
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() => void decide(message, "reject")}
                          >
                            <X size={15} />
                            {t("Rejeter", "Reject")}
                          </button>
                        </div>
                      ) : (
                        <span className="ai-decision">
                          {message.decision === "applied"
                            ? t("Appliquée", "Applied")
                            : t("Rejetée", "Rejected")}
                        </span>
                      )}
                    </div>
                  )}
                </section>
              ))}
            </div>
            <div className="ai-quick-actions">
              <select
                value={targetBlock}
                aria-label={t("Bloc à améliorer", "Block to improve")}
                onChange={(event) => setTargetBlock(event.target.value)}
              >
                <option value="">
                  {t("Toute la séance", "Whole session")}
                </option>
                {blocks.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.title}
                  </option>
                ))}
              </select>
              <div className="ai-quick-buttons">
                <button
                  onClick={() =>
                    quick(
                      t(
                        "Propose un agenda cohérent de 90 minutes pour atteindre nos objectifs.",
                        "Propose a coherent 90-minute agenda to achieve our goals.",
                      ),
                    )
                  }
                >
                  {t("Construire", "Build")}
                </button>
                <button
                  onClick={() =>
                    quick(
                      t(
                        "Améliore les consignes et rends-les plus faciles à animer.",
                        "Improve the instructions and make them easier to facilitate.",
                      ),
                    )
                  }
                >
                  {t("Améliorer", "Improve")}
                </button>
                <button
                  onClick={() =>
                    quick(
                      t(
                        "Traduis les textes de la sélection en français.",
                        "Translate the selected content to English.",
                      ),
                    )
                  }
                >
                  {t("Traduire en français", "Translate to English")}
                </button>
                <button
                  onClick={() =>
                    quick(
                      t(
                        "Raccourcis les descriptions tout en conservant les consignes essentielles.",
                        "Shorten descriptions while keeping essential instructions.",
                      ),
                    )
                  }
                >
                  {t("Raccourcir", "Shorten")}
                </button>
                <button
                  onClick={() =>
                    quick(
                      t(
                        "Propose de nouvelles dates pour cette séance à partir du…",
                        "Propose new dates for this session starting on…",
                      ),
                    )
                  }
                >
                  {t("Recaler les dates", "Reschedule dates")}
                </button>
                <button
                  onClick={() =>
                    quick(
                      t(
                        "Crée un formulaire de feedback avec une question ouverte, une échelle et une matrice adaptées à cette séance.",
                        "Create a feedback form with an open question, a scale and a matrix tailored to this session.",
                      ),
                    )
                  }
                >
                  {t("Formulaire", "Feedback form")}
                </button>
              </div>
            </div>
            <form
              className="ai-prompt-form"
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <label>
                {t("Votre demande", "Your request")}
                <textarea
                  rows={4}
                  value={prompt}
                  maxLength={8000}
                  required
                  disabled={busy}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={t(
                    "Objectif, public, durée, changement souhaité…",
                    "Goal, audience, duration, requested change…",
                  )}
                />
              </label>
              <button
                className="button primary"
                disabled={
                  !enabled ||
                  busy ||
                  !prompt.trim() ||
                  (contextMode === "selected" && !contextIds.length)
                }
                type="submit"
              >
                <Send size={16} />
                {busy ? t("Réflexion…", "Thinking…") : t("Envoyer", "Send")}
              </button>
            </form>
          </>
        )}
        {tab === "preferences" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              void api("/ai/preferences", {
                method: "PUT",
                body: JSON.stringify({ content: preferences }),
              })
                .then(() =>
                  setNotice(
                    t(
                      "Préférences enregistrées. Elles seront incluses dans vos prochaines demandes.",
                      "Preferences saved. They will be included in your next requests.",
                    ),
                  ),
                )
                .catch((cause) => setError(cause.message))
                .finally(() => setBusy(false));
            }}
          >
            <h3>
              {t("Ce que je souhaite mémoriser", "What I want to remember")}
            </h3>
            <p>
              {t(
                "Ces préférences sont propres à votre compte et modifiables à tout moment. Videz ce champ pour les effacer.",
                "These preferences belong to your account and can be edited at any time. Clear the field to erase them.",
              )}
            </p>
            <textarea
              rows={10}
              value={preferences}
              maxLength={8000}
              onChange={(event) => setPreferences(event.target.value)}
              aria-label={t(
                "Préférences personnelles IA",
                "Personal AI preferences",
              )}
            />
            <button className="button primary" disabled={busy}>
              <Check size={15} />
              {t("Enregistrer", "Save")}
            </button>
          </form>
        )}
        {tab === "instructions" && manageInstructions && (
          <div>
            <h3>{t("Consignes partagées", "Shared instructions")}</h3>
            {instructions
              .filter((value) =>
                value.workspaceId
                  ? managedWorkspaces.some(
                      (workspace) => workspace.id === value.workspaceId,
                    )
                  : isAdmin,
              )
              .map((value) => (
                <div className="ai-instruction-item" key={value.id}>
                  <button
                    className="plain-button"
                    onClick={() => {
                      setEditingInstruction(value.id);
                      setInstructionTitle(value.title);
                      setInstructionContent(value.content);
                      setInstructionWorkspace(value.workspaceId ?? "");
                    }}
                  >
                    {value.title}
                  </button>
                  <button
                    className="icon-button danger-text"
                    title={t("Supprimer", "Delete")}
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void api(`/ai/instructions/${value.id}`, {
                        method: "DELETE",
                      })
                        .then(() =>
                          setInstructions((prior) =>
                            prior.filter((item) => item.id !== value.id),
                          ),
                        )
                        .catch((cause) => setError(cause.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                void api<{ instruction: AiInstructionSet }>(
                  editingInstruction
                    ? `/ai/instructions/${editingInstruction}`
                    : "/ai/instructions",
                  {
                    method: editingInstruction ? "PUT" : "POST",
                    body: JSON.stringify({
                      title: instructionTitle,
                      content: instructionContent,
                      workspaceId: instructionWorkspace || null,
                    }),
                  },
                )
                  .then((data) => {
                    setInstructions((prior) => [
                      ...prior.filter(
                        (value) => value.id !== data.instruction.id,
                      ),
                      data.instruction,
                    ]);
                    setEditingInstruction(null);
                    setInstructionTitle("");
                    setInstructionContent("");
                    setNotice(
                      t("Consignes enregistrées", "Instructions saved"),
                    );
                  })
                  .catch((cause) => setError(cause.message))
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                {t("Portée", "Scope")}
                <select
                  value={instructionWorkspace}
                  disabled={!!editingInstruction}
                  onChange={(event) =>
                    setInstructionWorkspace(event.target.value)
                  }
                >
                  {isAdmin && (
                    <option value="">
                      {t("Toute l’organisation", "Entire organization")}
                    </option>
                  )}
                  {managedWorkspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Nom", "Name")}
                <input
                  value={instructionTitle}
                  required
                  maxLength={200}
                  onChange={(event) => setInstructionTitle(event.target.value)}
                />
              </label>
              <label>
                {t("Consignes", "Instructions")}
                <textarea
                  rows={8}
                  value={instructionContent}
                  required
                  maxLength={8000}
                  onChange={(event) =>
                    setInstructionContent(event.target.value)
                  }
                />
              </label>
              <div className="button-row">
                <button className="button primary" disabled={busy}>
                  <Check size={15} />
                  {t("Enregistrer", "Save")}
                </button>
                {editingInstruction && (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      setEditingInstruction(null);
                      setInstructionTitle("");
                      setInstructionContent("");
                    }}
                  >
                    <Plus size={15} />
                    {t("Nouveau jeu", "New set")}
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </div>
    </Inspector>
  );
}

function OperationPreview({
  operation,
  session,
}: {
  operation: AiOperation;
  session: Session;
}) {
  const { t } = useI18n(),
    blocks = session.days.flatMap((day) => allBlocks(day.blocks));
  if (operation.type === "update_block") {
    const block = blocks.find((value) => value.id === operation.blockId);
    const labels: Record<string, string> = {
      title: t("Titre", "Title"),
      description: t("Description", "Description"),
      duration: t("Durée", "Duration"),
      category: t("Catégorie", "Category"),
      facilitator: t("Responsable", "Facilitator"),
      section: t("Section", "Section"),
    };
    const differences = Object.entries(operation.changes).flatMap(
      ([key, value]) =>
        key === "fields"
          ? Object.entries(value as Record<string, string>).map(
              ([id, text]) => ({
                key: id,
                label:
                  session.columns.find((column) => column.id === id)?.label ??
                  id,
                before: block?.fields[id] ?? "",
                after: text,
              }),
            )
          : [
              {
                key,
                label: labels[key] ?? key,
                before: String(
                  block?.[key as keyof typeof operation.changes] ?? "",
                ),
                after: String(value),
              },
            ],
    );
    return (
      <div className="ai-operation">
        <h4>
          {t("Modifier", "Update")} · {block?.title ?? operation.blockId}
        </h4>
        {differences.map(({ key, label, before, after }) => (
          <div className="ai-diff-row" key={key}>
            <strong>{label}</strong>
            <del>{richTextToPlain(before)}</del>
            <ins>{richTextToPlain(after)}</ins>
          </div>
        ))}
      </div>
    );
  }
  if (operation.type === "add_blocks")
    return (
      <div className="ai-operation">
        <h4>
          {t("Ajouter des activités", "Add activities")} ·{" "}
          {session.days.find((day) => day.id === operation.dayId)?.title}
        </h4>
        {operation.blocks.map((block, index) => (
          <div className="ai-new-block" key={index}>
            <strong>
              {block.title} · {block.duration} min
            </strong>
            <p>{block.description}</p>
          </div>
        ))}
      </div>
    );
  if (operation.type === "delete_blocks")
    return (
      <div className="ai-operation ai-operation-delete">
        <h4>{t("Supprimer les blocs", "Delete blocks")}</h4>
        <ul>
          {operation.blockIds.map((id) => (
            <li key={id}>
              {blocks.find((block) => block.id === id)?.title ?? id}
            </li>
          ))}
        </ul>
      </div>
    );
  if (operation.type === "create_page")
    return (
      <div className="ai-operation">
        <h4>
          {t("Créer une page interne", "Create an internal page")} ·{" "}
          {operation.title}
        </h4>
        <p>{operation.content}</p>
      </div>
    );
  if (operation.type === "create_form" || operation.type === "update_form")
    return (
      <div className="ai-operation">
        <h4>
          {operation.type === "create_form"
            ? t("Créer un formulaire brouillon", "Create a draft form")
            : t("Modifier le formulaire brouillon", "Update draft form")}{" "}
          · {operation.title}
        </h4>
        <p>{operation.description}</p>
        <ol>
          {operation.questions?.map((question, index) => (
            <li key={index}>
              {question.title} ({question.type})
            </li>
          ))}
        </ol>
      </div>
    );
  return (
    <div className="ai-operation">
      <h4>
        {operation.type === "update_day"
          ? t("Modifier le jour", "Update day")
          : operation.type === "update_page"
            ? t("Modifier la page", "Update page")
            : t("Modifier la séance", "Update session")}
      </h4>
      {Object.entries(operation)
        .filter(([key]) => !["type", "dayId", "pageId"].includes(key))
        .map(([key, value]) => (
          <p key={key}>
            <strong>{key}</strong> :{" "}
            {Array.isArray(value)
              ? value.map((item) => item.content).join("\n")
              : String(value)}
          </p>
        ))}
    </div>
  );
}
