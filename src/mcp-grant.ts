import type { Role, SessionSummary } from "../shared/model";

/** Roles whose MCP grant may include write access (server/mcp.ts). */
export const canGrantWrite = (role: Role) =>
  role === "owner" || role === "editor";

/** The open session first, then the server's order. */
export function mcpSessionChoices(
  sessions: SessionSummary[],
  currentId: string,
) {
  return [
    ...sessions.filter((session) => session.id === currentId),
    ...sessions.filter((session) => session.id !== currentId),
  ];
}

/** The token form's checks: how many selected sessions would make the server
    refuse the write grant asked, and whether the token may be created. */
export function mcpTokenCheck(
  form: { label: string; selected: string[]; write: boolean },
  sessions: SessionSummary[],
) {
  const ids = new Set(form.write ? form.selected : []),
    readOnly = sessions.filter(
      (session) => ids.has(session.id) && !canGrantWrite(session.role),
    ).length;
  return {
    readOnly,
    ready: form.selected.length > 0 && !!form.label.trim() && readOnly === 0,
  };
}
