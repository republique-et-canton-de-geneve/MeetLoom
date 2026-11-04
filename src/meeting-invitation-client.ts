import {
  MAX_MEETING_BYTES,
  MeetingInvitationError,
  type MeetingInvitation,
  type MeetingInvitationErrorCode,
} from "../shared/meeting-invitation";

/** The file and its parsed content never leave this browser or enter application storage. */
export async function parseMeetingFile(file: File): Promise<MeetingInvitation> {
  if (file.size > MAX_MEETING_BYTES)
    throw new MeetingInvitationError("MEETING_FILE_LIMIT");
  if (!/\.(msg|ics)$/i.test(file.name))
    throw new MeetingInvitationError("MEETING_FORMAT");
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new MeetingInvitationError("MEETING_READ_FAILED");
  }
  if (bytes.byteLength > MAX_MEETING_BYTES)
    throw new MeetingInvitationError("MEETING_FILE_LIMIT");
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./meeting-invitation.worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new MeetingInvitationError("MEETING_TIMEOUT"));
    }, 10_000);
    worker.onmessage = (
      event: MessageEvent<{
        result?: MeetingInvitation;
        error?: MeetingInvitationErrorCode;
      }>,
    ) => {
      finish();
      if (event.data.result) resolve(event.data.result);
      else
        reject(
          new MeetingInvitationError(event.data.error ?? "MEETING_INVALID"),
        );
    };
    worker.onerror = () => {
      finish();
      reject(new MeetingInvitationError("MEETING_INVALID"));
    };
    worker.onmessageerror = () => {
      finish();
      reject(new MeetingInvitationError("MEETING_INVALID"));
    };
    worker.postMessage({ name: file.name, bytes, now: Date.now() }, [bytes]);
  });
}
