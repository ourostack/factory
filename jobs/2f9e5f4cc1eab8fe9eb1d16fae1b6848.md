# Job 2f9e5f4cc1eab8fe9eb1d16fae1b6848

## What happened

- Status: done (measured).
- Sessions: 1 bound, 1 on the job clock (measured); by host: claude-code 1 (measured).
- Shared work: 0 sessions shared with 0 other jobs (measured).
- Lead time: 63887414 ms (measured).
- Recorded request to delivery: not recorded (the original request was not recorded and recorded work began before the task card).
- Queued before production: not recorded (the original request was not recorded and recorded work began before the task card).
- Production time: 63888121 ms (measured; basis: recorded activity, done transition, lifecycle history).
- Recorded working time in production: at least 59955180 ms (partial: some intervals ran outside the span of the session's main log, so they are left out; basis: recorded activity, lifecycle history).
- Production not recorded as active (not by itself idle time or waste): at most 3932941 ms (partial: some intervals ran outside the span of the session's main log, so they are left out; inferred evidence; basis: recorded activity, done transition, lifecycle history).
- Production periods: -707 to 63887414 ms (recorded activity to done transition) (measured).
- Queue before start: 0 ms (measured).
- Active time: 59955180 ms (partial: some intervals ran outside the span of the session's main log, so they are left out; 1 session uncovered) in total; inside the lead-time window: 59954473 ms (partial: some intervals ran outside the span of the session's main log, so they are left out; 1 session uncovered).
- Active before card (work before the task card existed, outside lead time): 707 ms (partial: some intervals ran outside the span of the session's main log, so they are left out; 1 session uncovered).
- Busy time: 163575663 ms (partial: some intervals ran outside the span of the session's main log, so they are left out; 1 session uncovered); parallelism: 2.73 (partial: some intervals ran outside the span of the session's main log, so they are left out; 1 session uncovered; inferred evidence).
- Flow efficiency: 93.84% (partial: some intervals ran outside the span of the session's main log, so they are left out; 1 session uncovered; inferred evidence).
- Concurrent sessions: maximum 1, average 1.00 (partial: some intervals ran outside the span of the session's main log, so they are left out; 1 session uncovered; inferred evidence).
- Concurrent agents: maximum 5, average 1.89 (partial: some intervals ran outside the span of the session's main log, so they are left out; 1 session uncovered; inferred evidence).
- Waits: human 5247904 ms (measured), permission not recorded (the host does not record it), API retry 0 ms (partial: the host records only some of it, so this is a lower bound; 1 session uncovered), compaction wait time not recorded (the host does not record it).
- Tool calls: agent 71, desk 53, edit 59, other 6, read 77, search 20, shell 2384, skill 4, web 1 (partial: some intervals ran outside the span of the session's main log, so they are left out and the job owns only some workers of a session, and that session is not counted; 1 session uncovered).
- Public pull requests: microsoft/playwright#43658, microsoft/playwright#43660, ourostack/desk#507, ourostack/desk#508, ourostack/desk#509, ourostack/desk#510, ourostack/desk#511, ourostack/desk#512, ourostack/desk#513, ourostack/desk#514, ourostack/desk#519 (partial: the host records only some of it, so this is a lower bound and the session's work was shared with another job; 1 session uncovered); public commits: not recorded (the host does not record it); private pull requests counted: 17 (partial: the host records only some of it, so this is a lower bound; 1 session uncovered); private commits counted: not recorded (the host does not record it).
- Tokens: total, input, output, cache read, cache write, reasoning not recorded (the job owns only some workers of a session, and that session is not counted).
- Status transitions: processing at -707 ms, validating at 63876767 ms, done at 63887414 ms (measured).
- Sign-off: delivered, waiting at least 1 hour.
- First-pass yield: 1, upper bound (passed so far, waiting for sign-off).
- Rework: returned in the task 0, at review 0, after delivery 0; reason check on refusals: compared 0, disagree 0.
- Human attention: about 43.9 minutes over 14 human turns (an estimate, method version 1; measured).

## What mattered

- Active time inside the lead-time window: 59954473 ms, 93.84% of lead time (partial: some intervals ran outside the span of the session's main log, so they are left out; 1 session uncovered; inferred evidence).
- Human wait: 5247904 ms, 8.21% of lead time (measured, inferred evidence).
- Lead-time contributors are partial: the host does not record it and the host records only some of it, so this is a lower bound and some intervals ran outside the span of the session's main log, so they are left out.
- Longest single wait: human wait, 2142887 ms (partial: the host does not record it and the host records only some of it, so this is a lower bound and some intervals ran outside the span of the session's main log, so they are left out; 1 session uncovered).

## What was waste

- Classified by the independent evaluator: 1 session labeled (measured).
- Muda: 552216 ms, 0.91% of labeled time, by type: waiting 552216 ms in 2 stretches (measured).
- Value 59834881 ms; support 120299 ms (measured).
- Mura (unevenness) flagged on 2 stretches; muri (overburden) on 2 stretches (measured).
- Candidate signals only (inferred): 82 tool failures (partial: some intervals ran outside the span of the session's main log, so they are left out and the job owns only some workers of a session, and that session is not counted; 1 session uncovered), tool retries not recorded (the job owns only some workers of a session, and that session is not counted), API retries not recorded (the job owns only some workers of a session, and that session is not counted), 0 session re-touches (measured).
- Wait signals: human 5247904 ms (measured), permission not recorded (the host does not record it), API retry 0 ms (partial: the host records only some of it, so this is a lower bound; 1 session uncovered), compaction wait time not recorded (the host does not record it).

## What we could not see

- API retries: the host records only some of it, so this is a lower bound (1 session).
- CI runs: it is not collected yet (1 session).
- Commits: the host does not record it (1 session).
- Compaction wait time: the host does not record it (1 session).
- Session end time: the session was still open (1 session).
- Permission waits: the host does not record it (1 session).
- Pull requests: the host records only some of it, so this is a lower bound (1 session).
- Reasoning tokens: the host does not record it (1 session).
- Tool durations: some intervals ran outside the span of the session's main log, so they are left out (1 session).
- Turns: some intervals ran outside the span of the session's main log, so they are left out (1 session).

How to read these numbers: measured means every session that should supply a number did; partial means the number is a lower bound or covers only some sessions, and the reason follows; not recorded means there is no number, which is never zero. API retry counts are the errors the host surfaced: Claude surfaces only some of them, so its count is a lower bound, and Codex does not record them. Human wait is the gaps between prompts inside a session. Tool failure and retry definitions differ by host: Codex reads an output layout it does not recognise as ok, and Copilot adds denied. The number of compactions is recorded on every host; compaction wait time is recorded only where the host records it. Cost in money is not measured in v0.
