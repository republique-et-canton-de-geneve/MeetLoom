# Pages and forms — implemented contract

This contract was implemented on September 23, 2026, in `shared/content.ts`, `server/content-api.ts`, and the PageEditor/FormEditor/PublicForm components. User acceptance remains tracked in the parity checklist; this document does not claim complete parity.

The [SessionLab Pages reference](https://help.sessionlab.com/en/articles/11514746-pages-for-session-briefs-needs-assessment-reports-and-to-capture-notes-beyond-your-agenda) calls for rich documents, section links, panel editing, and printing. The [SessionLab Forms reference](https://help.sessionlab.com/en/articles/11721938-forms-gather-insights-from-your-workshop-participants) calls for questions, publication, identity choices, responses, CSV, and AI assistance. The contract below is MeetLoom's proposal for implementing these workflows with explicit privacy boundaries.

## Agenda data

Optional `Session` extensions allow existing agendas to be read without a destructive migration:

```ts
interface SessionPage {
  id: string;
  title: string;
  visibility: "team" | "public"; // team by default
  sections: { id: string; content: string }[]; // existing rich-text format
}
interface QuestionBase {
  id: string;
  title: string;
  description: string; // safe rich text
  required: boolean;
}
type FormQuestion = QuestionBase &
  (
    | { type: "short" | "long" | "image" }
    | { type: "single" | "multiple"; options: { id: string; label: string }[] }
    | {
        type: "scale";
        min: number;
        max: number;
        minLabel: string;
        maxLabel: string;
      }
    | {
        type: "matrix";
        rows: { id: string; label: string }[];
        options: { id: string; label: string }[];
      }
  );
interface SessionForm {
  id: string;
  title: string;
  description: string;
  identityMode: "automatic" | "optional" | "anonymous";
  questions: FormQuestion[];
}
// Session.pages?: SessionPage[]
// Session.forms?: SessionForm[]
// Session.contentOrder?: {kind:"day"|"page"|"form"; id:string}[]
```

Stable identifiers support section/question links, reordering, and editing without losing their destination. An absent order list means days, then pages, then forms. If present, it may reference only existing items, without duplicates; `orderedContent` appends new missing items. Deletion removes the item's reference. Types and rules are exported from `shared/content.ts` to keep the timing domain focused.

Proposed limits: 30 pages, 30 forms, 100 sections per page, 100 questions per form, 30 options/rows per question, 200-character titles, 30,000-character descriptions and sections, and overall session JSON size limits. Identifier uniqueness must include the new entities and their children. Responses use question/option/row IDs, never their indices. Imports regenerate those IDs and force imported pages to `team`. Duplication carries over neither responses nor publications.

## Publications and responses

Responses are not stored in `Session`. They appear in neither version snapshots nor agenda saves, and no public projection includes them.

- `form_publications`: id, session_id, form_id, unique token_hash, enabled, definition_json, revision, created_at, updated_at. The random token is returned only when created; explicit rotation can replace it. Keeping drafts separate from the published definition avoids silently changing the meaning of previously answered questions.
- `form_responses`: id, publication_id, session_id, form_id, definition_json/revision, answers_json, nullable respondent_user_id, nullable respondent_name/email, created_at. The snapshot keeps exports interpretable after a question is renamed or deleted. Anonymous responses contain no IP address or user-agent.
- A random client submission identifier makes retries idempotent; uniqueness is publication + identifier, not a browser fingerprint. Do not claim to prevent multiple anonymous submissions without an individual invitation mechanism.

Proposed API:

| Route                                                          | Permission and result                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/sessions/:id/forms/:formId/publication`              | can(share), publication metadata without secrets                                                                          |
| `POST /api/sessions/:id/forms/:formId/publish`                 | can(share), validated draft snapshot, returns the link on creation                                                        |
| `POST /api/sessions/:id/forms/:formId/unpublish`               | can(share), immediate closure, responses retained                                                                         |
| `POST /api/sessions/:id/forms/:formId/rotate`                  | can(share), revokes the previous link and returns the new one                                                             |
| `GET /api/forms/:token`                                        | public, active publication only, allowlisted definition and the requester's effective identity status                     |
| `POST /api/forms/:token/responses`                             | public, rate limit, bounded length, expected revision, value and required-question validation; 409 if publication changed |
| `GET /api/sessions/:id/forms/:formId/responses`                | can(edit), bounded pagination, data and schemas needed for export                                                         |
| `DELETE /api/sessions/:id/forms/:formId/responses/:responseId` | owner or administrator authorized for this session, targeted deletion                                                     |

The active/revision check and insertion must share a consistent transaction: concurrent unpublishing cannot accept a response after closure. PostgreSQL locks the publication; SQLite uses the existing serialized transaction. Identity comes only from server authentication: `anonymous` forces all identity fields to null, `automatic` associates only a signed-in account, and `optional` requires an explicit choice; a person who is not signed in remains anonymous. The interface shows this decision before submission.

## Projection and interface

Pages: allowlisted projection of `public` pages after restricting a Visitor Link to its permitted IDs; no Page in Online Agenda. Forms: only those explicitly selected for a Visitor Link and currently published may be listed, as dedicated links. A public form never receives the draft or responses. The exact scope rules must integrate with Visitor/Online links without opening every item by default.

Proposed components: `PageEditor` reuses `RichTextEditor` per section, with `#page=<id>&section=<id>` deep links, add/reorder/duplicate/delete actions, and a side panel; `FormEditor` uses a reorderable question list and preview; `FormResponseView` aggregates choices/scales/matrices and supports detailed reading and formula-safe CSV export; `PublicForm` provides per-question validation, sending status, explicit identity, and idempotent confirmation. All views support French and English.

Security acceptance checks: internal Pages absent from public HTTP/HTML/JSON; no comment or draft metadata leakage; viewers denied response access; no account recorded in anonymous mode; question source frozen at submission; revoked token refused; duplicate submission idempotent; unknown questions/options rejected; required questions and matrices validated; adding a new form does not publish it; saving/restoring a session does not reactivate an old link.

## Image responses

The seventh question type, `image`, accepts PNG, JPEG, and WebP. The browser resizes a source image under 5 MB to a maximum side length of 1,280 pixels and re-encodes it through a canvas: source-file metadata is not retained. A submission accepts at most 256 KiB per image and 512 KiB of images in total. The API independently checks format, signature, encoding, and limits; a direct API client remains responsible for metadata in its pixels or file.

Files are stored in `form_response_images`, separately from agenda JSON and paginated responses. The latter contain only an opaque content reference. The route `GET /api/sessions/:id/forms/:formId/responses/:responseId/images/:questionId` checks the session owner/editor role and all four identifiers. It uses the authenticated cookie, disables caching, and serves only the validated raster type; no public link grants access to submitted images. Deleting a response cascades to its images. Anonymous responses still receive no account identifier; a photo may nevertheless identify a person visually, which the form explains.

AI summaries receive only an image marker, with no binary content or reference. CSV uses `[Image]`, while the authorized response detail displays the image. This feature adds no block attachments. `tests/form-images.test.ts` covers limits, forbidden formats, idempotency, permissions, absence of identity, AI/CSV exclusion, and cascading deletion on SQLite and PostgreSQL. Actual file selection and transformation in Chrome still require acceptance testing.

## Remaining comparative checks

AI response reports omit identities and images; workspace Pages/Forms defaults are implemented. Page PDFs and form QR codes use the export module. Workflows for every question variant and opening exported files remain tracked in [product-parity.md](product-parity.md), without inferring complete parity from API tests alone.
