# Quick meeting countdowns

Drop one Outlook `.msg` or calendar `.ics` invitation on the welcome page or anywhere in the signed-in planner. No account or sign-in is needed for the countdown, including before the first installation account exists. MeetLoom reads its title and start/end times, starts a temporary countdown from the scheduled start, and immediately requests the floating progress window. You can also choose **Quick meeting** on the welcome page or dashboard and select a file. The file limit is 10 MB.

An ongoing meeting starts with its actual remaining time. A future meeting counts down to its start; an expired meeting appears complete. Calendar timestamps retain their timezone offsets and daylight-saving rules. Recurring invitations require a resolvable occurrence: the reader selects today's occurrence when present, otherwise the next occurrence, and displays the resolved date. Unsupported or ambiguous invitations are rejected instead of guessing a time. Export a single occurrence as `.ics` if needed.

The countdown exists only in this browser tab. It does not create a saved session, appear in session lists, or offer a visitor link. Closing the quick meeting, reloading, signing out, or closing the tab discards it. A new successful drop replaces the previous quick meeting. Existing saved agendas remain separate.

## Floating window

MeetLoom requests Document Picture-in-Picture synchronously from the drop or file-selection handler, before reading the file. Browser security rules can still require an explicit click. If automatic opening is refused, the countdown stays available and **Show always on top** retries with a direct click. Chrome and Edge on desktop support this API; the separate-window fallback in other browsers cannot guarantee always-on-top behavior. Native slideshow/full-screen behavior depends on the operating system and presentation mode.

## Optional invitation analysis

Invitation analysis requires sign-in and a configured internal AI. Anonymous countdowns do not grant access to the AI endpoint or stored agendas. **Analyze invitation agenda** sends only the title and plain-text body to the existing server-side agenda generator. Nothing is sent to AI merely by dropping an invitation. The browser first shows the proposed blocks; **Apply agenda** replaces the temporary outline while keeping the original scheduled start and catching up to the current block. Dismissal leaves the countdown unchanged. The outline remains temporary.

## When dragging from native Outlook takes time

On Windows, Chromium converts Outlook's virtual drag files into temporary files before delivering the web page's `drop` event. Browser/enterprise checks can also run at this stage. MeetLoom cannot read the invitation or open its progress window before this delivery. Changing the parser or replacing `DataTransfer.files` with the File System Access API does not bypass that stage. See [Chromium's documented drop sequence](https://chromium.googlesource.com/chromium/src/+/master/content/browser/web_contents/web_contents_view_aura.cc).

If this transfer is slow on your workstation, use an already exported `.msg`/`.ics`: drop that file or select it through **Quick meeting**. A local file avoids the Outlook-to-Chrome export step. The anonymous mode uses the same local reader; signing in does not speed up or slow down this native transfer. Measurements and their limits are recorded in [manual-qa.md](manual-qa.md).

Analysis supports whole durations of 5–1,440 minutes and a prompt of at most 8,000 characters, including the invitation and analysis instructions. The countdown itself can retain fractional minutes. No public AI fallback is configured.

## Privacy and processing

Invitation parsing runs in a dedicated, time-bounded browser worker. File contents, recipients, attachments, and meeting text are not uploaded for parsing, written to browser storage, or added to the application database. Attachments are not opened. Invitation text is treated as untrusted data and never rendered as HTML. Only an explicit AI-analysis request transmits the title/body to the configured provider through the authenticated API; the quick-meeting flow does not create an AI conversation history.
