# Collaboration and presence

Agenda writes remain protected by the expected SQL version. Each editor keeps its latest server version as a baseline and compares that version, its local draft, and the new remote version. Changes to independent fields merge automatically, including within groups and rooms. Object arrays use identifiers, never positions.

Independent additions and compatible reordering are preserved. Different changes to the same field, concurrent deletion and editing, incompatible identifiers, or contradictory ordering produce an explicit conflict. The local draft remains intact and can be exported before loading the remote version. Rich-text fields are editing units: this is not a character-by-character merge. Moving a block between groups while another person edits that block may also require explicit conflict resolution.

The client attempts at most two automatic rebases after a version conflict within one save. A failing connection or a continuously changing agenda therefore cannot cause an unlimited loop. Timer commands retain their strict revision and are never replayed automatically.

Presence comes from a signal sent every ten seconds by visible windows. A signal expires after thirty seconds; closing, navigating away, or moving to the background also requests its removal. Multiple windows belonging to one person are grouped. A connection error hides presence instead of implying activity. The server checks permissions on every call, then checks current membership before displaying names; member removal takes effect immediately. Email addresses and field contents are never sent through this API.

Presence is temporary: heartbeats are kept in the database for 30 seconds, so every application pod shows the same collaborators, and are limited to twenty windows per user and five thousand windows overall. No activity history is kept.
