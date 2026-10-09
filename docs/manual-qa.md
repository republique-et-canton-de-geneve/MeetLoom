# Manual acceptance testing

Executed in Chrome on September 23, 2026, using fictional data in the local test database on port 3001. The first-installation database on port 3000 is separate. These checks are not the maintained end-to-end suite, which is scheduled after user acceptance. French labels below identify the exact UI and test data used.

## Agenda editing and content

- Signed in, opened an agenda, changed its title and duration, saved, and reloaded it.
- Pressed Enter in a block title: a new block was created and its title selected. Entered “Synthèse au clavier”; entering `1h15` produced a 75-minute duration and recalculated subsequent times.
- Saved bold rich text and found it again after reloading. Fixed a first-click focus issue in Pages, then verified typing on the first click, changing the section to H2, and viewing that heading through a visitor link.
- Created a group with 25-minute and 10-minute activities. Both agenda and Overview showed 35 minutes. Enter in a child title created and selected the next child; adding “Restitution finale” increased the group to 45 minutes.
- Displayed description and duration as separate columns, then moved Notes before Facilitator. Headers and fields followed the new order.
- Resized the block inspector with the keyboard and assigned Camille Martin. Corrected an ambiguous checkbox label found during the test.
- Pinned the editable Page “Brief latéral” beside eight agenda blocks, then closed its side panel.
- Anchored an imported second block at 09:15 after a five-minute first block. The first block moved to 09:10, also shown in Overview. Switching display time zone to America/New_York and 12-hour format showed 03:10 AM and 03:15 AM without changing reference times.

## Sharing, Pages, and forms

- Created “Brief de l’atelier”, entered content, and set its audience to public. The visitor link displayed the Page; internal notes were absent.
- Published “Retour sur l’atelier” with a required 1–5 scale and “Always anonymous” responses. Empty submission was rejected; response 4 was accepted. The organizer saw one anonymous response with the correct question, value, and published version v1.
- Posted a visitor question under a visitor name and found the conversation within that link's scope. Disabling the link cleared previously displayed visitor content on automatic refresh.
- Fixed PATCH defaults that overwrote omitted sharing options, with API regression coverage. After rebuilding, reactivated the link with comments, the published form, and a Page as its initial destination. The visitor landed on the Page, retained the previous conversation, and successfully submitted response 5 through the embedded form.
- Created and published “Retour image – recette” with a required image question and anonymous responses. Uploaded a real PNG through Chrome's file chooser. Fixed image decoding to use `createImageBitmap` without weakening the content security policy. The preview appeared and submission succeeded. In the organizer's Responses tab, the authenticated image opened with a decoded width of 256 pixels and a completed load. API tests cover access denial to unauthorized readers; this was not repeated manually with another account.

## Imports, exports, and versions

- Imported two text rows, edited their preview to 5 and 15 minutes, and added a day without replacing the first one.
- After enabling file URL access for the Chrome extension, uploaded `qa-agenda.csv`, read its four columns, checked two activities with 5/75-minute durations, and added them to the agenda. Text/CSV imports no longer create duplicate empty native columns.
- Downloaded Word and PowerPoint files through the UI. Inspected their OOXML archives: expected content was present and private sentinel notes were absent from participant exports. Checked the integrated preview and saved the “Comité A4” preset. **Visual opening in Microsoft Office was not performed.**
- Excluded the first 15-minute activity from export and confirmed that the next activity retained its original 09:15 start in the preview.
- Triggered “Copy table” and received its success confirmation. HTML/TSV output has automated coverage. Pasting into native Excel was not verified because the browser tool's virtual clipboard is separate from the clipboard used by the page.
- Created “Recette avant modification”, viewed its day preview, and restored it by copying into a new day. The activity log showed the expected author, version, day, and added blocks.

## Organization, collaboration, and navigation

