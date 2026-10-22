# Durable run history (capture schema 1)

New harness and direct executions create an `ExecutionLog` and a `RunRecord`
before starting the SSE producer. The existing log remains the identity and
status record. The new record identifies the capture schema, source, coverage,
and last committed sequence. No existing table is altered or historical row
backfilled; `init_db` creates the three additional tables.

`journal_stream` is shared by both execution paths. It sanitizes an event,
commits it, and only then delivers that same event over the existing SSE
vocabulary. Each run has one writer. `(run_id, sequence)` is the event identity;
events are appended, never rewritten by replay or finalization. Sequence,
terminal status, and any artifact are committed in one transaction. The journal
is authoritative; the legacy `result_json` is only read for older executions.

Coverage describes capture, independently of execution outcome:

| Coverage | Meaning |
| --- | --- |
| `complete` | The terminal `harness_done` event was committed, including failed or stopped outcomes. |
| `partial` | A new capture has no committed terminal event, including a currently active run. |
| `legacy_unknown` | No new capture record exists. Old output or event arrays remain readable without claiming completeness. |

Success is assigned only when committing `harness_done`. Closing after
`node_done` cannot manufacture success. Graceful closure/cancellation finalizes
under cancellation shielding. On sidecar startup, previously running logs are
marked `interrupted`; their events and coverage remain unchanged. The recovery
timestamp records detection, not an exact measurement of when the process died.
This assumes the desktop's single sidecar owns the database; simultaneous
sidecars sharing a database are not supported.

## API and presentation

All routes retain the existing sidecar authentication middleware.

- `GET /execute/logs`: existing last-50 listing, with coverage and last sequence.
- `GET /execute/logs/{id}`: existing result shape; new runs reconstruct the
  ordered `result.events` from the journal and include artifact metadata.
- `GET /execute/logs/{id}/events?after=0&limit=100`: exclusive integer cursor,
  ascending sequence, `next_cursor`, `has_more`; limit 1–500. Following the last
  returned cursor while new events arrive does not duplicate earlier events.
  Legacy runs return an empty page with unknown coverage, not synthetic events.
- `GET /execute/logs/{id}/artifacts`: immutable output metadata in event order.
- `GET /execute/logs/{id}/artifacts/{artifact_id}`: metadata plus saved content;
  IDs are checked against the requested run.

Activity and historical chat details show coverage and saved outputs. Selecting
an output retrieves its body through the authenticated API. Interrupted replay
shows an interrupted outcome instead of leaving a running transcript. Unknown
statuses no longer become completed in the client. Replay only reconstructs
history; it does not invoke an adapter, tool, or artifact registration.

## Artifacts and redaction

`node_done` registers a `node_output`; `tool_result` registers a `tool_result`.
Each output stores text or JSON inside SQLite, its media type, event sequence,
logical name, revision number, and SHA-256 of the stored UTF-8 JSON encoding.
Repeated outputs for the same logical name increment the version. Deterministic
artifact IDs and uniqueness constraints tie registration to the originating
event. Read/replay endpoints perform no writes. Artifacts reference both their
run and event in the schema.

Persistence and SSE share the shipped secret patterns, including the Studio's
additional provider key formats and structured credential fields. Streaming
text/reasoning retains possible credential prefixes until their boundary;
ordinary text is committed incrementally. Context survives interleaved tool or
phase events so split credentials, multiline assignments, and PEM bodies remain
redacted. Incomplete candidates are conservatively suppressed at boundaries.
Graceful closure saves remaining safe text. A hard kill may lose an uncommitted
candidate or short prefix; already delivered events were committed first.

## Limits of this increment

- No model execution resumption, command replay, scheduling, or policy/workspace changes.
- The registry captures emitted textual/JSON outputs, not arbitrary files or
  binary artifacts written in a workspace. It does not follow paths from outputs.
- The compatible detail endpoint still materializes all events for the existing
  reducer. The new event endpoint provides bounded pages; storage retention and
  large-history UI virtualization are not introduced here.
- Usage accounting keeps its existing finalization behavior; this increment
  does not reconstruct missing billing rows after a hard process exit.
- Tests use isolated temporary databases and secret profiles. Process-exit
  recovery is exercised in a separate Python process; physical disk failure and
  multi-process writers are not simulated.
