# Private discussions and notifications

Every authenticated collaborator (owner, editor, facilitator, or viewer) can start a general or block-specific discussion, reply, and resolve or reopen the thread. Resolving checks a revision to avoid hiding a reply that arrived concurrently. Visitor comments use separate storage and routes; no private discussion appears through a public link.

The panel offers open, resolved, or all discussions, sorted by activity or agenda order. Badges count comments in open threads. The list loads 20 threads at a time, with the initial message and the 15 most recent replies; **View all replies** loads the complete thread. A thread holds at most 500 messages and a session at most 10,000 threads. Legacy comments become independent threads during migration, without changing their text.

In a comment, type `@` and select a collaborator. In a block's rich-text field, type `@` or use the corresponding toolbar button. The mention stores the account identifier, not just its name. Only current session members are suggested and can receive a notification. An identity from an imported document that is not a member is never notified.

The notification bell includes new comments/replies, mentions, and completed tasks that mention an account. It opens the relevant session and comment/block. Authors are not notified of their own actions. Block changes create notifications in the same transaction as the save; a rejected version creates none. A save that increases the number of completed tasks generates one task-completion notification per block and recipient; multiple boxes checked in that save are grouped.

Notifications do not contain copies of comment text. Session access is checked again whenever the inbox is read: removing a member immediately removes access to that session's notifications. The in-app mentions preference hides mentions and task completions while keeping their stored events for later reactivation. Ordinary comments/replies remain visible. The inbox retains 1,000 events per account and displays the 100 most recent; **Mark all as read** applies to the entire inbox.

Internal notifications work without an external service. Optional SMTP enables email digests and reminders when an administrator has configured it and the account has enabled those preferences. See [authentication and email configuration](services-auth-mail.md). Tests use a mock transport and send no real messages.

Functional references: [SessionLab discussions](https://help.sessionlab.com/en/articles/4473078-add-and-reply-to-comments-from-collaborators), [SessionLab mentions and notifications](https://help.sessionlab.com/en/articles/8930976-tagging-collaborators-and-in-app-notifications).
