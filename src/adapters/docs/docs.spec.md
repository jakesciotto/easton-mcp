# Easton MCP docs adapter
Reads registered Google Docs as the signed in coach through a service account with domain wide delegation, so Google enforces the coach's own sharing.

## invariants
- registered roots only: docs_search returns only documents inside a registered root and nothing when the registry is empty.
  over: a registry with one drive root, and an empty registry
  via: docs_search returns only documents inside a registered root and nothing when the registry is empty
  because: Google enforces what the coach may read, and the registry decides what the server offers at all, so a search must never reach past the registered roots
  crossing: coach -> google
  entrances: none
  refuted: drop the driveId parameter from the drive root call in listInRoots -> the test docs_search returns only documents inside a registered root and nothing when the registry is empty went red (2026-10-22)
  kinds: read
  checklist: scoped-reads declared as registered roots only
  checklist: redaction dismissed: a document leaves as the coach may read it in Drive, and nothing in it is designated sensitive
- root check on read: docs_read exports a document as markdown only when it sits in a registered root.
  over: a document inside a drive root and a document outside every root
  via: docs_read exports a document as markdown only when it sits in a registered root
  because: an id a coach pastes must not read a document the registry never admitted, even when the coach could open it in Drive
  crossing: coach -> google
  entrances: none
  refuted: make inRoots answer true -> the test docs_read exports a document as markdown only when it sits in a registered root went red (2026-10-22)
  kinds: read
  checklist: scoped-reads declared as root check on read
  checklist: redaction dismissed: a document leaves as the coach may read it in Drive, and nothing in it is designated sensitive
- drive as the coach: The drive client acts as the signed in coach and reuses the token until it expires.
  over: the first call and a second call inside the hour for one coach, and a call after the token expired
  via: the drive client acts as the signed in coach and reuses the token until it expires
  because: every Drive call must carry the coach's own delegated token, so Google applies the coach's sharing and the token endpoint answers once per coach per hour
  crossing: coach -> google
  entrances: none
  refuted: drop the expiry check on the cached token in delegatedTokens -> the test the drive client acts as the signed in coach and reuses the token until it expires went red (2026-10-22)
  kinds: credential
  checklist: capability-authorization declared as drive as the coach
  checklist: revalidated-permission dismissed: a token lives one hour and Google checks the coach's sharing on every call
  checklist: message-authenticity dismissed: the server signs the assertion itself and accepts no signed message here
  checklist: encrypted-storage dismissed: the token is held in memory for one function instance and nothing persists
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: separation-of-duties dismissed: no approval policy exists on a read
- drive through the client: The server reaches the Drive files endpoint only through the drive client.
  protects: DRIVE_FILES_URL
  chokepoint: googleDrive
  from: anywhere
  because: the files endpoint must be reached only with the coach's delegated token, the fields list and the timeout the client sets
  crossing: coach -> google
  kinds: credential
  checklist: capability-authorization declared as drive as the coach
  checklist: revalidated-permission dismissed: the delegated token lives one hour and Google checks the coach's sharing on every call
  checklist: message-authenticity dismissed: no signed message is accepted at this chokepoint
  checklist: encrypted-storage dismissed: nothing is persisted at this chokepoint
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: separation-of-duties dismissed: no approval policy exists here
- quoted coach strings: A coach string is quoted so it cannot change the drive filter.
  over: the strings driveString escapes, with backslashes and single quotes inside them
  via: a coach string is quoted so it cannot change the drive filter
  because: the Drive query language defines one escaping, and a coach string outside a quoted literal could widen the search past the roots
  crossing: coach -> google
  entrances: none
  refuted: driveString stops escaping single quotes -> the test a coach string is quoted so it cannot change the drive filter went red (2026-10-22)
  kinds: encoding, read
  checklist: semantic-preservation declared as quoted coach strings
  checklist: canonical-encoding dismissed: the string is a filter value, not an identity
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: scoped-reads declared as registered roots only
  checklist: redaction dismissed: a document leaves as the coach may read it in Drive
- one answer per name: docs_read answers each name on its own, keeps a drive failure to its name and reads a long title as a title.
  over: a call with several names where one name fails in Drive and one looks like a Drive id but is a title
  via: docs_read answers each name on its own, keeps a drive failure to its name and reads a long title as a title
  because: a coach asks for several SOPs in one call, and one failing name must not sink the others
  crossing: coach -> google
  entrances: none
  refuted: docs_read rethrows a drive failure instead of keeping it to its name -> the test docs_read answers each name on its own, keeps a drive failure to its name and reads a long title as a title went red (2026-10-22)
  kinds: output
  checklist: destination-confinement dismissed: the result returns to the caller and follows no hop
  checklist: redaction dismissed: a document leaves as the coach may read it in Drive
  checklist: commit-ordered-effects dismissed: a read has no irreversible effect
  checklist: circuit-breaker-policy dismissed: a Drive failure surfaces with its reason and a retry hint, and nothing opens a breaker
  checklist: declared-target-coverage dismissed: the names in the call are the whole target set and each answers
- collections: A collection filter searches only that root, every result names its collection and docs_list answers the registered collections.
  over: the registered root titles, a filter that names one, a filter that names none, and a result from each root
  via: a collection filter searches only that root, every result names its collection and docs_list answers the registered collections
  because: the kids and the adult shared drives answer as two collections, and Claude must learn their names in one call
  crossing: coach -> google
  entrances: none
  refuted: selectCollection returns every root regardless of the collection filter -> the test a collection filter searches only that root, every result names its collection and docs_list answers the registered collections went red (2026-10-22)
  kinds: read
  checklist: scoped-reads declared as collections
  checklist: redaction dismissed: a document leaves as the coach may read it in Drive, and nothing in it is designated sensitive
- partial search: A collection that fails in Drive leaves the others answering and marks the search partial.
  over: a search across an answering root, a failing root and a root where Drive reports an incomplete search, and a search where every root fails
  via: a collection that fails in Drive leaves the others answering and marks the search partial
  because: one shared drive that errors must not hide the SOPs in the others, and Claude must know when a result may miss documents
  crossing: coach -> google
  entrances: none
  refuted: listInRoots throws when any collection fails -> the test a collection that fails in Drive leaves the others answering and marks the search partial went red (2026-10-24)
  kinds: output
  checklist: destination-confinement dismissed: the result returns to the caller and follows no hop
  checklist: redaction dismissed: a failure reason names the collection and the Drive reason, never a document
  checklist: commit-ordered-effects dismissed: a search has no irreversible effect
  checklist: circuit-breaker-policy dismissed: a failing collection answers its reason per call, and nothing opens a breaker
  checklist: declared-target-coverage declared as partial search