- Created workspace “Équipe recette”. Empty nested folders `Ateliers/Septembre` survived reload and workspace reselection. Opened the September subfolder, created a session, and confirmed that both the creation dialog and saved editor contained `Ateliers/Septembre`.
- Extracted a day into “Atelier extrait – recette” from Multi Plan. Changed its first block title in the secondary panel, opened a Page in the source session, returned to Multi Plan, and confirmed that the secondary title had been saved.
- Tried dragging a block across the two agendas through the browser automation drag command. The block did not move, so **native drag-and-drop is not recorded as manually verified**. The command-based transfer path and server contracts are assessed separately.
- Selected “Discussion” with the keyboard in Multi Plan and used Copy blocks. The UI confirmed the transfer; the original remained in the source and a second 12-minute block appeared in the destination. The confirmation explicitly stated that imported internal fields remain private.
- Opened “Revue équipe” in two tabs. Left a 10-minute duration field focused in the first tab, changed it to 15 in the second, then blurred and reloaded the first. It retained 15. Presence showed the second window.
- Changed “Discussion” to 12 minutes without submitting or blurring the field, used browser Back to return to the dashboard, and reopened the session. The 12-minute value was preserved by the navigation save guard.
- Posted a private comment, replied, resolved the thread, and found both messages using the Resolved filter.
- Closed the extracted session: its title became read-only and facilitation controls disappeared. The report showed one session and 3 h 32 planned. Moved it to trash, restored it within the 30-day window, and confirmed that it remained closed. Reopening restored editing and facilitation.

## Facilitation and responsive UI

- Started and paused the shared timer and observed the synchronized public view. Activated Document Picture-in-Picture without an error. **Keeping it above a real native PowerPoint slideshow remains unverified.**
- Set an advance reminder at 20% remaining, selected the soft sound, triggered its preview without an error, and saved preferences. Tool output does not establish that the physical speakers were audible.
- Started a 15-minute block, extended it to 16 minutes, paused, advanced, and finished. Applied actual durations, then restored the original 15/10-minute plan. Fractional duration display was limited to two decimal places without changing persisted values when an unedited field loses focus.
- Created a six-second block followed by a ten-minute activity. Enabled automatic advance after the first deadline, observed the next activity, and used “+1 min to previous”. The first duration became 1.1 minutes and the live timer returned to that extended block. Reset the timer afterward.
- Tested the English editor at a 390 × 844 viewport: the page remained within the viewport while the agenda grid had its own horizontal scroll. Switched to French and checked that the Columns panel was readable at that width. Removed the viewport override afterward.
- Restarted both local previews with the final build and without the mock AI provider. Checked the first-account screen on port 3000 in French, switched to English, and returned to French. No account or sample password is preinstalled in this first-installation database.

## Continuation smoke test (Claude Code, headless Chromium)

Executed on September 23, 2026 against a production build (`npm run build`, `node dist/server/index.js`) using a new SQLite database in a scratch directory and a fictional account. This is a smoke test of the continuation's changes, not a repetition of the scenarios above.

- Created the first account in French, reached the dashboard, and opened the “Une nouvelle séance” dialog. No page or console errors were reported.
- Found the workspace selector and “Créer un espace” flush against the sidebar's left edge (x = 0) while the workspace card was indented by 18 px. After the CSS correction, the selector and card both start at x = 18 at 1280 and 1000 px, at x = 10 at 800 px, and the mobile layout at 400 px is unchanged; no viewport produced horizontal page scrolling. Checked in French and English.
- Stored English as the interface language and reloaded: the UI was English but `<html lang>` remained `fr`. After the correction, the same reload reports `lang="en"`.
- The dashboard caption “ESPACE DE TRAVAIL” appears twice in the sidebar. This wording question is left for the user's acceptance review.

## Acceptance round 1 fixes (Claude Code, headless Chromium)

Executed on September 24, 2026 against a production build with a new SQLite database in a scratch directory and fictional data, after the user's first acceptance findings. The SessionLab reference video supplied by the user was reviewed frame by frame: after “Next” at about 15 s, then about 13 s on block 2, returning to block 1 resumed it at −0:46 and block 2 showed as not started.

