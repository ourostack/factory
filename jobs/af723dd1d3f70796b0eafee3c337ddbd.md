# Job af723dd1d3f70796b0eafee3c337ddbd

## What happened

- Status: done (measured).
- Sessions: 1 bound, 1 on the job clock (measured); by host: copilot-cli 1 (measured).
- Shared work: 0 sessions shared with 0 other jobs (measured).
- Lead time: 61057350 ms (partial: the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span; inferred evidence).
- Recorded request to delivery: not recorded (the original request was not recorded and recorded work began before the task card).
- Queued before production: not recorded (the original request was not recorded and recorded work began before the task card).
- Production time: 14810642 ms (measured; basis: recorded activity, done transition, lifecycle history).
- Recorded working time in production: 11836744 ms (measured; basis: recorded activity, lifecycle history).
- Production not recorded as active (not by itself idle time or waste): 2973898 ms (measured, inferred evidence; basis: recorded activity, done transition, lifecycle history).
- Production periods: -54 to 14810588 ms (recorded activity to done transition) (measured).
- Queue before start: 0 ms (measured).
- Active time: 12559515 ms (measured) in total; inside the lead-time window: 11836690 ms (measured).
- Active before card (work before the task card existed, outside lead time): 54 ms (measured).
- Busy time: 13839809 ms (measured); parallelism: 1.1 (measured, inferred evidence).
- Flow efficiency: not recorded (the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span).
- Concurrent sessions: maximum 1, average 1.00 (measured, inferred evidence).
- Concurrent agents: maximum 1, average 1.00 (measured, inferred evidence).
- Waits: human 2972093 ms (measured), permission 0 ms (measured), API retry 0 ms (measured), compaction wait time 0 ms (measured).
- Tool calls: desk 15, edit 18, mcp 113, other 25, read 6, search 3, shell 50, skill 3 (partial: the job owns only some workers of a session, and that session is not counted; 1 session uncovered).
- Public pull requests: none (partial: the host records only some of it, so this is a lower bound; 1 session uncovered); public commits: 0 (measured); private pull requests counted: 0 (partial: the host records only some of it, so this is a lower bound; 1 session uncovered); private commits counted: 0 (measured).
- Tokens: total, input, output, cache read, cache write, reasoning not recorded (the job owns only some workers of a session, and that session is not counted).
- Status transitions: processing at -54 ms, collaborating at 1003982 ms, processing at 3051214 ms, collaborating at 6862426 ms, done at 14810588 ms (measured).
- Sign-off: delivered, waiting at least 1 day.
- First-pass yield: 1, upper bound (passed so far, waiting for sign-off).
- Rework: returned in the task 0, at review 0, after delivery 0; reason check on refusals: compared 0, disagree 0.
- Human attention: about 7.8 minutes over 5 human turns (an estimate, method version 1; partial: the host records only some of it, so this is a lower bound).

## What mattered

- Lead-time contributors: not recorded (the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span).
- Longest single wait: human wait, 1630696 ms (measured).

## What was waste

Not classified yet: no session of this job has labels from the independent evaluator.
- Candidate signals only (inferred): 16 tool failures (partial: the job owns only some workers of a session, and that session is not counted; 1 session uncovered), tool retries not recorded (the job owns only some workers of a session, and that session is not counted), API retries not recorded (the job owns only some workers of a session, and that session is not counted), 0 session re-touches (measured).
- Wait signals: human 2972093 ms (measured), permission 0 ms (measured), API retry 0 ms (measured), compaction wait time 0 ms (measured).

## What we could not see

- CI runs: it is not collected yet (1 session).
- Session end time: the session was still open (1 session).
- Human turns: the host records only some of it, so this is a lower bound (1 session).
- Plugins: it is withheld because the store is public (1 session).
- Pull requests: the host records only some of it, so this is a lower bound (1 session).

How to read these numbers: measured means every session that should supply a number did; partial means the number is a lower bound or covers only some sessions, and the reason follows; not recorded means there is no number, which is never zero. API retry counts are the errors the host surfaced: Claude surfaces only some of them, so its count is a lower bound, and Codex does not record them. Human wait is the gaps between prompts inside a session. Tool failure and retry definitions differ by host: Codex reads an output layout it does not recognise as ok, and Copilot adds denied. The number of compactions is recorded on every host; compaction wait time is recorded only where the host records it. Cost in money is not measured in v0.
