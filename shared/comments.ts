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
  sessionId: string;
  sessionTitle: string;
  blockId: string | null;
  commentId: string | null;
  actor: string;
  kind: "comment" | "reply" | "mention" | "block-mention" | "task-completed";
  createdAt: string;
  readAt: string | null;
}