- Created “Test séance” with two one-minute blocks (“bloc 1”, “bloc 2”) and started it with “Commencer maintenant”. After about 6 s the timer showed 00:55. “Bloc suivant” showed bloc 2 with 00:59. Changing bloc 1's duration to 2 in the agenda, then “Bloc précédent”, showed bloc 1 with **01:53 remaining** (2 min minus the time already spent) instead of 02:00. No page errors were reported.
- The time display row reads on one line at 1600 px: “Affichage des horaires”, the timezone select and the “12 h” checkbox. At 390 px it wraps without horizontal page scrolling.
- With no block, the start options read “Commencer maintenant” and “Depuis l’heure prévue (ajoutez d’abord un bloc)”, disabled; English shows “From scheduled time (add a block first)”. The explanation for a start time still ahead (“disponible dès 09:00”) is covered by unit tests, because the browser clock could not be moved before the scheduled time.
- The dashboard sidebar shows a single “ESPACE DE TRAVAIL” caption, no longer shows the “Un espace qui vous appartient” card, and lists the folders above the account footer.

## Acceptance round 2 fixes (Claude Code, headless Chromium)

Executed on September 24, 2026 against a production build with the scratch database from round 1.

- Sign-in shows “Pas encore de compte ? Les comptes sont créés sur invitation…” under the form.
- The start menu and “Animer la séance” are 10 px apart. Both start options are enabled; when the start time is still ahead, the option reads “(décompte jusqu’à HH:MM)” (unit-tested, since the browser clock could not be moved).
- Inserted a group between “bloc 1” and “bloc 2” with the “+” in the gap (menu: Bloc, Groupe, Note, Activités en parallèle). The group is framed around its activities. Added “Sous-activité” inline, moved “bloc 1” into the group and then moved a child back out with dispatched HTML5 drag events; the result survived a reload. Physical mouse dragging was not reproduced by the automation.
- The padlock beside a start time locks it (the time turns green) and unlocks it again.
- Opening details for one block and then another updates the “Bloc affiché” banner (“Nouveau groupe”, then “bloc 2”) and outlines exactly one row.
- During a run, the controls read “+1” and “+5”. After “Bloc suivant” a few seconds in, the passed block shows “< 1 min” in amber with the tooltip “Durée réelle : 0 min 3 s · prévue : 2 min · cliquer pour modifier la durée prévue”; clicking it focuses the planned duration field.
- The timer content rendered in a separate document with the `floating-window` class: at 520×260 everything is visible (clock 83 px); at 360×180 the kicker, position and delta are hidden (clock 58 px); at 220×90 only the clock remains (31 px). No size scrolled. The real Document Picture-in-Picture window was not resized by the automation.

## Acceptance round 3 fixes (Claude Code, headless Chromium)

Executed on September 24, 2026 against a production build with the same scratch database.

- Changing the day's start time to 13:30 moved the first row to 13:30, shown with the fixed padlock; typing 14:00 in the first row changed the day's start time to 14:00.
- A block inside “Nouveau groupe” renders as a full agenda row, identical to rows outside the group, followed by “Ajouter une activité au groupe · ou glissez un bloc ici”. Dragging that child over the last row shows a 3 px green line above it; dropping moves it out of the group (dispatched DragEvents; physical mouse dragging not reproduced).
- Clicking the insert line away from its “+” opens the insert menu.
- After locking then unlocking a time, moving the pointer away hides the open padlock.
- The timer content rendered as the floating window: at 560×188 kicker, title (22 px), position, clock (45 px), label, delta and progress bar are all visible; at 560×130 position and delta disappear; at 420×100 the kicker and label too; at 360×70 and 200×60 only the clock (18 px) and the progress bar remain.

## Acceptance round 4 fixes (Claude Code, headless Chromium)

Executed on September 24, 2026 against a production build with the same scratch database.

- Added parallel activities from the agenda footer: the block shows a compact orange header (time, “(10 min)”, title) with tabs “Vue d’ensemble”, “Salle 1 (… min)”, “Salle 2 (… min)” and “Ajouter une salle”. Added an activity to a room from its tab, added a third room from the tab bar, and renamed it in place. The header has no description, category, assignee or duration field.
- The group header is light blue with the time, “(0 min)” computed from its activities, the title and “Ajouter une activité au groupe”.
- Locking a block one minute before the previous block ends shows “1 min de chevauchement entre bloc 1 et bloc 2”; locking it at its own time, then unlocking it, shows no banner.
- Started “Depuis l’heure prévue” with the day at 23:30: the timer bar turned blue with “DÉBUT DANS” in amber and the countdown before the start.

