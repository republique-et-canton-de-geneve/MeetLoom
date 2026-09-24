import type { Sql } from "./db.js";
import type { Collaborator } from "../shared/comments.js";

/** Mirrors effective agenda access, including workspace membership. Never exposes
 * account emails, and excludes deactivated accounts from mentions/presence. */
export const sessionCollaborators = (sql: Sql, sessionId: string) =>
  sql.all<Collaborator>(
    `SELECT u.id,u.name,CASE WHEN s.owner_id=u.id THEN 'owner' WHEN wm.role IN ('admin','editor') OR m.role='editor' THEN 'editor' WHEN m.role='facilitator' THEN 'facilitator' ELSE 'viewer' END AS role FROM sessions s JOIN users u ON 1=1 LEFT JOIN members m ON m.session_id=s.id AND m.user_id=u.id LEFT JOIN session_workspaces sw ON sw.session_id=s.id LEFT JOIN workspace_members wm ON wm.workspace_id=sw.workspace_id AND wm.user_id=u.id WHERE s.id=$1 AND (s.owner_id=u.id OR m.user_id=u.id OR wm.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=u.id)`,
    [sessionId],
  );
