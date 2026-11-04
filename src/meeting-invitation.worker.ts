import { Buffer } from "buffer/";
import {
  parseMeetingInvitation,
  MeetingInvitationError,
} from "../shared/meeting-invitation";

// Outlook's legacy text decoders use Node-compatible buffers. Keep that
// compatibility inside the parsing worker, away from the application window.
if (!("Buffer" in globalThis))
  Object.defineProperty(globalThis, "Buffer", { value: Buffer });

self.onmessage = async (
  event: MessageEvent<{ name: string; bytes: ArrayBuffer; now: number }>,
) => {
  try {
    const result = await parseMeetingInvitation(
      event.data.name,
      new Uint8Array(event.data.bytes),
      event.data.now,
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof MeetingInvitationError
          ? error.code
          : "MEETING_INVALID",
    });
  }
};
