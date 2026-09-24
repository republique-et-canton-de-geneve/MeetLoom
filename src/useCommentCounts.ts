import { useEffect, useState } from "react";
import { api } from "./api";
type Counts = {
  total: number;
  session: number;
  blocks: Record<string, number>;
};
export function useCommentCounts(sessionId: string) {
  const [counts, setCounts] = useState<Counts>({
    total: 0,
    session: 0,
    blocks: {},
  });
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setCounts({ total: 0, session: 0, blocks: {} });
    const load = () => {
      if (pending || document.hidden) return;
      pending = true;
      void api<Counts>(`/sessions/${sessionId}/comment-counts`, {
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted) setCounts(value);
        })
        .catch(() => {})
        .finally(() => (pending = false));
    };
    load();
    const interval = setInterval(load, 10000);
    window.addEventListener("meetloom:notifications", load);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("meetloom:notifications", load);
    };
  }, [sessionId]);
  return counts;
}
