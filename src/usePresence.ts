import { useEffect, useRef, useState } from "react";
import type { PresenceResponse, PresentParticipant } from "../shared/presence";
import { api } from "./api";

type LiveParticipant = PresentParticipant & { expiresAt: number };
export function usePresence(
  sessionId: string,
  options: {
    enabled?: boolean;
    blockId?: string | null;
    editing?: boolean;
  } = {},
) {
  const [state, setState] = useState<{
    connected: boolean;
    participants: LiveParticipant[];
  }>({ connected: false, participants: [] });
  const selection = useRef(options);
  selection.current = options;
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    if (options.enabled === false) {
      setState({ connected: false, participants: [] });
      return;
    }
    const clientId = crypto.randomUUID(),
      abort = new AbortController();
    let disposed = false,
      inFlight = false;
    const leave = () => {
      void api<void>(`/sessions/${sessionId}/presence`, {
        method: "DELETE",
        keepalive: true,
        body: JSON.stringify({ clientId }),
      }).catch(() => undefined);
    };
    const beat = async () => {
      if (disposed || inFlight || document.visibilityState !== "visible")
        return;
      inFlight = true;
      const requestAbort = new AbortController(),
        cancel = () => requestAbort.abort();
      abort.signal.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, 8000);
      try {
        const data = await api<PresenceResponse>(
          `/sessions/${sessionId}/presence`,
          {
            method: "POST",
            signal: requestAbort.signal,
            body: JSON.stringify({
              clientId,
              blockId: selection.current.blockId ?? null,
              editing: selection.current.editing ?? false,
            }),
          },
        );
        if (!disposed && document.visibilityState === "visible")
          setState({
            connected: true,
            participants: data.participants.map((participant) => ({
              ...participant,
              expiresAt:
                Date.now() +
                Math.max(
                  0,
                  data.expiresInMs - (data.serverTime - participant.lastSeen),
                ),
            })),
          });
      } catch {
        if (!disposed) setState({ connected: false, participants: [] });
      } finally {
        inFlight = false;
        clearTimeout(timeout);
        abort.signal.removeEventListener("abort", cancel);
        if (!disposed && document.visibilityState !== "visible") leave();
      }
    };
    refresh.current = () => {
      void beat();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void beat();
      else {
        leave();
        setState({ connected: false, participants: [] });
      }
    };
    const heartbeat = setInterval(() => void beat(), 10_000);
    const expiry = setInterval(
      () =>
        setState((current) => {
          const participants = current.participants.filter(
            (participant) => participant.expiresAt > Date.now(),
          );
          return {
            connected: current.connected && participants.length > 0,
            participants,
          };
        }),
      1000,
    );
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    window.addEventListener("focus", refresh.current);
    void beat();
    return () => {
      disposed = true;
      abort.abort();
      clearInterval(heartbeat);
      clearInterval(expiry);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("focus", refresh.current);
      refresh.current = () => {};
      leave();
    };
  }, [sessionId, options.enabled]);
  useEffect(() => {
    refresh.current();
  }, [options.blockId, options.editing]);
  return state;
}
