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
- **Trust** on each headline is `ok`, `thin sample` (fewer than 5 measured members) or `partial`, with the reason. Capture coverage per host is not recorded yet, so the site says "coverage: not recorded yet" and never invents a percentage.
- **Health**: a panel shows the last successful data build, the coarse age of the newest intake, facts files by host, whether the last `factory-build` run was green, and one verdict with the reason. `broken` when the last build read is red (or the reports are unreadable); `stale` when the data is older than the threshold (the site itself not rebuilt in 36 hours, judged by the browser from the build stamp, or no new session for over seven days); `unknown` when it cannot be told (the build status could not be read, or the health file is missing, malformed or future-dated); `alive` only when a green last build was actually read and the stamp is fresh. When more than one holds, `broken` wins, then `stale`, then `unknown`. The page does not trust the health file: its own threshold is a constant in the page code. Pages rebuilds only after a green `factory-build`, so a red store build leaves the site quiet and the browser reads `stale` once the stamp passes the threshold. The unsigned deliveries slot counts delivered jobs awaiting an answer, with the longest wait; the slots for capture coverage and open improvement items read "not recorded yet" until those records exist.
- **Job pages**: each job in the table opens a page listing every measure its report holds (waits by kind, pull requests and commits, tokens, rework signals), each with its state in words and its reason beside it.
- **Totals from the pipeline**: when the reports carry `rollups/totals.json` and stated tool-kind rows (a Desk that publishes facts `/2`), the headline totals and the tool-kind chart read them over every published session; a total that rests on sessions the host records only partly is shown as a lower bound. With older reports, the site sums the substantial sessions itself, over measured sessions only.
- **A regression check** runs in the site build and fails it if any number in `data.json` lacks a state, any total lacks its `n` of `N`, any value is `NaN` or `null`, any reason has no plain text, or any partial number has no direction.

The site names no person: pull requests appear as links with their number, issue titles appear only when auto-filed, and intake appears by day, never by hour.

## No who, no when, just how

A published facts file says how one agent session went: how long it lasted, how its time split between turns, tools, subagents and waits, which tool kinds it used and how often they failed or retried, which plugin and model versions ran, and which public pull requests and commits it touched. It never says who did the work or when.

- **No who.** No contributor, operator, account, machine, host name, desk path or branch appears in any facts file.
- **No when.** Facts carry durations and offsets from the session start and from the task card's creation. No field holds a date, a time of day or an epoch value.
- **No content.** No transcript text, prompt, response, tool argument, file content, file path, task title or free text leaves the contributor's machine.
- **Public references only.** References to private repositories are dropped and only counted.

## Sign-off and rework: what a human accepted

An agent's "done" is a delivery, not value. Value is an outcome a human accepted. A published facts file may therefore carry, per job and keyed by the job's one-way hash, what became of the job's delivery:

- **The answer.** Delivered and awaiting an answer, accepted, sent back, reopened, or not delivered yet. Whether a human was seen to give it (`verified`): an answer the factory did not see a human give is shown apart and never counted as an acceptance.
- **The reason**, when the work was sent back, from a closed list (not what was asked, a defect, the ask changed, incomplete, other).
- **The wait class** from delivery to the answer: under an hour, under a day, under a week, or a week or more. A delivery nobody has answered yet reads "waiting at least" its class's lower edge, never zero.
- **The returns**: each time the work moved backwards, the agent's reason from a closed list (agent error, changed ask, new information, external), where it was caught (inside the task, at review, after delivery), and whether it counts against first-pass yield (a return because the ask changed does not).
- **Human turns**, once Desk publishes them: per turn, its offset in the session and the size class of the prompt and of the output the human had to read. Never the text.

Still no who and no when: no name, login or account says who signed, and no time says when; only the wait class travels. The site shows the counts of each answer, unsigned deliveries with the longest wait, first-pass yield with its `n` of `N` (an upper bound while answers are awaited), returns by catch point, and how often the agent's reason and the human's disagreed (at least that often, when some refusals were not witnessed). Jobs whose card predates sign-off are out of scope and counted beside each figure. Human attention per accepted outcome reads "not recorded yet" until Desk publishes the estimate, and "no accepted outcomes yet" while nothing has been accepted: never zero, never infinity; the numbers check fails the build if it ever shows a value beside zero accepted outcomes.

## What the store guarantees

Every file under `facts/` passes the published schema, `desk.factory.published/1` or `desk.factory.published/2`, which Desk defines and this store's CI enforces on every pull request with Desk main's validator. A stored `/1` file stays valid and is never rewritten. In either version, a value that is absent or null was not recorded, never a zero, and the file's `unavailable` list (at most every field with every reason once, 21 fields by 11 reasons today, so 231 entries) says which fields were not recorded and why:

- the shape is exact, and any unknown key is rejected;
- every string matches an enum or a strict pattern, and a string holding a date or a time of day is rejected;
- durations and offsets are bounded integers, so no value can be an epoch time;
- a file's name matches the host and session it describes;
- an existing file can only grow: the host and session stay the same, and the duration never decreases;
- validation errors report stable reason codes only and never echo the rejected value.

The measurement contract, including what is collected locally, what is published and what never leaves the machine, is section 4 of the public [Agentic Engineering V2 RFC](https://github.com/ourostack/desk/blob/main/plugins/desk/docs/agentic-engineering-v2-rfc.md#4-the-factory-measuring-and-designing-the-work).

## Reading the reports

CI rebuilds the reports from `main` after every merge and once a day, and publishes them on the [`reports`](https://github.com/ourostack/factory/tree/reports) branch. That branch is generated: every build replaces it with a single commit, so it has no history.

- `index.md` lists every job with its lead time, active time and flow efficiency, then a coverage section: sessions bound to a job versus unattributed sessions, sessions per host, how often each field was unavailable and why, and the plugin versions seen.
- `jobs/<job>.md` answers four questions for one job: what happened, what mattered, what was waste, and what we could not see.
- `jobs/<job>.json` holds that job's normalized timeline and the formulas behind the report.

A job is identified by a one-way hash. A contributor's Desk can compute the same hash, so a task card can link to its job's report, but the hash names no desk, task or person.

## Contributing

Contribution is opt-in. Desk asks once, when a desk is set up, whether to contribute to this store, and records the answer. Nothing is sent without a yes, and a later no stops delivery.

When a session starts, Desk publishes the facts of earlier sessions as one pull request per machine. CI validates the pull request, merges it when it passes, and closes it with a `factory-rejected: <code>` comment when it fails.

The store also checks plugin names on every facts file a pull request adds or modifies. The file must come from a Desk that withholds the names of plugins installed from private repositories, which records how many it withheld as `refs.private.plugins`, and it may name only plugins listed in `intake.json`. A file from an older Desk fails with `private_plugins_missing`, and a file that names an unlisted plugin fails with `plugin_not_public`; update Desk to contribute. A modified file is checked too, because an older Desk re-sends files already in the store, with every plugin name, as modifications. Files a pull request leaves alone are not checked again. A maintainer adds a plugin to `intake.json` once its source repository is public.

**Your GitHub account and the timing of your pull requests are visible.** An intake pull request is opened from the contributor's GitHub account, so that account appears as the pull request's author, like any other public contribution, and GitHub shows when the pull request and its commits were made. A rejected pull request stays readable after it is closed. The facts inside it still carry no identity and no time.

Changes to anything outside the two data paths, published facts under `facts/` and published waste labels under `labels/`, are maintenance. Only a maintainer, someone with write access or more to this repository, can make them, through a pull request that passes validation; CI never merges them automatically.