## Acceptance round 5 fixes (Claude Code, headless Chromium)

Executed on September 24, 2026 against a production build with the same scratch database.

- In “Mon compte & équipe” → “Paramètres de l’installation”, enabled account creation for `example.test` and saved; the services list read “SMTP · non configuré”, “OIDC · non configuré”, “IA · non configuré”.
- From the sign-in page, “Créer un compte” showed “Créez votre compte avec une adresse @example.test.”; an `@autre.test` address was refused with the domain message, then `nouvelle@example.test` created the account and opened the dashboard (“Bonjour Nouvelle”). Sign-up was disabled again afterwards.
- Clicking the parallel block in the minimap scrolled its header into view and focused its title.
- A visitor link on a running session shows the always-on-top button beside the live timer; clicking it raised no error.

## Exploratory QA before the large acceptance test (gstack `/qa`, September 25, 2026)

Run by Claude Code on the production build (`NODE_ENV=production`, PostgreSQL 16, mock OpenAI-compatible LLM) in headless Chromium at 1440 px and 390 px, French and English, with fictional accounts (an administrator and a member) and a session "Atelier QA" with two days, groups, parallel rooms, a note, a Page and a published form. Every fix below has a test that fails without it, except the two layout ones, verified on screenshots.

- **Verified working:** first-installation key (wrong key refused), sign-up, duplicate account, wrong password (the same message for a disabled account, so no enumeration), FR/EN switch with no untranslated interface text, every editor panel, form building and publishing, visitor link with comments and without private notes, anonymous form submission from the link (required question enforced, confirmation, anonymous identity), timer start, +1/+5, next through parallel rooms to the end with the projected end moving by the expected minutes, the visitor following on a phone, account administration (disable signs out and refuses sign-in, re-enable, recovery link, self-demotion blocked in the UI and by the server), closing and reopening a session (read-only banner), trash and restore, version history day restore, the AI panel's error message when the model returns an invalid proposal. No browser console error apart from the one fixed below.
- **Fixed, timer on the device clock (medium):** countdowns compared server timestamps with each device's own clock; a visitor whose clock was ten minutes fast saw five minutes of overtime on a block that had just started. Responses now carry `X-Server-Time` and browsers correct their clock (`src/clock.ts`). E2E: a visitor with a skewed clock.
- **Fixed, finished session (low):** the timer bar kept "1 / 6", "restantes" and "Dans le temps prévu" after the last block, even when the session ended an hour early. E2E.
- **Fixed, date in UTC (low):** a session created between midnight and 02:00 in Geneva started on the previous day; the share dialog's expiry had the same shift. Unit test.
- **Fixed, mobile editor (medium):** at 390 px the days/pages/forms strip widened the page by 28 px and a dashboard rule hid every day's name. E2E at 390 px.
- **Fixed, keyboard (medium):** Escape did not close the "Autres actions" menu, nor the side panels until they were clicked. E2E.
- **Fixed, checkbox labels (cosmetic):** checkboxes rendered centered above their label in the form editor, share dialog and AI panel.
- **Fixed, presence after trash (low):** the closing editor tab got a 404 when leaving a trashed session. API test.
- **Fixed, visitor notes (cosmetic):** notes showed "0 min" on visitor links.
- **Seen, not changed:** in the editor a note still shows a 0 min field and a category (cosmetic); the invitation section tells an administrator that only the administrator can invite (wording). Not tested here: real LLM, OIDC, SMTP, Office rendering, audible alerts, the floating window above PowerPoint, native drag and drop.

## Number fields can be cleared (gstack `/investigate`, October 6, 2026)

Reported by the user with a screen recording: in "Le bon rythme, à votre façon", changing "Minutes avant la fin" from 1 to 2 required typing 2 after the 1, then deleting the 1. Replayed by Claude Code in headless Chromium (fr-CH) against a production build and a scratch SQLite database, keyboard only, as in the recording.

