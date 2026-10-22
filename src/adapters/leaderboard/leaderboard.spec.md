# Easton MCP leaderboard adapter
Reads easton-leaderboard through the publishable key so Row Level Security applies, and returns the stored ERP and rank columns without computing them.

## invariants
- publishable reads: Every leaderboard tool reads through the client with the publishable key and a row cap, and the config refuses a secret key.
  over: every tool the adapter registers, called once with valid input, and a secret key, a service role token, an authenticated token and an anon token in the config
  via: every leaderboard tool reads through the client with the publishable key and a row cap, and the config refuses a secret key
  because: the public site reads with the same key, so a coach sees what the site shows, and Row Level Security is the only read boundary on the product tables
  crossing: coach -> leaderboard
  entrances: none
  kinds: credential, read
  checklist: scoped-reads declared as publishable reads
  checklist: capability-authorization dismissed: the registry checks leaderboard:read before any handler runs
  checklist: revalidated-permission dismissed: the scope travels in the bearer and a refresh re-resolves it
  checklist: message-authenticity dismissed: no signed message is accepted here
  checklist: encrypted-storage dismissed: the adapter stores nothing
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: redaction dismissed: every column read is public on eastonpodium.com
  checklist: separation-of-duties dismissed: no approval policy exists on a read
- quoted leaderboard strings: A coach string reaches the leaderboard filter only inside a quoted literal.
  over: names and academy values that hold commas, parentheses, quotes, backslashes and a filter fragment
  via: a coach string reaches the leaderboard filter only inside a quoted literal
  because: a coach string outside a quoted literal could add a clause to the or and and filters PostgREST parses
  crossing: coach -> leaderboard
  entrances: none
  kinds: read
  checklist: scoped-reads declared as publishable reads
  checklist: redaction dismissed: every column read is public on eastonpodium.com
- one answer per competitor: leaderboard_competitors answers each name on its own with one profile, the candidates for several matches, or not found.
  over: a name with one match, a name with two, an exact id, and a name with none
  via: leaderboard_competitors answers each name on its own with one profile, the candidates for several matches, or not found
  because: a coach asks about students by name, and a guess between two students with one surname would answer about the wrong child
  crossing: coach -> leaderboard
  entrances: none
  kinds: read
  checklist: scoped-reads declared as publishable reads
  checklist: redaction dismissed: every column read is public on eastonpodium.com
- stored ranking: leaderboard_rankings returns the stored rank and ERP in stored rank order and never computes them.
  over: a stored list whose ERP order differs from its rank order
  via: leaderboard_rankings returns the stored rank and ERP in stored rank order and never computes them
  because: the leaderboard owns its math, and a second implementation would drift from the site
  crossing: coach -> leaderboard
  entrances: none
  kinds: read
  checklist: scoped-reads declared as publishable reads
  checklist: redaction dismissed: every column read is public on eastonpodium.com
- leaderboard through the client: The server reaches the leaderboard REST endpoint only through the leaderboard client.
  protects: LEADERBOARD_REST_PATH
  chokepoint: leaderboardClient
  from: anywhere
  because: the client is the one place that sets the publishable key, the readable table list and the timeout
  crossing: coach -> leaderboard
  kinds: credential
  checklist: capability-authorization declared as publishable reads
  checklist: revalidated-permission dismissed: Row Level Security checks every request on the leaderboard side
  checklist: message-authenticity dismissed: no signed message is accepted at this chokepoint
  checklist: encrypted-storage dismissed: nothing is persisted at this chokepoint
  checklist: key-rotation-compatibility dismissed: nothing encrypted is retained
  checklist: separation-of-duties dismissed: no approval policy exists here
