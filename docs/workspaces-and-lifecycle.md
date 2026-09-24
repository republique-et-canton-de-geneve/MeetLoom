# Organize, complete, and recover sessions

## Workspaces and access

The dashboard selector shows all accessible sessions, personal sessions only, or one workspace. **Create workspace** makes you its administrator. **Manage** lets you change its name, organization, logo, and members.

Workspace administrators manage settings and access. Editors can create and edit workspace sessions; viewers can read them. Members can access all sessions in their workspace. Guests have only the access granted individually to selected sessions. The **Members and guests** tab shows the sessions each person can access and lets you remove all their access within that workspace.

Owners retain rights to their sessions even if their workspace role changes. To remove an owner's access, first move or transfer the sessions they own. A workspace retains at least one active administrator. An existing account is added directly by email address; for a new account, an invitation link valid for 72 hours is generated and must be shared with the person. This action does not automatically send a message.

A session's **Change workspace** action is restricted to its owner. It exposes the session to members of its destination. Existing individual access and public links are preserved. A workspace must be empty before deletion.

Folders and subfolders persist even when empty. Select personal space or a team workspace, then use folder actions in the dashboard toolbar. Renaming also moves subfolders and updates their sessions' filing; it preserves agendas and permissions, including for closed sessions. Deletion requires a subtree without sessions, including archived sessions. Personal folders belong to the account; editors and administrators manage team folders, while viewers can read them. Guests see only paths belonging to sessions they can access.

The **Activity** filter finds recently opened sessions or unread changes. A green dot indicates a version newer than the one this account viewed. Read markers belong to each user; opening a session under another account does not mark it read for collaborators.

## Defaults for new sessions

In **Manage → Organization and defaults**, choose columns and visibility, categories, timezone and start time, and export preferences. You can copy settings from an accessible session: columns and layout, categories, pages, forms, sounds, and scheduling. Prepare pages or forms in a session, then copy those settings for new workspace sessions.

These settings apply only at creation. They do not modify existing sessions. Every page, form, section, and question receives new identifiers. Responses and publication links are never copied. Before saving content from another session, check that it is suitable for the destination workspace's members.

The logo is a PNG, JPEG, or WebP image stored in the application; no remote image is downloaded. Export settings are read when the export dialog opens and can still be changed for that document. A team export may contain internal columns.

## Close a delivered session

After stopping the timer, open **Close / delete** from dashboard actions or **Session status** in the editor. Choose facilitators from the collaborators, then close the session.

The agenda, timer, and comments become read-only. Forms stop accepting responses. Public agenda links remain readable within their usual scope. The owner, a workspace administrator, or an application administrator who has access to the session can reopen it. Duplicating a closed session creates a new editable personal session without copying sharing links or closure state.

**Session report** gathers closed sessions accessible to the signed-in account. Filters cover closure date, facilitators, and tags. The report distinguishes planned duration from time measured by the timer; sessions without measurements do not contribute to the measured total.

## Archives, trash, and recovery

Archiving is an organizational tool. It neither closes a session nor disables its links. In contrast, **session trash** hides the session from all collaborators and makes its agenda and form links inaccessible. The owner or an authorized administrator can restore it for **30 days**. Membership, sharing scopes, and any closure state are preserved: restoring a closed session does not reopen it.

After the deadline, the API rejects restoration. Physical cleanup is opportunistic, in batches of at most 25 sessions when viewing the trash or deleting a session. Related data—comments, versions, responses, and links—is removed with permanent deletion. An external backup may retain a copy according to its own retention policy.

The **History → Deleted items** tab covers items within a session, with **72-hour** retention. A day, block, group, page, or form can be restored individually. Group content is retained together; a child already moved elsewhere is not duplicated during restoration. Reintroduced content remains private where necessary, and form publication is not automatically reactivated.

History supports up to 100 automatic versions and 100 named versions protected from automatic rotation. The log retains the latest 1,000 events. Save changes before creating a named version. Restoring an active day requires stopping the timer first; copying a historical day to a new day preserves the current run.
