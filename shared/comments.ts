import type { Comment, Role } from "./model.js";

export interface Collaborator {
  id: string;
  name: string;
  role: Role;
}
export interface TeamComment extends Comment {
  authorId: string;
  threadId: string;
  parentId: string | null;
  mentions: Collaborator[];
}
export interface CommentThread {
  id: string;
  blockId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  revision: number;
  updatedAt: string;
  comments: TeamComment[];
  totalComments: number;
  hasMore: boolean;
}
export interface CommentsResponse {
  comments: TeamComment[];
  threads: CommentThread[];
  total: number;
  hasMore: boolean;
}
export interface TeamNotification {
  id: string;
  /** Null for problem reports, which concern the installation. */
  sessionId: string | null;
  sessionTitle: string;
  blockId: string | null;
  commentId: string | null;
  actor: string;
  kind:
    | "comment"
    | "reply"
    | "mention"
    | "block-mention"
    | "task-completed"
    | "visitor-comments"
    | "feedback";
  /** How many events a grouped notification stands for. */
  count?: number;
  createdAt: string;
  readAt: string | null;
}
