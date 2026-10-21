# Easton MCP docs adapter
Reads registered Google Docs as the signed in coach through a service account with domain wide delegation, so Google enforces the coach's own sharing.

## invariants
- docs_search returns only documents inside a registered root and nothing when the registry is empty
- docs_read exports a document as markdown only when it sits in a registered root
- the drive client acts as the signed in coach and reuses the token until it expires
- a coach string is quoted so it cannot change the drive filter
- docs_read answers each name on its own, keeps a drive failure to its name and reads a long title as a title

## works when
- typechecks
- boundary "docs_search returns only documents inside a registered root and nothing when the registry is empty" at listInRoots via test "docs_search returns only documents inside a registered root and nothing when the registry is empty"
- boundary "docs_read exports a document as markdown only when it sits in a registered root" at inRoots via test "docs_read exports a document as markdown only when it sits in a registered root"
- boundary "the drive client acts as the signed in coach and reuses the token until it expires" at googleDrive via guard "the drive client acts as the signed in coach and reuses the token until it expires"
- boundary "a coach string is quoted so it cannot change the drive filter" at driveString via guard "a coach string is quoted so it cannot change the drive filter"
- boundary "docs_read answers each name on its own, keeps a drive failure to its name and reads a long title as a title" at docsRead via guard "docs_read answers each name on its own, keeps a drive failure to its name and reads a long title as a title"

## why
The first docs use is the SOP set. A coach asks how something is done at Easton, Claude calls docs_search with the words of the question, then docs_read with the id or the exact title. A question that names the SOP costs one call. The tool budget for this adapter is two read tools plus the planned admin writes, under the shared prefix docs_.

The registry is the documents table in the state project. A root row of kind drive admits every document in that shared drive, in one Drive call with corpora drive. A root row of kind folder admits the direct children of that folder, because the Drive query filter in parents matches one level only, and folder rows combine into one call. A doc row admits that one document for docs_read. The registry is read through the service role key and cached for five minutes per function instance, so a warm call makes one Drive round trip for a search. docs_read makes one lookup and one export per name, in parallel across names.

The server never holds a Google SDK. jose signs the delegation assertion for the coach's email and plain fetch calls the token endpoint and the Drive REST API. The token endpoint answers once per coach per hour per instance. Drive exports a Doc as text/markdown, so no converter exists in this repo. Every coach string reaches Drive inside a quoted literal with backslashes and quotes escaped, which is the only escaping the Drive query language defines.

A document the coach cannot open answers found false with the reason, not an error, and a Drive failure on one name stays with that name, so the other names in the same call still answer. Only a 404 and the Drive reasons forbidden and insufficientFilePermissions mean no access; a rate limit or an export size limit surfaces with its Drive reason and a retry hint. A name that looks like a Drive id but answers nothing falls through to the title lookup. Two registered documents with one title answer found false and ask for the id. A doc row counts for the title lookup through one get per row. docs_read splits sixty percent of the result cap across the names, because JSON escaping grows markdown, and marks each truncated document. A removed registry row stays readable for up to five minutes on a warm instance, which is the cache price. Sheets and Slides wait for an export type each.

## refutations
- docs_search returns only documents inside a registered root and nothing when the registry is empty: drop the driveId parameter from the drive root call -> RED
- docs_read exports a document as markdown only when it sits in a registered root: make inRoots answer true -> RED
