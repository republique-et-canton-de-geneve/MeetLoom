# Use MeetLoom

## Prepare a session

1. Create a session or open the example from the dashboard. The example is an original, editable agenda.
2. Name the session and describe its purpose. Set the date, start time and timezone.
3. Add blocks. Edit their titles, durations (whole minutes, with − and + on either side) and descriptions directly. Later times update immediately. Hover the gap between two blocks and click the line or its **+** to insert a block, a group, a note or parallel activities at that spot. The trash icon on a block deletes it (Ctrl+Z undoes).
4. Groups and parallel activities are logical containers: their header only shows the time, the duration computed from their activities and a title. Parallel activities show one tab per room (plus an overview); add or rename rooms from the tabs. A group is a frame around ordinary blocks: blocks inside it look and behave like any other block. Add activities with **Add an activity to the group**, and drag blocks into a group or a parallel room, or out of it; a green line shows where the block will land. Durations are computed automatically.
5. The day's start time is the first block's start: that block is always locked, and changing either time changes both. Hover another block's start time and click the padlock to lock or unlock it. Open block details for its section, facilitator and fields; the panel names the block it shows and its row is outlined. A section groups blocks with the same label and can be collapsed.
6. Move a block using its handle or the arrows in its details. Undo/redo restores recent local changes.

Changes save automatically. Independent changes are merged; concurrent edits to the same field require explicit resolution. MeetLoom preserves the local copy and lets you export it before loading the latest server version. Internal links, notifications and the browser Back/Forward buttons wait for saving before leaving the editor. If a field is invalid, the network fails or a conflict occurs, the session remains open with a message. Do not close the tab while a save error remains unresolved.

### Work with two agendas

Open **Multi Plan**, choose another accessible session and select the days to show. Drag a block handle into the other panel to move it; hold **Ctrl** or **⌘** to copy it. Dropping onto a block inserts before it; dropping at the bottom appends it. Multiple selections transfer together, and groups retain their children.

Checkboxes and **Copy blocks** / **Move blocks** provide the same actions from the keyboard in either direction. A read-only source can be copied but not moved. The destination requires editing permission. Both agendas are saved before transfer. If a version has changed, the transfer is rejected without a partial move; unsaved drafts remain visible. Extracting a day creates a separate session, and imported internal fields remain private.

## Choose what is shared

The **Columns** panel has two independent settings:

- **Shown/hidden**: whether the column appears in the team's editor.
- **Team/team & visitors**: its server-enforced audience.

A column hidden in the editor can still be public. Choose **Team only** to protect its contents. Presentation notes use this setting by default. The title, section, times and general session description are public context in authorized visitor agendas; do not put confidential notes there.

New sessions also prepare Additional information, Objectives, Materials, Instructions and Context. These columns are internal and hidden by default; enable them in **Columns** as needed. The Materials column feeds the corresponding preparation view.

MCP applies an additional precaution: even the general session description is sent to an MCP client only with an explicit internal-data grant. Visitor links and MCP tokens therefore do not have identical projections. Facilitator names can be public when their column is public; account identifiers, email addresses and avatars remain internal.

Authorized session members can read team columns. Roles:

| Role                       | Read team notes | Edit agenda | Control timer | Manage access |
| -------------------------- | --------------- | ----------- | ------------- | ------------- |
| Owner                      | Yes             | Yes         | Yes           | Yes           |
| Editor                     | Yes             | Yes         | Yes           | No            |
| Facilitator                | Yes             | No          | Yes           | No            |
| Viewer                     | Yes             | No          | No            | No            |
| Visitor without an account | No              | No          | No            | No            |

From **Share**, the owner can generate a link, set its expiry and revoke it. **Show link** gives an existing link's address, QR code and preview again at any time. Links created before version 0.1.2, or imported from another installation, cannot show their address: **New address** replaces it while keeping the link's scope and comments (the previous address stops working). The preview uses the actual visitor page. After revocation, a browser viewing it clears the agenda on the next refresh.

