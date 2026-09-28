# Factory

This is the public factory store for [Desk](https://github.com/ourostack/desk). It holds published session facts and the job reports built from them. It measures how agent work flows, never the people who do it.

## No who, no when, just how

A published facts file says how one agent session went: how long it lasted, how its time split between turns, tools, subagents and waits, which tool kinds it used and how often they failed or retried, which plugin and model versions ran, and which public pull requests and commits it touched. It never says who did the work or when.

- **No who.** No contributor, operator, account, machine, host name, desk path or branch appears in any facts file.
- **No when.** Facts carry durations and offsets from the session start and from the task card's creation. No field holds a date, a time of day or an epoch value.
- **No content.** No transcript text, prompt, response, tool argument, file content, file path, task title or free text leaves the contributor's machine.
- **Public references only.** References to private repositories are dropped and only counted.

## What the store guarantees

Every file under `facts/` passes the published schema, `desk.factory.published/1`, which Desk defines and this store's CI enforces on every pull request:

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

The store also checks plugin names on every facts file a pull request adds. The file must come from a Desk that withholds the names of plugins installed from private repositories, which records how many it withheld as `refs.private.plugins`, and it may name only plugins listed in `intake.json`. A file from an older Desk fails with `private_plugins_missing`, and a file that names an unlisted plugin fails with `plugin_not_public`; update Desk to contribute. Files already in the store are not checked again. A maintainer adds a plugin to `intake.json` once its source repository is public.

**Your GitHub account and the timing of your pull requests are visible.** An intake pull request is opened from the contributor's GitHub account, so that account appears as the pull request's author, like any other public contribution, and GitHub shows when the pull request and its commits were made. A rejected pull request stays readable after it is closed. The facts inside it still carry no identity and no time.

Changes to anything outside the two data paths, published facts under `facts/` and published waste labels under `labels/`, are maintenance. Only a maintainer, someone with write access or more to this repository, can make them, through a pull request that passes validation; CI never merges them automatically.
