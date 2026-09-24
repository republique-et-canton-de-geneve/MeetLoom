# Export a session

Open **Export**, choose the Public or Team audience, then select days, columns and Pages. The block and category filters retain the groups needed to preserve the structure and the original times of the selected activities. Removing an activity from the export does not shift later activities. Internal columns and Pages are never available in a public export.

Detailed, table, compact, day overview, multi-day overview and details-only layouts can be combined with A4, Letter or Legal paper, portrait or landscape orientation, three fonts and five text sizes. The category legend and materials list are optional. Page breaks between days or after every N blocks are explicit and marked in the preview. Content length, installed fonts and browser or Word settings can add pages: check the final pagination in the print dialog. The application does not promise identical pagination across rendering engines.

**Print / PDF** uses the browser print dialog. **Word** produces an editable DOCX with rich text, lists, links and tables. **PowerPoint** provides an editable outline: change titles, order and included slides before generating the PPTX. Choose which columns belong in speaker notes; those columns are then omitted from the slides themselves. Long text is split across multiple slides. The form button explicitly creates a revocable link restricted to an already published form and embeds its locally generated QR code.

**Copy table** provides HTML and tab-separated text for Word or a spreadsheet. If the browser denies clipboard access, use CSV or Word. HTML is escaped and cells that could be interpreted as formulas are neutralized. CSV applies the same protections and uses UTF-8 with a BOM.

Personal presets store only the audience and presentation settings. They can be created, renamed, updated or deleted; session, block and field selections are not stored in these presets. Each account can have up to twenty presets.

When an LLM is configured, **Propose settings or an outline with internal AI** sends only the selected content, including internal fields only for the Team audience. AI can propose bounded settings or reorder and rename existing slides. It creates no URLs, code, files or presets. Review and apply or reject the proposal, then generate the file or save the preset. Documents are generated in the browser without an external conversion service.

## Automated checks

`tests/export-documents.test.ts` inspects DOCX/PPTX archives, private sentinels, speaker notes, QR codes, internal Pages, filters and times after midnight. `tests/export-ai.test.ts` checks permissions, public/private context and rejection of identifiers or settings invented by the model. `tests/export-presets.test.ts` checks preset ownership and CRUD operations. These tests do not replace opening the files in the software used by the organization.
