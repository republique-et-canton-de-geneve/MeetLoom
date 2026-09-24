# Internal AI and document import

AI is disabled without `LLM_BASE_URL`. The URL, model and key remain on the server. The API expects the Chat Completions-compatible protocol. `LLM_MODEL` selects the text model; `LLM_VISION_MODEL` explicitly enables PNG/JPEG OCR. No document or message is sent to an implicitly configured provider.

## Conversations and proposals

The Assistant panel keeps conversations private to each account and session. Context is explicit: none, the current session, up to five selected sessions, the current workspace or all authorized workspaces. The last two modes select up to 200 accessible, non-archived sessions when the conversation starts; start a new conversation to include sessions added later. Internal columns, private Pages and Form definitions require the internal-information checkbox. Form responses are never included automatically. The server checks access to each source on every request and after calling the model. Removing access to a source blocks its existing conversation; create a revised context to continue.

Model context is limited to 60,000 characters. If it must be shortened, a catalog retains every session identifier and title with a share of its content, and the interface reports this. Select a specific session to work with details that were omitted. Proposals modify only the currently open session; other sessions are references.

The assistant proposes typed operations: edit, add or delete blocks; translate or rewrite fields; change dates and times; create or revise Pages and forms. Preview comes before application. Operations cannot change permissions, publication links, owner identity, column audiences or timer state. Proposals are tied to a session version; a conflict requires a new proposal. Acceptance, persistence and history are atomic. Double-clicking or racing acceptance against rejection cannot apply two decisions.

Organization or workspace administrators manage named instruction sets, selected when a conversation is created. Personal preferences are visible, editable and removable by their owner. A conversation stores up to 60 messages; the model receives the latest 12 messages and bounded context. No preferences are silently inferred and stored.

In Form results, **Analyze responses** sends only questions and answers with labels from their published versions. Account names and addresses, identifiers and response timestamps are removed. Image answers are replaced with a marker; image bytes are not sent. Free-text answers can themselves contain personal information, which the panel explains before the action. Results state the included and total response counts; the sample is limited to the latest 500 responses and 100,000 characters. Editing permissions are checked again after the model call. The summary is not published automatically.

## Import and preview

Supported formats: MeetLoom JSON, DOCX, PPTX, XLSX, text-bearing PDF, CSV/TSV, UTF-8 TXT/Markdown, and PNG/JPEG with the vision model enabled. Users can map table columns, turn each line into a block or ask the internal model to propose a structure. Titles, durations and descriptions can be corrected in the preview. Only **Add to session** merges the new days. The source file is not retained as an attachment.

Office formats are extracted on the server in a separate worker: 5 MB input, 25 MB total expanded data, 8 MB per ZIP entry, 1,500 entries, 15 seconds and two concurrent jobs. XML DTD/entity declarations are rejected. Archive paths are never extracted to disk. PDF is limited to 100 pages, PowerPoint to 500 slides and Excel to 30 sheets; tables are limited to 1,000 data rows and 40 columns. Extracted text is limited to 200,000 characters. Excel formulas are not executed; their saved values are used.

Extraction loses some layout information. Scanned PDFs require exporting the relevant pages to PNG/JPEG for optional OCR. Legacy binary DOC/PPT/XLS files must be converted to DOCX/PPTX/XLSX. Encrypted or protected files must be unlocked locally. Review OCR and estimated durations in the preview.

Columns from imported documents are private. JSON merging preserves the source's private data, remaps day/block/room/Page/Form/category identifiers and removes facilitator identifiers scoped to the source session. Existing destination content, timer state and permissions are not replaced.

## Verification

`tests/ai-api.test.ts`, `ai-proposals.test.ts`, `form-ai.test.ts`, `document-api.test.ts` and `document-import.test.ts` check permissions, conflicts, atomic decisions, identity exclusion from summaries, extraction of real file formats, malicious archives, timeouts and private merging. Test providers are local HTTP servers; no real LLM service has been contacted by these tests. The actual internal model still requires validation in the deployment environment.

Technical sources: [Mammoth](https://github.com/mwilliamson/mammoth.js), [PDF.js](https://mozilla.github.io/pdf.js/), [read-excel-file](https://github.com/catamphetamine/read-excel-file), [JSZip](https://stuk.github.io/jszip/documentation/), [saxes](https://github.com/lddubeau/saxes), [CSV Parse](https://csv.js.org/parse/).
