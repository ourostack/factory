# Job 232de3a5bae0a2867da341bcde0adda5

## What happened

- Status: blocked (measured, declared evidence).
- Sessions: 3 bound, 3 on the job clock (measured); by host: claude-code 1, copilot-cli 2 (measured).
- Shared work: 0 sessions shared with 0 other jobs (measured).
- Lead time: 1101844363 ms (partial: the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span and the job was still open when this was measured; inferred evidence).
- Recorded request to delivery: not recorded (the original request was not recorded and recorded work began before the task card).
- Queued before production: not recorded (the original request was not recorded and recorded work began before the task card).
- Production time: at least 1101828752 ms so far (partial: the job was still open when this was measured; basis: recorded activity, latest observation, lifecycle history).
- Recorded working time in production: at least 324512269 ms so far (partial: the session log ended mid-record and the session was still open; basis: recorded activity, lifecycle history).
- Production not recorded as active (not by itself idle time or waste): 777316483 ms so far (partial: the job was still open when this was measured and the session log ended mid-record and the session was still open; inferred evidence; basis: recorded activity, latest observation, lifecycle history; direction not known, because its reasons pull it both ways, so the true figure may be higher or lower).
- Production periods: -391045 to 1101437707 ms so far (recorded activity to latest observation) (partial: the job was still open when this was measured).
- Queue before start: 0 ms (measured).
- Active time: 324512269 ms (partial: the session log ended mid-record and the session was still open; 2 sessions uncovered) in total; inside the lead-time window: 324121224 ms (partial: the session log ended mid-record and the session was still open; 2 sessions uncovered).
- Active before card (work before the task card existed, outside lead time): 391045 ms (partial: the session log ended mid-record and the session was still open; 2 sessions uncovered).
- Busy time: 371234122 ms (partial: the session log ended mid-record and the session was still open; 2 sessions uncovered); parallelism: 1.14 (partial: the session log ended mid-record and the session was still open; 2 sessions uncovered; inferred evidence).
- Flow efficiency: not recorded (the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span).
- Concurrent sessions: maximum 1, average 1.00 (partial: the session log ended mid-record and the session was still open; 2 sessions uncovered; inferred evidence).
- Concurrent agents: maximum 2, average 1.00 (partial: the session log ended mid-record and the session was still open; 2 sessions uncovered; inferred evidence).
- Waits: human 610829182 ms (measured), permission 0 ms (partial: the host does not record it; 1 session uncovered), API retry 0 ms (partial: the host records only some of it, so this is a lower bound; 1 session uncovered), compaction wait time 3004337 ms (partial: the host does not record it and the session was still open; 2 sessions uncovered).
- Tool calls: agent 7, desk 215, edit 260, mcp 2, other 305, read 444, search 40, shell 2020, skill 109, web 2 (partial: the session log ended mid-record and the job owns only some workers of a session, and that session is not counted; 3 sessions uncovered).
- Public pull requests: none (partial: the host records only some of it, so this is a lower bound; 3 sessions uncovered); public commits: 0 (partial: the host does not record it; 1 session uncovered); private pull requests counted: 0 (partial: the host records only some of it, so this is a lower bound; 3 sessions uncovered); private commits counted: 4 (partial: the host does not record it; 1 session uncovered).
- Tokens: total, input, output, cache read, cache write, reasoning not recorded (the job owns only some workers of a session, and that session is not counted).
- Status transitions: processing at 106 ms, validating at 4312228 ms, processing at 162690328 ms, blocked at 508767301 ms, processing at 508969653 ms, validating at 511367010 ms, processing at 581675279 ms, collaborating at 582535796 ms, processing at 659755507 ms, blocked at 800861364 ms, collaborating at 861037461 ms, processing at 872974463 ms, blocked at 926831417 ms, processing at 927108050 ms, blocked at 928036678 ms, processing at 928816139 ms, blocked at 935681055 ms (measured).
- Sign-off: not delivered yet.
- Rework: returned in the task 0, at review 2, after delivery 0; reason check on refusals: compared 0, disagree 0.
- Human attention: about 3.7 hours over 104 human turns (an estimate, method version 1; partial: the host records only some of it, so this is a lower bound).

## What mattered

- Lead-time contributors: not recorded (the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span).
- Longest single wait: human wait, 128064460 ms (partial: the host does not record it and the host records only some of it, so this is a lower bound and the session was still open; 2 sessions uncovered).

## What was waste

Not classified yet: no session of this job has labels from the independent evaluator.
- Candidate signals only (inferred): 175 tool failures (partial: the session log ended mid-record and the job owns only some workers of a session, and that session is not counted; 3 sessions uncovered), tool retries not recorded (the job owns only some workers of a session, and that session is not counted), API retries not recorded (the job owns only some workers of a session, and that session is not counted), 2 session re-touches (measured).
- Wait signals: human 610829182 ms (measured), permission 0 ms (partial: the host does not record it; 1 session uncovered), API retry 0 ms (partial: the host records only some of it, so this is a lower bound; 1 session uncovered), compaction wait time 3004337 ms (partial: the host does not record it and the session was still open; 2 sessions uncovered).

## What we could not see

- API retries: the host records only some of it, so this is a lower bound (1 session).
- CI runs: it is not collected yet (3 sessions).
- Commits: the host does not record it (1 session).
- Compaction wait time: the host does not record it (1 session).
- Session end time: the session was still open (2 sessions).
- Human turns: the host records only some of it, so this is a lower bound (2 sessions).
- Permission waits: the host does not record it (1 session).
- Plugins: it is withheld because the store is public (2 sessions).
- Pull requests: the host records only some of it, so this is a lower bound (3 sessions).
- Reasoning tokens: the host does not record it (1 session).
- Tool durations: the session log ended mid-record (1 session).
- Turns: the session was still open (1 session).
- First-pass yield: not recorded (the job has no standing delivery yet).

How to read these numbers: measured means every session that should supply a number did; partial means the number is a lower bound or covers only some sessions, and the reason follows; not recorded means there is no number, which is never zero. API retry counts are the errors the host surfaced: Claude surfaces only some of them, so its count is a lower bound, and Codex does not record them. Human wait is the gaps between prompts inside a session. Tool failure and retry definitions differ by host: Codex reads an output layout it does not recognise as ok, and Copilot adds denied. The number of compactions is recorded on every host; compaction wait time is recorded only where the host records it. Cost in money is not measured in v0.