- **Before the fix:** cursor after "1", Backspace: the field still read "1"; typing "2" gave "12", which was saved (still "12" after reload). Typing "0.5" was impossible: the "0" was refused and the field went back to its previous value. In "Mon compte & équipe" → "Sauvegardes et données", "Sauvegardes gardées" behaved the same ("1", Backspace, "9" gave "19").
- **After the fix:** Backspace left "Minutes avant la fin" empty, typing "2" gave "2", saved ("Tout est enregistré") and still "2" after reload. Emptying the field and pressing Tab showed "2" again. Select all, then "0.5" typed one key at a time gave "0.5". "Sauvegardes gardées": emptied, then "9" gave "9".
- Not replayed in a browser: a form scale's minimum and maximum and the import durations use the same `NumberField`; `tests/number-input.test.ts` covers the bounds they pass.

## Agenda and dashboard feedback of October 7, 2026 (PR #37, headless Chromium)

The user sent screenshots and a screen recording. Each change was checked by Claude Code in headless Chromium (fr-CH, Europe/Zurich) against the production build, through a temporary Playwright journey that ran after the E2E suite and saved screenshots: French throughout, English where labels changed, at 1280–1920 px and 390 px. The temporary journeys were not committed. These are agent checks, **not user acceptance**.

- **Sections.** "+" between two rows offers "Section — Réunir les blocs qui suivent sous un titre". Inserting it above "Inclusion" gathered the four following blocks under "Nouvelle section", with the header "09:10 – 09:50 · 40 min" and the footer "Ajouter une activité à la section · ou glissez un bloc ici". Renamed in place, collapsed (its group hidden too) and removed ("Retirer la section"). Blocks were dragged onto a header, a row and a footer, and moved with the arrows across a section edge. The visitor link and print announce a section that contains a group once. At 390 px the remove button sits beside the title and the times on the line below. Renaming a collapsed section keeps it collapsed; renaming it to its neighbour's name merges them and "Annuler" splits them again.
- **Planned vs actual.** After a run with early, on-time, late and very-late blocks, each time cell showed the actual chip, the gap ("−2 min" blue, "=" grey, "+4 min" amber, "+6 min" red) and "prévu N min". Section and group headers, the day pill and the end of the agenda read "Prévu 1 h 30 min · réel 1 h 40 min +10 min". Versions & activité › Déroulés shows the same gap, "1 h 15 min de retard" in red for a very late run.
- **Minimap.** A group of four activities (5, 17, 32 and 16 min) is drawn as a light frame with its activities stacked inside in their own colours; parallel rooms side by side. During a run the finished activities fade and the current one is outlined with its live fill. A click on an activity inside a collapsed group or another room tab opened it and focused its title.
- **Closing reminder.** After finishing "Bilan E2E" with the timer, the dashboard showed the banner "3 séances terminées ne sont pas encore clôturées" (other journeys had finished sessions too) and the card reminder "Séance terminée · Clôturer ?". The reminder opened the closing dialog; "Clôturer la séance" showed "Séance clôturée : elle compte désormais dans le rapport des séances." and the card "Clôturée". The "À clôturer" filter and its empty state were checked in French and English.
- **Workspace kept.** In "Équipe E2E", a session was created, then "Toutes les séances" and a reload both kept "Équipe E2E" selected, with the address `/?workspace=<id>`. Covered by an E2E journey.
- **Folder list.** At 1920×910 the folder list grew from about 156 px to 271–351 px, with the avatar beside the name in the footer. At 900×480 the whole sidebar still scrolls.
- **"Gérer l’espace".** "Membres et invités" shows names and e-mails in full at 700 and 1280 px; at 390 px the role selector and the trash share one line under the name.
- **MCP panel and checkboxes.** In "Connecteurs IA (MCP)" each checkbox sits on its text's line, with the open session first, "N séances sélectionnées sur M", the permission explanations and the read-only warning. The same alignment was checked in the closing dialog, document import, the export block filter and PowerPoint notes option, and "Word en paysage".
- **Still to check by the user (real browser, Windows):** native drag-and-drop with a mouse; keyboard and screen-reader passes on the minimap and section headers; the folder list and the footer name "Jean-Pierre Froud" in Segoe UI at 100 % and 125 %; a team workspace's administrator and editor seeing the reminder on a colleague's session; the MCP panel inside the assistant on an installation with an LLM; Firefox for the nested minimap layout. In this headless environment two-digit durations in idle duration fields render clipped ("2( min"); that is unchanged by PR #37 and was not seen in the user's screenshots.

