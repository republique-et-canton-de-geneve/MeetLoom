export interface McpToken {
  id: string;
  label: string;
  sessionIds: string[];
  includePrivate: boolean;
  write: boolean;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}
