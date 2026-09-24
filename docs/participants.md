# Assigning multiple facilitators and preparing invitations

The Facilitator field accepts multiple session collaborators, including invitees who have not created an account yet. Avatars and names come from the available participants; free text remains available for a team or a person without an account. Each block supports up to 20 assignments. The same person cannot be selected twice.

In **Share**, the owner adds an existing account or creates a session invitation. Creating a new account also requires the global administrator role or the administrator role for the relevant workspace. Owning a personal session does not grant that global permission. The offered roles apply only to the session: editor, timer facilitator, and viewer/commenter.

Invitations are valid for 72 hours. The link is shown only when created and is shared manually through a private channel of your choice. No invitation email is sent automatically. The invitee immediately appears in the facilitator picker; their opaque identifier stays the same after they accept the link and create an account. SSO acceptance under the `invited` policy uses the same mechanism. If another invitation has already created the account, the user signs in and accepts the remaining session invitations with that account.

Reissuing an invitation preserves its assignments while invalidating the previous link. Revocation or expiry removes the invitation from the available options. Existing assignments remain in the agenda's history; they never grant access. Removing a collaborator revokes their access even if their name remains on an old block.

Assignment identifiers, email addresses, and avatars are never exposed through the public link. Only the summary text in `facilitator` may appear there, if that column is public. Saving normalizes this text from the assigned people's names. Imports, copies between sessions, and duplication preserve names as text but remove identifiers, because each assignment belongs to its source session.

API tests cover assignment before registration, identifier continuity on acceptance, revocation/reissue, roles, forged identifiers, public projection, and recursive copying. The same tests pass on SQLite and PostgreSQL.