## Feedback of October 9, 2026: text fields, run following, always-on-top window (gstack `/investigate`, headless Chromium)

The user sent four screenshots and two screen recordings (not readable by the agent; the reports were taken from the user's descriptions). Replayed by Claude Code in headless Chromium (fr-CH, English where labels changed) against the production build and a scratch SQLite database, through throwaway Playwright scripts; the committed checks are the unit tests and E2E journeys listed in the handoff. These are agent checks, **not user acceptance**.

- **Card description cut.** The card's description box was 37 px high with a two-line clamp, but paragraphs inherit `line-height: 1.7` (22.1 px at 13 px), so two lines needed 44 px and the second lost its bottom. After the fix the box is exactly two of its lines (39 px).
- **Formatting bar.** Before: clicking the second line of a long block description moved the text 68 px down (the bar wrapped to two rows above it) and put the caret at the end of the text (offset 350 of 350); Tiptap's `autofocus: "end"` also scrolls the page there when the end is off screen. After: the text stays at the same position (381.75 px before and after), the bar floats on one row over the block title, the caret lands at the click (x 507 for a click at 510, second line), the page does not scroll. With the description 10 px from the top of the window the bar goes below the text.
- **Spaces removed.** The autosave (0.8 s after the last key) sends the draft through the session schema, whose `client` (and titles, labels) are trimmed, and the saved copy replaced what was on screen: typing "Acme ", pausing, then "Corp" gave "AcmeCorp". The folder field lost a trailing "/" the same way. After: "Acme Corp" and "Clients/Acme".
- **Following the run.** In a demo session at 1280×600, starting the timer scrolled the first block under the sticky timer (scrollY 0 → 503), and each "Bloc suivant" brought the next one up (654, 915, 1066). Scrolled back to the top, "Bloc suivant" left the page at the top. A visitor link at 1280×600 opened on the current block and kept it in view over four blocks (scrolling when it got low).
- **Always-on-top window** (popup fallback, same content and CSS; Document Picture-in-Picture is unavailable headless). At 1458×56 (the thin strip of the screenshots) the block title is 20.6 px and the countdown 36 px on one line with "Dans le temps prévu", "Fin prévue" and "reste" (before: 12 px and 18 px); 1458×110: 27.8 px and 49 px, with "EN CE MOMENT" and "1 / 8 · Jour 1" under the title; 600×200: 22.7 px and 54 px, the title on two lines; 1536×470: 54 px and 131 px (before: capped at 22 px and 45 px); 300×860: a centred column, countdown 96 px. No element left the window or was cut at these sizes, in French and in English. The dock menu lists the four edges, "Taille d’origine" and "Fermer"; in the popup, "Bandeau en bas de l’écran" moved and resized the window (headless reports a 600×200 screen, so the real position is for the user to check).
- **Still to check by the user (real browser, Windows):** the always-on-top window in Chrome or Edge: its text growing while it is resized, the dock button turning it into a strip or a column (the browser decides how far it can grow, about 80 % of the screen, and the person drags it to the edge), and its position remembered at the next opening; the agenda following the run during a real session (a description being typed in must not be interrupted); the formatting bar near the sticky timer while a session runs; the card description in Segoe UI at 100 % and 125 %.

## Optional AI

- Used an isolated local mock implementing the OpenAI-compatible contract; no organizational LLM endpoint was provided.
- Checked the current-session, workspace, all-authorized-sessions, and selected-sessions context choices. Private-column inclusion was unchecked.
- Requested a ten-minute activity. Its proposed title and duration appeared before any agenda mutation: the agenda still had two blocks. Only clicking Apply added the third block.
- Reloaded, reopened the conversation, and found the prompt and Applied status preserved. This verifies the integration flow and approval boundary, **not the quality or compatibility of the organization's real model**.

## Automated evidence and remaining environment checks

- `npm run check`: 219 tests passed on SQLite, both TypeScript projects passed, and the production build succeeded.
- The same 219 tests passed on PostgreSQL. The dependency audit reported zero vulnerabilities.
- Private projections, roles, concurrent writes, imports, exports, optional services, and lifecycle rules have unit/API coverage. This evidence does not mean every comparative checklist scenario in `product-parity.md` was run manually in both products.
- Linux runtime checks passed with an arbitrary unprivileged UID and a read-only root filesystem. A local build of the exact Dockerfile was blocked by the Docker engine's registry networking; GitHub's image build is tracked separately.
- On the original personal repository, GitHub CI and Security jobs did not start: the account was locked due to a billing issue, as shown in the run annotations. No hosted build, CodeQL, or Trivy success is claimed for those runs. The subsequent move to the organization repository has separate workflow results.
- On the organization repository, [CI run 35876559322](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35876559322) passed every job, including both database suites and deployment manifests. [Security run 35876559885](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35876559885) successfully built the exact image and verified arbitrary-UID/read-only-root operation. CodeQL analyzed the source but GitHub rejected the upload because Default setup was already enabled alongside the custom advanced workflow; this is not recorded as a successful CodeQL run.
- That first container scan reported four HIGH vulnerabilities in the base image's bundled npm dependencies. The runtime image subsequently removed npm/npx after dependency installation, and the SARIF action was corrected to honor the HIGH/CRITICAL filter without weakening that blocking policy.
- For commit `4d2b6b96a8ec0339849d806e9b49dde54db07e74`, [CI run 35877168096](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35877168096) passed all jobs. [Container job 107235972949](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35877168133/job/107235972949) passed the exact Docker build, arbitrary-UID/read-only-root smoke test, and Trivy gate for fixable HIGH/CRITICAL vulnerabilities. After the user approved switching to the advanced workflow, [CodeQL job 107258431671](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35877168133/job/107258431671) successfully uploaded its analysis. Its 11 rate-limit alerts and three unused imports prompted the checkpoint correction; successful execution alone was not treated as a clean security result.
- Real LLM, OIDC, SMTP, native Office rendering, audible playback, and the PowerPoint overlay need checks in the intended environment. No release or OpenShift deployment was performed.
- Security checkpoint: local `npm run check` passed with 225 tests, both TypeScript projects, and the production build. Six additional HTTP/API tests exercise rate-limit responses and expiry, IPv6 aggregation, account isolation across IP changes, shared profile/deletion budgets, and the explicit test-only bypass. The dependency audit reported zero vulnerabilities. No new browser UI behavior was introduced by this correction; the manual browser evidence above remains separate from these automated checks.
- Hosted verification of code commit `10b4f1a28e0b0d27429f0c541675263d2f9ea1e8`: [CI 35885304817](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35885304817) passed every job, including PostgreSQL. [Security 35885304655](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35885304655) passed the exact Docker build, arbitrary-UID/read-only-root runtime check, Trivy, and CodeQL. The separate CodeQL findings check `107264308348` also passed. The pause requested by the user follows this completed checkpoint; the final documentation-only follow-up records these results.
- Continuation checkpoint (branch `claude/epic-pascal-3gk99i`): local `npm run check` passed with 228 tests, both TypeScript projects, and the production build. The same 228 tests passed on a disposable PostgreSQL 16 database. Formatting checks passed and the production dependency audit reported zero vulnerabilities. Three new tests cover rate-limiter store shutdown when an application closes or fails to assemble. Hosted CI does not run on a pull request targeting `codex/meetloom-v1`; hosted results for these commits are expected once they reach that branch.
- Acceptance round 1 (`codex/meetloom-v1`): local `npm run check` passed with 251 tests, both TypeScript projects, and the production build. The same 251 tests passed on PostgreSQL 16, and formatting checks passed. Hosted checks run when these commits are pushed to `codex/meetloom-v1`.
- Acceptance round 2 (`codex/meetloom-v1`): local `npm run check` passed with 272 tests, both TypeScript projects and the production build; the same 272 tests passed on PostgreSQL 16; formatting checks passed.
- Acceptance round 3: local `npm run check` passed with 273 tests, both TypeScript projects and the build; the same 273 tests passed on PostgreSQL 16; formatting checks passed.
- Acceptance round 4: local `npm run check` passed with 275 tests, both TypeScript projects and the build; the same 275 tests passed on PostgreSQL 16; formatting checks passed.
- Acceptance round 5: see the handoff for the automated results of this round.
