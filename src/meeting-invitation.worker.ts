import { Buffer } from "buffer/";
import {
  parseMeetingInvitation,
  MeetingInvitationError,
  meetingInvitationMessage,
} from "../shared/meeting-invitation";

// Outlook's legacy text decoders use Node-compatible buffers. Keep that
// compatibility inside the parsing worker, away from the application window.
if (!("Buffer" in globalThis))
  Object.defineProperty(globalThis, "Buffer", { value: Buffer });

self.onmessage = async (event: MessageEvent<unknown>) => {
  // This dedicated worker is held privately by the client. Worker.postMessage
  // events have an empty origin (unlike Window.postMessage); reject other
  // protocols rather than comparing with the application's URL.
  if (event.origin !== "") return;
  try {
    const data = meetingInvitationMessage(event.data);
    const result = await parseMeetingInvitation(
      data.name,
      new Uint8Array(data.bytes),
      data.now,
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
