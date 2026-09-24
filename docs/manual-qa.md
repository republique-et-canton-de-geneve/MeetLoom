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

## Optional AI

- Used an isolated local mock implementing the OpenAI-compatible contract; no organizational Qwen endpoint was provided.
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
- Real Qwen, OIDC, SMTP, native Office rendering, audible playback, and the PowerPoint overlay need checks in the intended environment. No release or OpenShift deployment was performed.
- Security checkpoint: local `npm run check` passed with 225 tests, both TypeScript projects, and the production build. Six additional HTTP/API tests exercise rate-limit responses and expiry, IPv6 aggregation, account isolation across IP changes, shared profile/deletion budgets, and the explicit test-only bypass. The dependency audit reported zero vulnerabilities. No new browser UI behavior was introduced by this correction; the manual browser evidence above remains separate from these automated checks.
- Hosted verification of code commit `10b4f1a28e0b0d27429f0c541675263d2f9ea1e8`: [CI 35885304817](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35885304817) passed every job, including PostgreSQL. [Security 35885304655](https://github.com/republique-et-canton-de-geneve/MeetLoom/actions/runs/35885304655) passed the exact Docker build, arbitrary-UID/read-only-root runtime check, Trivy, and CodeQL. The separate CodeQL findings check `107264308348` also passed. The pause requested by the user follows this completed checkpoint; the final documentation-only follow-up records these results.
- Continuation checkpoint (branch `claude/epic-pascal-3gk99i`): local `npm run check` passed with 228 tests, both TypeScript projects, and the production build. The same 228 tests passed on a disposable PostgreSQL 16 database. Formatting checks passed and the production dependency audit reported zero vulnerabilities. Three new tests cover rate-limiter store shutdown when an application closes or fails to assemble. Hosted CI does not run on a pull request targeting `codex/meetloom-v1`; hosted results for these commits are expected once they reach that branch.
- Acceptance round 1 (`codex/meetloom-v1`): local `npm run check` passed with 251 tests, both TypeScript projects, and the production build. The same 251 tests passed on PostgreSQL 16, and formatting checks passed. Hosted checks run when these commits are pushed to `codex/meetloom-v1`.
- Acceptance round 2 (`codex/meetloom-v1`): local `npm run check` passed with 272 tests, both TypeScript projects and the production build; the same 272 tests passed on PostgreSQL 16; formatting checks passed.