**Discussion** (the speech-bubble button in the editor) gathers every conversation of the session in one chat-like list, the latest by the composer. Each conversation says who can read it: **Participants · link name** (people with that visitor link; comments must be allowed on the link) or **Team** (the session's collaborators only). Filter by Participants or Team, reply under the message you answer, and mark a conversation resolved: it stays visible, folded, for everyone. The composer chooses the audience of a new conversation (Participants by default when a link accepts comments), the link and the block it is about; Enter sends, Shift+Enter starts a new line, @ mentions a collaborator in team conversations. Visitors see the organizers' messages marked **Team**, and their name is remembered after the first message. Organizers get one notification per session for new visitor comments, which grows ("3 new visitor comments") until read. The bell updates within seconds and when you come back to the window, with a short chime for team members only (visitors never hear it); **Notification sound off** in the notifications panel silences it on that browser. Browsers only play it once you have clicked or typed in the page.

Administrators create account invitations in **My account & team → Accounts and invitations**. Send an invitation through your normal internal channel. It is single-use and expires after 72 hours. Once the account exists, the owner can add it to a session with the appropriate role.

## Run a session

Choose the day, then **Run session**. Timer timestamps are stored on the server, so reloading the tab does not reset it. Pause, resume, previous/next block and extensions are shared across views. Network updates can lag by approximately three seconds.

Durations planned at startup are retained to calculate schedule deviation. The default reference is the actual start: starting at 10:00 for an agenda planned at 09:00 does not automatically add an hour of delay. The timer shows the **projected end** against that plan ("Expected to end 2 min late"): time already spent, pauses included, plus what is left of the current block and the current durations of the blocks still to come. Overruns, moving on early, extensions and durations edited during the run (for example two more minutes on the last block) change it immediately; a block added during the run counts in full.

Moved on too early? Use **previous block**: the clock kept running for the earlier block, so it resumes with its own time plus the detour. Leave a block with 30 seconds left and come back 10 seconds later: 20 seconds remain. The countdown uses the block's current duration, so time added in the agenda (or with **+1**/**+5** once back) is taken into account. The block you left becomes upcoming again and starts fresh when you reach it.

Once the timer has passed a block, the agenda shows its **actual duration** (whole minutes, “< 1 min” under a minute) in a distinct amber style; hover for the exact time and the planned duration, click to edit the planned duration. **Use actual durations** at the end rounds each block down to whole minutes. For parallel activities, the longest room takes the actual time (its activities scaled proportionally) and shorter rooms keep their plan unless the actual time is shorter.

Every finished run is kept: **Versions & activity › Runs** (or **See past runs** when the timer ends) lists them with the planned and actual time of each step and the overall gap. The first run of a day is marked **Initial plan**: whatever durations are applied afterwards, it keeps the plan the day was designed with. **Restore this plan** or **Apply these actual durations** puts a run's durations back into the agenda, like any edit (Undo reverts it).

**From scheduled time** is always available: before the day's start time the timer counts down (“Starts in”), then the first block runs on time; after it, the timer catches up the elapsed time. A **parallel** block is one timer step lasting as long as its longest room; +1/+5 add time to the last activity of that room.

Did the timer advance automatically while discussion was still going? Increase the preceding block's duration in the agenda, or use **+1 min to previous** / **+5 min to previous**. If its new duration still covers the current moment, the timer returns to it with elapsed time preserved. Otherwise, timing of the current block is adjusted. A pause stays paused, and delay against the original plan is retained. Recovery applies to the last automatic transition and ends after manual navigation or an explicit stop. This follows the [documented Time Tracker behavior](https://help.sessionlab.com/en/articles/6103716-time-tracker-track-your-session-timing).

Locked times help plan the agenda and identify conflicts. Automatic advancement runs activities consecutively without waiting through gaps between locked times. Add an explicit break block or pause the timer to reserve that time during delivery.

Under the progress bar, a badge says whether the day is on schedule (neutral, with a check mark), late (amber, red from five minutes) or early (blue), followed by the **expected end** time and the **total time left** for the day. Visitors following a link see the same line. In a thin always-on-top window, the current block stays on the left of the countdown and the badge with the expected end on its right.

The progress bar turns orange at 20% remaining and red at 5%. The active minimap segment shows progress as well. These visual thresholds are independent of the sound setting below.

## Sounds

Sound settings let you choose an early warning in minutes or as a percentage of block duration, an end sound, tone and volume. A 20% threshold for a ten-minute block warns with two minutes remaining. A two-minute threshold does not play immediately when a one-minute block starts.

Session settings apply to all its blocks. Administrators can also set defaults for new sessions. Each device chooses whether to enable audio: clicking Start enables it for the controlling browser; other accounts must click the sound icon. Visitors do not play sounds. Autoplay restrictions and computer sleep can prevent an alert, so use the preview button before the session.

## Show timing during PowerPoint

The **Always-on-top window** control opens Document Picture-in-Picture when supported by desktop Chrome or Edge. It shows the current block, countdown and progress. Move it onto the presentation screen and keep the MeetLoom tab open.

The strip with the site address at the top of that window belongs to the browser: Chrome and Edge always show it so that no page can imitate another, and MeetLoom cannot hide it. Make the window shorter and MeetLoom keeps only the countdown and the progress bar.

When the API is unavailable, MeetLoom opens a separate window and explains that it cannot guarantee priority. On Windows, PowerToys Always On Top can pin it (`Win+Ctrl+T`). Test your PowerPoint full-screen mode and monitor setup before a real session. In a video call, sharing only the PowerPoint window can exclude the timer; share the appropriate screen if both must be visible.

## My account, announcements and problem reports

**My account & team** (the dashboard menu, or your name at the bottom of the sidebar) is a page of its own: profile, password and **Report a problem**, plus, for administrators, current activity, accounts and invitations, installation settings (including the announcement), backups and data, user feedback and logs.

- **Announcement:** administrators write a short message (information or warning) shown at the top of every page for accounts, sign-in included. It stays until an administrator removes it; nobody can close it. It is public: never put anything confidential in it.
- **Report a problem** (dashboard, the editor's More actions menu, or the account page): describe a problem or suggest an idea; the page concerned is filled in for you. You follow what became of your reports on the same page. No GitHub account is needed.
- **User feedback** (administrators): triage reports (received, in progress, done, dismissed). **Create a GitHub issue** opens a draft in your own browser, without the author's name, for you to review; the server never contacts GitHub.
- **Logs** (administrators): the server messages of every pod, by level and text, kept 14 days by default. They say what failed and why (a route, an SMTP or AI error code), never passwords, content or answers.

## AI, exports and history

**+ Feedback (ROTI)**, next to **+ Form** in the session contents, adds a ready-made end-of-session form: “Was this time together worth it?” rated 1 (wasted time) to 5 (excellent investment), and an optional comment. Edit or publish it like any form.

Forms also offer an **Image** question. Respondents can select PNG, JPEG or WebP; the browser reduces the file and removes its metadata before upload. Received images are visible only in response details for owners and editors. They are not sent to AI summaries or included in CSV. In anonymous mode, avoid photos that identify their author. After resizing, limits are 256 KiB per image and 512 KiB per response.

AI answers show their headings, lists and bold text as formatted text. A form's response summary is written in the interface language and answers your optional question first.

The **Assistant** panel keeps private conversations. Choose no context, the open session, specific sessions, the current workspace or all accessible workspaces. Including internal notes and Pages is explicit. AI proposes changes to blocks, dates, Pages and forms; review the preview, then apply or reject. Other sessions are references; only the open session can be changed. An outdated proposal cannot overwrite a newer version. Personal settings and organization/workspace instruction sets guide responses. These commands remain unavailable until an LLM is configured. See [Internal AI and document import](ai-and-import.md).

In **Export**, select Public or Team, days, columns, Pages, blocks and categories. Review the preview, then create a PDF using the print dialog, an editable Word document, PowerPoint or CSV. Original times are retained even when blocks are filtered out. Public documents exclude internal fields. Full-session JSON backups contain team data.

Set paper, orientation, font, layout, legend, materials and page breaks; save, update or rename a personal preset. For PowerPoint, choose and reorder slides, edit titles and select fields for speaker notes. An already published form can be added with its QR and a revocable link limited to that form. **Copy table** provides structured content for a spreadsheet. Internal AI can propose settings or a slide outline for review before application. See [Export a session](exports.md), including pagination differences between browsers and Word.

**Import** accepts MeetLoom JSON, DOCX, PPTX, XLSX, text-bearing PDF, CSV/TSV and UTF-8 TXT/Markdown. A configured internal vision model also supports PNG/JPEG. Map table columns or request an AI structure, then correct titles, durations and descriptions in the preview. Only the add action merges new days with fresh identifiers. Private fields in the file remain private even if destination columns are public. No source document is retained as an attachment. Size and processing limits are listed in the [import guide](ai-and-import.md).

History can restore a version, restore a day or copy it as a new day. Restoring an entire session or the active day requires stopping the timer first; copying a historical day preserves ongoing delivery. See [recovery and versions](workspaces-and-lifecycle.md).
