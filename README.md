# Factory

This is the public factory store for [Desk](https://github.com/ourostack/desk). It holds published session facts and the job reports built from them. It measures how agent work flows, never the people who do it.

## What this is for

This store is for anyone deciding how to get more accepted outcomes for less human attention: an operator, a team lead, or an agent improving its own system. The value it cares about is an outcome a human accepted. Everything measured here serves one question: how much human attention does an accepted outcome cost, and where does the rest go? Agent time, tokens and tool calls are inputs; they matter only because they help explain that ratio.

**Designed for many desks; proven on one so far.**

## How the public site shows numbers

The [public site](https://ourostack.github.io/factory/) shows every number with its state, so a missing measurement never looks like a zero.

- **Measured** figures show plainly. A measured zero is a zero.
- **Partial** figures carry the word "partial", "at least" or "at most" when the direction is known, and the reason on hover and in text for screen readers. Every partial measure has a direction in one table (`site/scripts/bounds.mjs`): lower, upper, or unknown when its causes pull opposite ways or it is a ratio or a median. A partial measure with no row there stops the build. A lower bound of zero reads "none recorded", and a partial duration under a second shows its milliseconds.
- **Populations**: each section caption names the sessions its numbers count (every published session, or the substantial sessions), from the same build data the numbers come from.
- **No data** figures say "no data" with the reason beside them. They never show a digit.
- **Totals** (sums, medians, shares) count only measured members and say how many: "4 of 7 finished jobs · 36 out of scope". Jobs a measure does not apply to by design (not finished, start before capture, host does not record) are not in the denominator and are counted beside it; missing data inside scope stays in it and makes the total partial. Figures taken from a task card are labeled "declared".
- **Trust** on each headline is `ok`, `thin sample` (fewer than 5 measured members) or `partial`, with the reason. Each trust line also shows capture coverage: the share of sessions still on disk that were captured, from the machines' capture records (below). A headline is `low coverage` when that share is under 50%, and `not measured (coverage unknown)` when the share could not be computed, so a missing share never reads as `ok`. With no capture record the trust line says so and never invents a percentage.
- **Health**: a panel shows the last successful data build, the coarse age of the newest intake, facts files by host, whether the last `factory-build` run was green, and one verdict with the reason. `broken` when the last build read is red (or the reports are unreadable); `stale` when the data is older than the threshold (the site itself not rebuilt in 36 hours, judged by the browser from the build stamp, or no new session for over seven days); `unknown` when it cannot be told (the build status could not be read, or the health file is missing, malformed or future-dated); `alive` only when a green last build was actually read and the stamp is fresh. When more than one holds, `broken` wins, then `stale`, then `unknown`. The page does not trust the health file: its own threshold is a constant in the page code. Pages rebuilds only after a green `factory-build`, so a red store build leaves the site quiet and the browser reads `stale` once the stamp passes the threshold. The capture coverage slot shows the store-wide share with the share per host; the unsigned deliveries slot counts delivered jobs awaiting an answer, with the longest wait; the open improvement items slot shows how many items are not closed and the oldest one's age, from the loop slot (below).
- **Job pages**: each job in the table opens a page listing every measure its report holds (waits by kind, pull requests and commits, tokens, rework signals), each with its state in words and its reason beside it.
- **Totals from the pipeline**: when the reports carry `rollups/totals.json` and stated tool-kind rows (a Desk that publishes facts `/2`), the headline totals and the tool-kind chart read them over every published session; a total that rests on sessions the host records only partly is shown as a lower bound. With older reports, the site sums the substantial sessions itself, over measured sessions only.
- **A regression check** runs in the site build and fails it if any number in `data.json` lacks a state, any total lacks its `n` of `N`, any value is `NaN` or `null`, any reason has no plain text, or any partial number has no direction.

The site names no person: pull requests appear as links with their number, issue titles appear only when auto-filed, and intake appears by day, never by hour.

## No who, no content, just how

A published facts file says how one agent session went: how long it lasted, how its time split between turns, tools, subagents and waits, which tool kinds it used and how often they failed or retried, which plugin and model versions ran, and which public pull requests and commits it touched, and the UTC day each task finished and the times of the operator's prompts and of pull requests on each task's own clock (below). It never says who did the work or what was said.

- **No who.** No contributor, operator, account, machine, host name, desk path or branch appears in any facts file.
- **Dates and times, and how precise they are.** Facts carry durations and offsets from the session start and from the task card's creation. The one calendar fact a task's facts carry is the UTC day the task finished, never a time of day. Times inside a task are on the task's own clock (an offset from its card's creation): the operator's prompts and the pull requests the session mentions. Pull request times come from GitHub, which already shows them. The site orders tasks by finish day and shows that day, with the source it rests on: a day taken from a later record (the card's last update, or the day the task's labels landed) is marked "on or before". Publishing finish days and prompt times makes the operator's working days and hours readable from the public Git history, and a later revert does not erase them. The operator accepted that cost on 2026-10-08, because accuracy and precision outrank privacy for this site.
- **No content.** No transcript text, prompt, response, tool argument, file content, file path, task title or free text leaves the contributor's machine. The only fact taken from a message is `stop.asks`, a yes/no bit for whether the agent's last message ended in a question mark; no text and no tool name are published.
- **Public references only.** References to private repositories are dropped and only counted.

## Sign-off and rework: what a human accepted

An agent's "done" is a delivery, not value. Value is an outcome a human accepted. A published facts file may therefore carry, per job and keyed by the job's one-way hash, what became of the job's delivery:

- **The answer.** Delivered and awaiting an answer, accepted, sent back, reopened, or not delivered yet. Whether a human was seen to give it (`verified`): an answer the factory did not see a human give is shown apart and never counted as an acceptance.
- **The reason**, when the work was sent back, from a closed list (not what was asked, a defect, the ask changed, incomplete, other).
- **The wait class** from delivery to the answer: under an hour, under a day, under a week, or a week or more. A delivery nobody has answered yet reads "waiting at least" its class's lower edge, never zero.
- **The returns**: each time the work moved backwards, the agent's reason from a closed list (agent error, changed ask, new information, external), where it was caught (inside the task, at review, after delivery), and whether it counts against first-pass yield (a return because the ask changed does not).
- **Human turns**, once Desk publishes them: per turn, its offset in the session and the size class of the prompt and of the output the human had to read. Never the text.

Still no who: no name, login or account says who signed, and no time says when it was signed; only the wait class travels. The site shows the counts of each answer, unsigned deliveries with the longest wait, first-pass yield with its `n` of `N` (an upper bound while answers are awaited), returns by catch point, and how often the agent's reason and the human's disagreed (at least that often, when some refusals were not witnessed). Jobs whose card predates sign-off are out of scope and counted beside each figure. Human attention per accepted outcome reads "not recorded yet" until Desk publishes the estimate, and "no accepted outcomes yet" while nothing has been accepted: never zero, never infinity; the numbers check fails the build if it ever shows a value beside zero accepted outcomes.

## How the waste table treats a doubtful label

The waste table reads Desk's rollup of the evaluator's labels, and it never shows a doubt as a sound figure. Desk publishes `confidence_ms` and per-row `evaluator_versions` from `desk.factory.labels/2`. A row that an older `/1` label speaks to reads "not sound, confidence not recorded".

- `unknown` is a real label, the evaluator's "looked and could not tell". It keeps its own row and its own time, is never added to another waste, and is always shown as not sound. Every share is taken of the waste and unknown time together (value and support time are not in it), so unknown time counts in that denominator, but not in the waste total, because it is not known to be waste.
- A row may record `confidence_ms` (`high`, `medium`, `low`, in milliseconds). It is recorded only when the three parts add up to the row's own time; anything else reads "not recorded", never zero.
- A row with time on low-confidence labels, or with no recorded confidence, is marked not sound, in words under the table as well as on hover.
- A row's `evaluator_versions` lists the distinct evaluator versions of the labels that contributed to it; the page names them, or says they were not recorded.
- A task's own labeled time counts a label only inside that task's own share of its session: the task's segments in the session's published facts. A session several tasks share is labeled whole by each task's evaluator, so without this its time would count once per task. A segment Desk marks `shared` is held by several tasks at once, and each of those tasks' own figures counts it; the labeled-waste overview counts each session's time once: the first task by ID that labeled a stretch of shared time keeps it, whatever it labeled it as (value included), and a task counts for a waste only when it adds time to it. A labeled session with no record of the task's share adds nothing and leaves the task's figures partial ("at least"), never the whole session; a label file whose stretches all fall outside the task's share counts as not labeled for that task.
- A public desk publishes job timing as withheld, segments included, so its tasks' labels read as share unknown and are not counted: a public desk's tasks have no labeled waste on this site.

## What the store guarantees

Every file under `facts/` passes the published schema, `desk.factory.published/1`, `/2`, `/3` or `/4`, which Desk defines and this store's CI enforces on every pull request with Desk main's validator. A stored file stays valid under every later version and is never rewritten, except by a correction from the same session that only grows. In every version, a value that is absent or null was not recorded, never a zero, and the file's `unavailable` list (at most every field with every reason once, 22 fields by 12 reasons today, so 264 entries) says which fields were not recorded and why:

- the shape is exact, and any unknown key is rejected;
- every string matches an enum or a strict pattern, and a string holding a date or a time of day is rejected, with one exception: a job's finish day (below);
- durations and offsets are bounded integers, so no value can be an epoch time;
- a file's name matches the host and session it describes;
- an existing file can only grow: the host and session stay the same, and the duration never decreases;
- validation errors report stable reason codes only and never echo the rejected value.

A `/3` file may carry a commit's `at_ms` (when the session recorded the commit, on the session clock) and the `outcomes` / `capped` flag (a session with more than 256 outcomes cut). Desk's validator accepts both only in a `/3` or `/4` file, so intake does too.

A `/4` file adds four keys, which Desk's validator accepts only in `/4` and requires there:

- **Finish day.** `jobs[].finished_on` is the UTC day the task finished, written `YYYY-MM-DD`, or `null`. It is the only date a facts file may hold. It must be a real calendar day no earlier than 2025-01-01, and intake refuses a day after the day the check runs. `jobs[].finished_basis` says where it came from: `transition` (the session moved the card to done or cancelled) or `card_updated` (the card's last edit, so the true day is on or before it). A day sits only on a job whose card was seen done or cancelled, and only with the timed source its basis names. A desk whose remote is public publishes no job timing, so no finish day.
- **Created pull requests.** `refs.prs[].created` says whether the session itself opened the pull request (`true`) or only mentioned it (`false`). A public desk publishes every pull request as `created: false`, because the public creation time of a pull request the session opened would date the session, and Desk's validator refuses `created: true` in a public desk's file.
- **Why the agent stopped.** Each `human_wait` interval carries `stop`: how the agent's turn ended (`end_turn`, `max_tokens`, `rate_limit`, `api_error`, `refusal`, `interrupted`, `ask_question`, `ask_plan` or `not_recorded`), whether its last message ended in a question mark (`asks`), and whether its own background agents were still running (`pending_agents`). The last two are `null` when the host does not say. No text and no tool name are published.

A correction under `corrections/` knows all four. It may name only what it could name for a `/3` file (a job entry's finish day is accepted but never written, because a jobs correction only cuts credit). It may write a `/4` key only into a `/4` file. When it replaces `refs` or `intervals`, every `/4` key it does not name stays as the file has it, matched by pull request (repo and number) or by human wait (kind, worker, start and end). The store refuses, rather than drops, a correction that names a pull request or a human wait the file does not hold without that key, and one that says `created: true` in a public desk's file.

The measurement contract, including what is collected locally, what is published and what never leaves the machine, is section 4 of the public [Agentic Engineering V2 RFC](https://github.com/ourostack/desk/blob/main/plugins/desk/docs/agentic-engineering-v2-rfc.md#4-the-factory-measuring-and-designing-the-work).

## Capture records: how much of the work the store sees

A figure built from captured sessions is only as honest as the share of real sessions it covers. Each contributing machine therefore publishes one capture record, `capture/<intake id>.json`, where the intake id is the same random id its intake pull requests already use as their branch name. A record holds counts per host and nothing else: how many root session files the host still keeps on disk, and how many of those were captured into facts, held on purpose (no consent or no store), frozen (facts that cannot be sent now), pending, never seen (no marker and no facts although the session sits in a desk's folder), or not in a desk. It holds no date, no path, no session id, no store or desk name, and it counts only sessions that belong to this store or to no store. Desk's validator checks the record's full shape, and the store's own rule (`.github/scripts/check-capture.sh`, run in both `factory-validate` and `factory-merge`) refuses a wrong path, a file over 2 KiB, an unknown key, a value its key does not allow (every count a whole number from 0 to 1,000,000, the buckets adding up to what is on disk, the flags true or false, the loop slot only its known counts, a host that could not be counted exactly `{"not_counted": true}`) or more than one record in a pull request. A refusal names the part: `capture_loop` is a loop slot that is not `loop_slot_v1` (its `v` is 1, only the keys below, each a whole number or null, `headless` a plain code, at most 512 bytes), and `capture_values` is the counts. The store checks the values itself, so free text cannot reach this repository even if Desk's validator were ever looser.

The site sums the records per host and shows the share captured with two caveats, always beside it:

- **Of sessions still on disk.** A host that deleted old transcripts is invisible here, so coverage is an upper bound.
- **Self-reported.** Each machine reports its own counts; the store cannot check them.

A machine withdraws its record by publishing an empty one (`"hosts": {}`), which the site counts as withdrawn and leaves out. A record whose last commit is older than 45 days is left out as stale, and the page says so. A machine sends its record again only when its counts change, so a machine that is still working but whose counts have not changed for 45 days is also treated as stale. A host whose machine could not count its sessions at all is sent as `{"not_counted": true}` in place of its counts, so no zero is ever sent for it: the site leaves that machine out of the host's sums and shares, counts it in the host's N, and says "a machine could not count this host's sessions" beside the figure and in the records column, and the host's figures read "no data" when no machine could count it. A host whose machine could not verify its session count (for example Codex while a rollout is still being written) is shown as unverified, in words, and each host row says how many records it rests on and how many of them are unverified. The site alarms when a host captured less than 80% of the sessions it could (with at least 10 of them), or when a machine's share fell by 15 points or more since its previous record. No machine is ever shown on its own.

A client sends its record only when this store says it accepts them, through a file `capture.json` at the root of the default branch holding exactly `{"capture":1}`. Desk's validator on `main` accepts capture records, so this store holds `capture.json`: a client sends its record with its next published facts. Until a machine has sent one, the site reads "no machine has published a capture record yet". Removing the file stops every client from sending; the records already here stay until their machines replace them.

## How the loop closes itself

The factory is meant to find its own problems and fix them without waiting for a person. The loop runs on the desks of the machines that contribute, not here: this store is where its results become visible.

1. **Detect.** Desk runs the waste evaluator on finished jobs by itself, bounded per day. The store's build raises an andon issue when a plugin release makes a quality measure worse, and one "Factory build needs attention" issue (label `build-failing`) when its own build fails; the next green build closes it.
2. **Route.** Every alarm, store build failure, Desk problem and system friction becomes exactly one improvement card on the desk, with its evidence as pointers (an issue number, a job id, a count), never text, paths or names.
3. **Fix.** Improvement cards are standing, pre-authorized work: an agent takes the oldest one when its other work allows, fixes the cause in a pull request and merges it where the repository allows.
4. **Verify and close.** A card closes only when the data confirms the fix: for a card that names a measure, the store's `kaizen` issue for that card is labeled `confirmed` by the kaizen check; otherwise the alarm that opened it has cleared. A fix the data does not confirm reopens the card. A card that cannot be confirmed after 14 checks closes as unverified, and is counted as such.

**What the site shows.** Desk sends each machine's loop health inside its capture record, as long as the machine's loop has measured in the last three days. A machine whose record has no `loop` slot is counted as one that sent no loop health: it runs an older Desk, or its loop has not run yet or has not measured for over three days (it is switched off or its measure step is failing), and the record cannot tell which. Its figures read "no data", never zero. The slot is a flat, content-free `loop` slot with these keys only: `v` (1), `improvement_open`, `improvement_claimed`, `improvement_shipped`, `improvement_verifying`, `oldest_open_age_days`, `closed_confirmed_month`, `closed_unverified_month`, `loop_alarms_open`, `steps_stale` and `headless` (the headless evaluator's state, a code). A missing or null value is "not recorded", never zero. Machines can work the same desk, so the site never adds their counts: each figure is the largest any one machine reports, with how many machines' records it rests on. An item open for 7 days or more, an open loop alarm or a stale loop step is an alarm on the page. A machine whose record has not changed for 72 hours is shown as quiet, and any age it reported is aged by its record's age before it is shown or compared with the 7-day alarm; a record older than 45 days is stale and not read as current. A machine that reports a blocked headless evaluator (no agent command, not signed in, or an unsupported host) is shown as a notice with how many machines, not as an alarm: Desk opens its own card after two blocked days, and that card reaches the page through the loop's own alarms. A sign-in that cannot be read is shown as "could not be told", not as blocked. The page says there is no loop alarm only when the oldest age, the loop's own alarms and the stale steps are all measured from current records and no machine is quiet or stale; otherwise it names the figures that are not recorded and how many machines are quiet or stale, and says the loop's health cannot be told.

**What merges on its own.** A maintenance pull request merges without a maintainer only when its head is in this repository (not a fork), its author maintains the store, its `factory-validate` run passed, and it only adds or modifies `corrections/*.json` records (each passing the store's correction rule) or `factory.json` (passing Desk's store-config rule). `factory-merge` merges it at the validated head, so a head that moved is refused. Everything else stays labeled `maintenance` for a maintainer: `intake.json` (it widens which plugins the store accepts), `capture.json` (it switches on capture records), anything under `.github/` (the code that judges intake), a deletion, and any pull request that mixes an allowed path with another. The rule is `.github/scripts/maintenance-allowlist.mjs`. A maintainer holds any pull request, data or maintenance, by marking it draft or labeling it `hold`: `factory-merge` leaves a maintainer's held pull request alone and never merges a held one. A held pull request from anyone else is still validated and rejected if it fails. Removing the hold takes effect at the next `factory-validate` run (a new push or a re-run), not at once. If GitHub refuses a merge or a label (a conflict, a moved head), only that pull request is affected; the others are still handled, and the run fails so the refusal is seen.

## Reading the reports

CI rebuilds the reports from `main` after every merge and once a day, and publishes them on the [`reports`](https://github.com/ourostack/factory/tree/reports) branch. That branch is generated: every build replaces it with a single commit, so it has no history.

- `index.md` lists every job with its lead time, active time and flow efficiency, then a coverage section: sessions bound to a job versus unattributed sessions, sessions per host, how often each field was unavailable and why, and the plugin versions seen.
- `jobs/<job>.md` answers four questions for one job: what happened, what mattered, what was waste, and what we could not see.
- `jobs/<job>.json` holds that job's normalized timeline and the formulas behind the report.
- A retired job keeps a page. When no session is credited to a job any more (its sessions were re-derived under newer binding rules, corrected or withdrawn), the build writes a short `jobs/<job>.md` that says so, for every job any facts file on `main` ever credited, so a task card that links one of those job IDs leads to that page instead of a missing file. A card whose job ID never appeared in `main`'s facts (no session was ever credited to the job, or its desk publishes keyed job IDs while the card links the plain one) still links a missing page, because the store cannot know that job. A retired job has no `.json` and is not counted anywhere.

A correction record under `corrections/` can only take job credit away: its `jobs` list is the most a session may be credited with, so a stale client's over-bound republish is cut back to it, and a later derivation that credits fewer jobs shows as it is.

A job is identified by a one-way hash. A contributor's Desk can compute the same hash, so a task card can link to its job's report, but the hash names no desk, task or person.

## Contributing

Contribution is opt-in. Desk asks once, when a desk is set up, whether to contribute to this store, and records the answer. Nothing is sent without a yes, and a later no stops delivery.

When a session starts, Desk publishes the facts of earlier sessions as one pull request per machine. CI validates the pull request, merges it when it passes, and closes it with a `factory-rejected: <code>` comment when it fails.

The store also checks plugin names on every facts file a pull request adds or modifies. The file must come from a Desk that withholds the names of plugins installed from private repositories, which records how many it withheld as `refs.private.plugins`, and it may name only plugins listed in `intake.json`. A file from an older Desk fails with `private_plugins_missing`, and a file that names an unlisted plugin fails with `plugin_not_public`; update Desk to contribute. A modified file is checked too, because an older Desk re-sends files already in the store, with every plugin name, as modifications. Files a pull request leaves alone are not checked again. A maintainer adds a plugin to `intake.json` once its source repository is public.

**Your GitHub account and the timing of your pull requests are visible.** An intake pull request is opened from the contributor's GitHub account, so that account appears as the pull request's author, like any other public contribution, and GitHub shows when the pull request and its commits were made. A rejected pull request stays readable after it is closed. The facts inside it still carry no identity, and no time of day.

Changes to anything outside the data paths, published facts under `facts/`, published waste labels under `labels/`, capture records under `capture/`, and bounded authenticated triage under `triage/`, are maintenance. Only a maintainer, someone with write access or more to this repository, can make them, through a pull request that passes validation; CI merges only the correction records and `factory.json` changes described under "How the loop closes itself", and leaves everything else for a maintainer.

## Trusted triage intake and inspection queue

Triage is a separate, public codes-only transport: `triage/<16 lowercase hex>.json`
with schema `desk.factory.triage/1`. A batch contains at most twenty bounded
rows. Only an **added regular Git blob at a new path** is eligible. Existing
batches cannot be replaced, removed, renamed or copied, even by a maintainer.
A correction or withdrawal is a new batch with higher row revisions; similar
new corrections are additions, not edits to historical files.

Both trusted validation and main-branch merge independently read the actual
PR actor and exact head from GitHub, then the actor's repository permission.
Successful write/admin permission (including maintain) is required for triage;
JSON ownership, Git authors and event association do not grant it. Unknown API
answers produce `triage_authority_check_unavailable` and leave the PR open.
Known non-maintainers receive `triage_untrusted_producer`. Ordinary contributor
facts retain their existing rules. The token-held step writes only its API
responses to a protected runner-temp snapshot; the token-free step invokes
the released Desk validator with that trusted snapshot through its runner
seam, plus the store's independent immutable Git check. Candidate scripts are
never executed by that validation. Before taking action, merge reads the
actor/head and known permission again; drift holds the PR for revalidation,
and every merge request pins the validated head with GitHub's `sha` guard.

**Introducing-PR bootstrap.** The PR workflow validates from its checked-out
base, not from head helpers. On a genuinely pre-triage base where both helpers
are absent and have never existed in its complete Git history, it reads the
exact Git merge-result change statuses and paths first. Any `triage` path,
unknown/malformed read or partial/deleted helper installation is an explicit
`triage_check_unavailable` failure. Only non-triage changes may then use the
unchanged previous Desk CLI path, with the existing correction, capture and
facts checks. The guard never copies or executes a helper from the candidate.
Once the helpers exist on base, missing/crashing checks remain failures, not
reasons to fall back. Main's merge/build/Pages workflows use the helpers from
the same complete main checkout after landing; this bootstrap does not enable
triage or change maintenance automerge eligibility.

Main builds reject malformed, dirty or nonregular triage data before reading
it. The site derives `data.json.improvements` and publishes that identical
value in `rollups/improvements.json` (`factory-improvements/1`). This is an
**inspection queue, not an execution queue or claim grant**. It retains the
highest revision of each opaque public ID. Equal-revision disagreement or
two IDs for the same public issue is a conflict. Omission never withdraws an
annotation. Stale/source-unknown/withdrawn rows remain explicit. Publication
age is coarse: a batch is fresh for at most 72 hours; it is not an exact review
time. Conflicting or incomplete coverage stays unknown and is never summed
across hosts. With no batches the state is `not_reviewed`, not a healthy queue.

Each row's availability is `verified_public_context`,
`private_detail_not_published` or `stale_or_conflicting`. Only positively public,
exactly matching evidence and basis revisions can supply context labels.
Current public issue/PR/job shapes supply no validated structured triage
decision, recommendation or continuation, so those fields remain
`{state:"unavailable",reason:"detail_not_published"}`. A title or gate code is
not a decision. Private human decisions remain actionable without publishing
their details: “Ask your linked agent to inspect the local annotation.”
The handoff carries only the public opaque annotation ID/revision, public
basis/pointers and `authority_limit:"inspect_only_no_new_authority"`. Its
`data_path` is `rollups/improvements.json`. Ownership not published remains
unknown; the linked agent must resolve the acknowledged ID on its own desk,
inspect only authorized local detail, and bring a recommendation to the
actual decision owner. It must not guess a card, publish private detail,
claim work or start implementation from this handoff.

The maintained numbers gate recognizes this closed queue **only at the exact
top-level `data.improvements` path** and validates it with the shared queue
validator. Invalid projection produces `triage_projection_invalid`; no other
measurement, nested subtree or schema string gets an exemption.

**Readiness stays off in this change.** The default-branch switch is a separate
reviewed maintenance change containing only `triage.json` with exactly
`{"triage":1}`, after trusted checks and deployed absence-state readers have
been proved. Missing/unreadable/malformed/extra-key/unknown switches are not
ready. This file is not created here and stays off the maintenance automerge
allowlist; `factory.json` and `capture.json` are unchanged. Intake/readers do
not enable a triage producer, runner or runtime.
