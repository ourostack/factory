# Factory rollups

Totals and distributions across jobs, grouped by plugin version, host, job class and waste type; tool kinds are summed per session. They name no person, machine, date or time of day.

Only finished jobs count: every measure of a job that is not done or cancelled, or whose lead time is censored, is excluded because the job is not finished. Only complete values count: a measure a finished job could not supply, or could supply only for some sessions, is excluded and listed with its reason, never counted as zero. Jobs counted reads n of N: the jobs whose value counted, of all jobs in the group, open ones included. Compactions (count) is how many compactions happened, which every host records; compaction wait time is a different number and is recorded only where the host records it. Every group has a state: measured when n equals N, partial when some jobs counted, and not recorded when none did, in which case there is no median. A value the host records only partly is a lower bound, so it is left out of n and listed under its reason. Medians and p75 use the nearest-rank method: the value at rank ceil(p × n) of the counted values sorted ascending.

## Waste by type

Muda time from the independent evaluator's labels, largest first; ties are broken by waste name. A job counts only when it is finished and every one of its sessions is labeled. Each job counts only its own part of a session, and where several jobs hold the same time, a total counts it once. The unknown row, once any label could say it, is time the evaluator looked at and could not tell: it is not counted in muda time, but each row's share is of all labeled waste time, unknown included. Confidence is the time in the row by how sure the evaluator was; it reads not recorded when a label that speaks to the row is from an evaluator that recorded none. Evaluator versions are the versions of those labels.

### All jobs

Muda time: 256970241 ms (partial) across 15 of 39 jobs fully labeled; excluded: the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job). Sessions summed: 15, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 240593500 ms | 78.38% | 78.38% | 7 | 192801951 / 47166905 / 624644 ms | 3.2.0-alpha.202, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| unknown | 50000124 ms | 16.29% | 94.67% | 7 | 0 / 1787475 / 48212649 ms | 3.2.0-alpha.264 |
| defects | 15372279 ms | 5.01% | 99.67% | 13 | 2795890 / 12576389 / 0 ms | 3.2.0-alpha.258, 3.2.0-alpha.264 |
| extra_processing | 1004462 ms | 0.33% | 100.00% | 3 | 0 / 1003077 / 1385 ms | 3.2.0-alpha.202, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |

### By job class: other

Muda time: 256970241 ms (partial) across 15 of 39 jobs fully labeled; excluded: the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job). Sessions summed: 15, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 240593500 ms | 78.38% | 78.38% | 7 | 192801951 / 47166905 / 624644 ms | 3.2.0-alpha.202, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| unknown | 50000124 ms | 16.29% | 94.67% | 7 | 0 / 1787475 / 48212649 ms | 3.2.0-alpha.264 |
| defects | 15372279 ms | 5.01% | 99.67% | 13 | 2795890 / 12576389 / 0 ms | 3.2.0-alpha.258, 3.2.0-alpha.264 |
| extra_processing | 1004462 ms | 0.33% | 100.00% | 3 | 0 / 1003077 / 1385 ms | 3.2.0-alpha.202, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |

### By plugin version: 3.2.0-alpha.48

Muda time: 54458 ms (measured) across 1 of 1 jobs fully labeled; excluded: none. Sessions summed: 1, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 38580 ms | 70.84% | 70.84% | 1 | 38580 / 0 / 0 ms | 3.2.0-alpha.264 |
| defects | 15878 ms | 29.16% | 100.00% | 1 | 3786 / 12092 / 0 ms | 3.2.0-alpha.264 |
| extra_processing | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| unknown | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |

### By plugin version: 3.2.0-alpha.93

Muda time: 525107 ms (partial) across 2 of 3 jobs fully labeled; excluded: the job is not finished (1 job). Sessions summed: 1, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| unknown | 2355456 ms | 81.77% | 81.77% | 1 | 0 / 0 / 2355456 ms | 3.2.0-alpha.264 |
| defects | 525107 ms | 18.23% | 100.00% | 2 | 1586 / 523521 / 0 ms | 3.2.0-alpha.264 |
| extra_processing | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| waiting | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |

### By plugin version: 3.2.0-alpha.98

Muda time: 10057603 ms (measured) across 1 of 1 jobs fully labeled; excluded: none. Sessions summed: 1, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 9065664 ms | 90.14% | 90.14% | 1 | 9065664 / 0 / 0 ms | 3.2.0-alpha.202 |
| extra_processing | 991939 ms | 9.86% | 100.00% | 1 | 0 / 991939 / 0 ms | 3.2.0-alpha.202 |
| defects | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| unknown | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |

### By plugin version: 3.2.0-alpha.112

Muda time: 0 ms (measured) across 1 of 1 jobs fully labeled; excluded: none. Sessions summed: 1, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| defects | 0 ms | n/a | n/a | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| extra_processing | 0 ms | n/a | n/a | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| inventory | 0 ms | n/a | n/a | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| motion | 0 ms | n/a | n/a | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| non_utilized_talent | 0 ms | n/a | n/a | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| overproduction | 0 ms | n/a | n/a | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| transportation | 0 ms | n/a | n/a | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| unknown | 0 ms | n/a | n/a | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |
| waiting | 0 ms | n/a | n/a | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202 |

### By plugin version: 3.2.0-alpha.118

No fully labeled finished job yet (not recorded): 0 of 1 jobs fully labeled; excluded: the job is not finished (1 job).

### By plugin version: 3.2.0-alpha.147

No fully labeled finished job yet (not recorded): 0 of 1 jobs fully labeled; excluded: the job is not finished (1 job).

### By plugin version: 3.2.0-alpha.177

Muda time: 181851888 ms (partial) across 1 of 2 jobs fully labeled; excluded: the job is not finished (1 job). Sessions summed: 1, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 177390600 ms | 97.55% | 97.55% | 1 | 133955012 / 43435588 / 0 ms | 3.2.0-alpha.258 |
| defects | 4461288 ms | 2.45% | 100.00% | 1 | 0 / 4461288 / 0 ms | 3.2.0-alpha.258 |
| extra_processing | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.258 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.258 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.258 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.258 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.258 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.258 |
| unknown | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.258 |

### By plugin version: 3.2.0-alpha.192

Muda time: 4316 ms (measured) across 1 of 1 jobs fully labeled; excluded: none. Sessions summed: 1, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| defects | 2931 ms | 67.91% | 67.91% | 1 | 2931 / 0 / 0 ms | 3.2.0-alpha.264 |
| extra_processing | 1385 ms | 32.09% | 100.00% | 1 | 0 / 0 / 1385 ms | 3.2.0-alpha.264 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| unknown | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| waiting | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |

### By plugin version: 3.2.0-alpha.258

Muda time: 62348942 ms (partial) across 6 of 17 jobs fully labeled; excluded: the independent evaluator has not labeled it (5 jobs), the job is not finished (6 jobs). Sessions summed: 2, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 52450630 ms | 48.47% | 48.47% | 3 | 48094669 / 3731317 / 624644 ms | 3.2.0-alpha.264 |
| unknown | 45857193 ms | 42.38% | 90.85% | 5 | 0 / 0 / 45857193 ms | 3.2.0-alpha.264 |
| defects | 9898312 ms | 9.15% | 100.00% | 6 | 2539792 / 7358520 / 0 ms | 3.2.0-alpha.264 |
| extra_processing | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264 |

### By plugin version: mixed

Muda time: 2127927 ms (partial) across 2 of 6 jobs fully labeled; excluded: the job is not finished (4 jobs). Sessions summed: 8, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| unknown | 1787475 ms | 45.65% | 45.65% | 1 | 0 / 1787475 / 0 ms | 3.2.0-alpha.264 |
| waiting | 1648026 ms | 42.09% | 87.74% | 1 | 1648026 / 0 / 0 ms | 3.2.0-alpha.258 |
| defects | 468763 ms | 11.97% | 99.72% | 2 | 247795 / 220968 / 0 ms | 3.2.0-alpha.258, 3.2.0-alpha.264 |
| extra_processing | 11138 ms | 0.28% | 100.00% | 1 | 0 / 11138 / 0 ms | 3.2.0-alpha.258 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264 |

### By plugin version: unknown

No fully labeled finished job yet (not recorded): 0 of 5 jobs fully labeled; excluded: the independent evaluator has not labeled it (2 jobs), the job is not finished (2 jobs), only some sessions supplied it (1 job).

## Measures

Quality measures, which andon watches first, are marked (quality).

### All jobs

Jobs: 39; open, and so left out of every measure: 16.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 13 of 39 | 320052000 ms | 359776000 ms | the job was cancelled (2 jobs), the job is not finished (16 jobs), only some sessions supplied it (8 jobs) |
| queue_before_start | partial | 23 of 39 | 0 ms | 0 ms | the job is not finished (16 jobs) |
| active_time | partial | 10 of 39 | 995826 ms | 27785738 ms | the job is not finished (16 jobs), only some sessions supplied it (13 jobs) |
| flow_efficiency | partial | 3 of 39 | 0.01% | 20.72% | the job was cancelled (2 jobs), the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (8 jobs), the job is not finished (16 jobs), only some sessions supplied it (10 jobs) |
| human_wait | partial | 23 of 39 | 0 ms | 797996 ms | the job is not finished (16 jobs) |
| permission_wait | partial | 2 of 39 | 0 ms | 0 ms | the host does not record it (20 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| api_retry_wait | partial | 2 of 39 | 0 ms | 0 ms | the host records only some of it, so this is a lower bound (21 jobs), the job is not finished (16 jobs) |
| tool_failures (quality) | not recorded | 0 of 39 | not recorded | not recorded | the job is not finished (16 jobs), only some sessions supplied it (23 jobs) |
| tool_retries (quality) | not recorded | 0 of 39 | not recorded | not recorded | the job is not finished (16 jobs), the job owns only some workers of a session, and that session is not counted (23 jobs) |
| api_retries (quality) | not recorded | 0 of 39 | not recorded | not recorded | the job is not finished (16 jobs), the job owns only some workers of a session, and that session is not counted (23 jobs) |
| compactions (count) | not recorded | 0 of 39 | not recorded | not recorded | the job is not finished (16 jobs), the job owns only some workers of a session, and that session is not counted (23 jobs) |
| retouches (quality) | partial | 23 of 39 | 0 | 0 | the job is not finished (16 jobs) |
| muda_time | partial | 15 of 39 | 1217447 ms | 3992945 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.defects (quality) | partial | 15 of 39 | 138982 ms | 1570409 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.overproduction | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.waiting | partial | 15 of 39 | 0 ms | 1648026 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.non_utilized_talent | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.transportation | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.inventory | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.motion | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.extra_processing | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| search_waste | not recorded | 0 of 39 | not recorded | not recorded | published facts do not carry it (23 jobs), the job is not finished (16 jobs) |

### By plugin version: 3.2.0-alpha.48

Jobs: 1; open, and so left out of every measure: 0.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | not recorded | 0 of 1 | not recorded | not recorded | only some sessions supplied it (1 job) |
| queue_before_start | measured | 1 of 1 | 0 ms | 0 ms | none |
| active_time | measured | 1 of 1 | 52009 ms | 52009 ms | none |
| flow_efficiency | not recorded | 0 of 1 | not recorded | not recorded | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job) |
| human_wait | measured | 1 of 1 | 38580 ms | 38580 ms | none |
| permission_wait | not recorded | 0 of 1 | not recorded | not recorded | the host does not record it (1 job) |
| api_retry_wait | not recorded | 0 of 1 | not recorded | not recorded | the host records only some of it, so this is a lower bound (1 job) |
| tool_failures (quality) | not recorded | 0 of 1 | not recorded | not recorded | only some sessions supplied it (1 job) |
| tool_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| api_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| compactions (count) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| retouches (quality) | measured | 1 of 1 | 0 | 0 | none |
| muda_time | measured | 1 of 1 | 54458 ms | 54458 ms | none |
| muda_time.defects (quality) | measured | 1 of 1 | 15878 ms | 15878 ms | none |
| muda_time.overproduction | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.waiting | measured | 1 of 1 | 38580 ms | 38580 ms | none |
| muda_time.non_utilized_talent | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.transportation | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.inventory | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.motion | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.extra_processing | measured | 1 of 1 | 0 ms | 0 ms | none |
| search_waste | not recorded | 0 of 1 | not recorded | not recorded | published facts do not carry it (1 job) |

### By plugin version: 3.2.0-alpha.93

Jobs: 3; open, and so left out of every measure: 1.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 1 of 3 | 23579000 ms | 23579000 ms | the job is not finished (1 job), only some sessions supplied it (1 job) |
| queue_before_start | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| active_time | not recorded | 0 of 3 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (2 jobs) |
| flow_efficiency | not recorded | 0 of 3 | not recorded | not recorded | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job), the job is not finished (1 job), only some sessions supplied it (1 job) |
| human_wait | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| permission_wait | not recorded | 0 of 3 | not recorded | not recorded | the host does not record it (2 jobs), the job is not finished (1 job) |
| api_retry_wait | not recorded | 0 of 3 | not recorded | not recorded | the host records only some of it, so this is a lower bound (2 jobs), the job is not finished (1 job) |
| tool_failures (quality) | not recorded | 0 of 3 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (2 jobs) |
| tool_retries (quality) | not recorded | 0 of 3 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (2 jobs) |
| api_retries (quality) | not recorded | 0 of 3 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (2 jobs) |
| compactions (count) | not recorded | 0 of 3 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (2 jobs) |
| retouches (quality) | partial | 2 of 3 | 0 | 0 | the job is not finished (1 job) |
| muda_time | partial | 2 of 3 | 125866 ms | 399241 ms | the job is not finished (1 job) |
| muda_time.defects (quality) | partial | 2 of 3 | 125866 ms | 399241 ms | the job is not finished (1 job) |
| muda_time.overproduction | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.waiting | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.non_utilized_talent | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.transportation | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.inventory | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.motion | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.extra_processing | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| search_waste | not recorded | 0 of 3 | not recorded | not recorded | published facts do not carry it (2 jobs), the job is not finished (1 job) |

### By plugin version: 3.2.0-alpha.98

Jobs: 1; open, and so left out of every measure: 0.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | not recorded | 0 of 1 | not recorded | not recorded | only some sessions supplied it (1 job) |
| queue_before_start | measured | 1 of 1 | 0 ms | 0 ms | none |
| active_time | measured | 1 of 1 | 10497945 ms | 10497945 ms | none |
| flow_efficiency | not recorded | 0 of 1 | not recorded | not recorded | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job) |
| human_wait | measured | 1 of 1 | 9128212 ms | 9128212 ms | none |
| permission_wait | not recorded | 0 of 1 | not recorded | not recorded | the host does not record it (1 job) |
| api_retry_wait | not recorded | 0 of 1 | not recorded | not recorded | the host records only some of it, so this is a lower bound (1 job) |
| tool_failures (quality) | not recorded | 0 of 1 | not recorded | not recorded | only some sessions supplied it (1 job) |
| tool_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| api_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| compactions (count) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| retouches (quality) | measured | 1 of 1 | 0 | 0 | none |
| muda_time | measured | 1 of 1 | 10057603 ms | 10057603 ms | none |
| muda_time.defects (quality) | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.overproduction | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.waiting | measured | 1 of 1 | 9065664 ms | 9065664 ms | none |
| muda_time.non_utilized_talent | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.transportation | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.inventory | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.motion | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.extra_processing | measured | 1 of 1 | 991939 ms | 991939 ms | none |
| search_waste | not recorded | 0 of 1 | not recorded | not recorded | published facts do not carry it (1 job) |

### By plugin version: 3.2.0-alpha.112

Jobs: 1; open, and so left out of every measure: 0.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | measured | 1 of 1 | 359776000 ms | 359776000 ms | none |
| queue_before_start | measured | 1 of 1 | 28595060 ms | 28595060 ms | none |
| active_time | measured | 1 of 1 | 29229 ms | 29229 ms | none |
| flow_efficiency | measured | 1 of 1 | 0.01% | 0.01% | none |
| human_wait | measured | 1 of 1 | 0 ms | 0 ms | none |
| permission_wait | not recorded | 0 of 1 | not recorded | not recorded | the host does not record it (1 job) |
| api_retry_wait | not recorded | 0 of 1 | not recorded | not recorded | the host records only some of it, so this is a lower bound (1 job) |
| tool_failures (quality) | not recorded | 0 of 1 | not recorded | not recorded | only some sessions supplied it (1 job) |
| tool_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| api_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| compactions (count) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| retouches (quality) | measured | 1 of 1 | 0 | 0 | none |
| muda_time | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.defects (quality) | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.overproduction | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.waiting | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.non_utilized_talent | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.transportation | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.inventory | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.motion | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.extra_processing | measured | 1 of 1 | 0 ms | 0 ms | none |
| search_waste | not recorded | 0 of 1 | not recorded | not recorded | published facts do not carry it (1 job) |

### By plugin version: 3.2.0-alpha.118

Jobs: 1; open, and so left out of every measure: 1.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| queue_before_start | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| active_time | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| flow_efficiency | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| human_wait | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| permission_wait | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| api_retry_wait | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| tool_failures (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| tool_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| api_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| compactions (count) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| retouches (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.defects (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.overproduction | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.waiting | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.non_utilized_talent | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.transportation | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.inventory | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.motion | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.extra_processing | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| search_waste | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |

### By plugin version: 3.2.0-alpha.147

Jobs: 1; open, and so left out of every measure: 1.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| queue_before_start | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| active_time | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| flow_efficiency | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| human_wait | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| permission_wait | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| api_retry_wait | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| tool_failures (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| tool_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| api_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| compactions (count) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| retouches (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.defects (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.overproduction | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.waiting | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.non_utilized_talent | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.transportation | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.inventory | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.motion | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| muda_time.extra_processing | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |
| search_waste | not recorded | 0 of 1 | not recorded | not recorded | the job is not finished (1 job) |

### By plugin version: 3.2.0-alpha.177

Jobs: 2; open, and so left out of every measure: 1.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| queue_before_start | partial | 1 of 2 | 0 ms | 0 ms | the job is not finished (1 job) |
| active_time | partial | 1 of 2 | 62609950 ms | 62609950 ms | the job is not finished (1 job) |
| flow_efficiency | not recorded | 0 of 2 | not recorded | not recorded | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job), the job is not finished (1 job) |
| human_wait | partial | 1 of 2 | 143206512 ms | 143206512 ms | the job is not finished (1 job) |
| permission_wait | not recorded | 0 of 2 | not recorded | not recorded | the host does not record it (1 job), the job is not finished (1 job) |
| api_retry_wait | not recorded | 0 of 2 | not recorded | not recorded | the host records only some of it, so this is a lower bound (1 job), the job is not finished (1 job) |
| tool_failures (quality) | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| tool_retries (quality) | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (1 job) |
| api_retries (quality) | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (1 job) |
| compactions (count) | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (1 job) |
| retouches (quality) | partial | 1 of 2 | 0 | 0 | the job is not finished (1 job) |
| muda_time | partial | 1 of 2 | 181851888 ms | 181851888 ms | the job is not finished (1 job) |
| muda_time.defects (quality) | partial | 1 of 2 | 4461288 ms | 4461288 ms | the job is not finished (1 job) |
| muda_time.overproduction | partial | 1 of 2 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.waiting | partial | 1 of 2 | 177390600 ms | 177390600 ms | the job is not finished (1 job) |
| muda_time.non_utilized_talent | partial | 1 of 2 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.transportation | partial | 1 of 2 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.inventory | partial | 1 of 2 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.motion | partial | 1 of 2 | 0 ms | 0 ms | the job is not finished (1 job) |
| muda_time.extra_processing | partial | 1 of 2 | 0 ms | 0 ms | the job is not finished (1 job) |
| search_waste | not recorded | 0 of 2 | not recorded | not recorded | published facts do not carry it (1 job), the job is not finished (1 job) |

### By plugin version: 3.2.0-alpha.192

Jobs: 1; open, and so left out of every measure: 0.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | not recorded | 0 of 1 | not recorded | not recorded | only some sessions supplied it (1 job) |
| queue_before_start | measured | 1 of 1 | 0 ms | 0 ms | none |
| active_time | measured | 1 of 1 | 30155 ms | 30155 ms | none |
| flow_efficiency | not recorded | 0 of 1 | not recorded | not recorded | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job) |
| human_wait | measured | 1 of 1 | 0 ms | 0 ms | none |
| permission_wait | not recorded | 0 of 1 | not recorded | not recorded | the host does not record it (1 job) |
| api_retry_wait | not recorded | 0 of 1 | not recorded | not recorded | the host records only some of it, so this is a lower bound (1 job) |
| tool_failures (quality) | not recorded | 0 of 1 | not recorded | not recorded | only some sessions supplied it (1 job) |
| tool_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| api_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| compactions (count) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| retouches (quality) | measured | 1 of 1 | 0 | 0 | none |
| muda_time | measured | 1 of 1 | 4316 ms | 4316 ms | none |
| muda_time.defects (quality) | measured | 1 of 1 | 2931 ms | 2931 ms | none |
| muda_time.overproduction | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.waiting | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.non_utilized_talent | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.transportation | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.inventory | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.motion | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.extra_processing | measured | 1 of 1 | 1385 ms | 1385 ms | none |
| search_waste | not recorded | 0 of 1 | not recorded | not recorded | published facts do not carry it (1 job) |

### By plugin version: 3.2.0-alpha.258

Jobs: 17; open, and so left out of every measure: 6.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 8 of 17 | 320052000 ms | 333086000 ms | the job was cancelled (2 jobs), the job is not finished (6 jobs), only some sessions supplied it (1 job) |
| queue_before_start | partial | 11 of 17 | 0 ms | 0 ms | the job is not finished (6 jobs) |
| active_time | partial | 1 of 17 | 27785738 ms | 27785738 ms | the job is not finished (6 jobs), only some sessions supplied it (10 jobs) |
| flow_efficiency | not recorded | 0 of 17 | not recorded | not recorded | the job was cancelled (2 jobs), the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job), the job is not finished (6 jobs), only some sessions supplied it (8 jobs) |
| human_wait | partial | 11 of 17 | 0 ms | 45633 ms | the job is not finished (6 jobs) |
| permission_wait | not recorded | 0 of 17 | not recorded | not recorded | the host does not record it (11 jobs), the job is not finished (6 jobs) |
| api_retry_wait | not recorded | 0 of 17 | not recorded | not recorded | the host records only some of it, so this is a lower bound (11 jobs), the job is not finished (6 jobs) |
| tool_failures (quality) | not recorded | 0 of 17 | not recorded | not recorded | the job is not finished (6 jobs), only some sessions supplied it (11 jobs) |
| tool_retries (quality) | not recorded | 0 of 17 | not recorded | not recorded | the job is not finished (6 jobs), the job owns only some workers of a session, and that session is not counted (11 jobs) |
| api_retries (quality) | not recorded | 0 of 17 | not recorded | not recorded | the job is not finished (6 jobs), the job owns only some workers of a session, and that session is not counted (11 jobs) |
| compactions (count) | not recorded | 0 of 17 | not recorded | not recorded | the job is not finished (6 jobs), the job owns only some workers of a session, and that session is not counted (11 jobs) |
| retouches (quality) | partial | 11 of 17 | 0 | 0 | the job is not finished (6 jobs) |
| muda_time | partial | 6 of 17 | 1570409 ms | 3992945 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (6 jobs) |
| muda_time.defects (quality) | partial | 6 of 17 | 460248 ms | 3789541 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (6 jobs) |
| muda_time.overproduction | partial | 6 of 17 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (6 jobs) |
| muda_time.waiting | partial | 6 of 17 | 0 ms | 1208726 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (6 jobs) |
| muda_time.non_utilized_talent | partial | 6 of 17 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (6 jobs) |
| muda_time.transportation | partial | 6 of 17 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (6 jobs) |
| muda_time.inventory | partial | 6 of 17 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (6 jobs) |
| muda_time.motion | partial | 6 of 17 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (6 jobs) |
| muda_time.extra_processing | partial | 6 of 17 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (6 jobs) |
| search_waste | not recorded | 0 of 17 | not recorded | not recorded | published facts do not carry it (11 jobs), the job is not finished (6 jobs) |

### By plugin version: mixed

Jobs: 6; open, and so left out of every measure: 4.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 1 of 6 | 601084000 ms | 601084000 ms | the job is not finished (4 jobs), only some sessions supplied it (1 job) |
| queue_before_start | partial | 2 of 6 | 0 ms | 0 ms | the job is not finished (4 jobs) |
| active_time | partial | 1 of 6 | 995826 ms | 995826 ms | the job is not finished (4 jobs), only some sessions supplied it (1 job) |
| flow_efficiency | not recorded | 0 of 6 | not recorded | not recorded | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job), the job is not finished (4 jobs), only some sessions supplied it (1 job) |
| human_wait | partial | 2 of 6 | 0 ms | 1980715 ms | the job is not finished (4 jobs) |
| permission_wait | not recorded | 0 of 6 | not recorded | not recorded | the host does not record it (2 jobs), the job is not finished (4 jobs) |
| api_retry_wait | not recorded | 0 of 6 | not recorded | not recorded | the host records only some of it, so this is a lower bound (2 jobs), the job is not finished (4 jobs) |
| tool_failures (quality) | not recorded | 0 of 6 | not recorded | not recorded | the job is not finished (4 jobs), only some sessions supplied it (2 jobs) |
| tool_retries (quality) | not recorded | 0 of 6 | not recorded | not recorded | the job is not finished (4 jobs), the job owns only some workers of a session, and that session is not counted (2 jobs) |
| api_retries (quality) | not recorded | 0 of 6 | not recorded | not recorded | the job is not finished (4 jobs), the job owns only some workers of a session, and that session is not counted (2 jobs) |
| compactions (count) | not recorded | 0 of 6 | not recorded | not recorded | the job is not finished (4 jobs), the job owns only some workers of a session, and that session is not counted (2 jobs) |
| retouches (quality) | partial | 2 of 6 | 1 | 5 | the job is not finished (4 jobs) |
| muda_time | partial | 2 of 6 | 138982 ms | 1988945 ms | the job is not finished (4 jobs) |
| muda_time.defects (quality) | partial | 2 of 6 | 138982 ms | 329781 ms | the job is not finished (4 jobs) |
| muda_time.overproduction | partial | 2 of 6 | 0 ms | 0 ms | the job is not finished (4 jobs) |
| muda_time.waiting | partial | 2 of 6 | 0 ms | 1648026 ms | the job is not finished (4 jobs) |
| muda_time.non_utilized_talent | partial | 2 of 6 | 0 ms | 0 ms | the job is not finished (4 jobs) |
| muda_time.transportation | partial | 2 of 6 | 0 ms | 0 ms | the job is not finished (4 jobs) |
| muda_time.inventory | partial | 2 of 6 | 0 ms | 0 ms | the job is not finished (4 jobs) |
| muda_time.motion | partial | 2 of 6 | 0 ms | 0 ms | the job is not finished (4 jobs) |
| muda_time.extra_processing | partial | 2 of 6 | 0 ms | 11138 ms | the job is not finished (4 jobs) |
| search_waste | not recorded | 0 of 6 | not recorded | not recorded | published facts do not carry it (2 jobs), the job is not finished (4 jobs) |

### By plugin version: unknown

Jobs: 5; open, and so left out of every measure: 2.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 2 of 5 | 9184000 ms | 70259000 ms | the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| queue_before_start | partial | 3 of 5 | 3104205 ms | 70080205 ms | the job is not finished (2 jobs) |
| active_time | partial | 3 of 5 | 1903165 ms | 64514796 ms | the job is not finished (2 jobs) |
| flow_efficiency | partial | 2 of 5 | 0.00% | 20.72% | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job), the job is not finished (2 jobs) |
| human_wait | partial | 3 of 5 | 0 ms | 54672752 ms | the job is not finished (2 jobs) |
| permission_wait | partial | 2 of 5 | 0 ms | 0 ms | the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| api_retry_wait | partial | 2 of 5 | 0 ms | 0 ms | the host records only some of it, so this is a lower bound (1 job), the job is not finished (2 jobs) |
| tool_failures (quality) | not recorded | 0 of 5 | not recorded | not recorded | the job is not finished (2 jobs), only some sessions supplied it (3 jobs) |
| tool_retries (quality) | not recorded | 0 of 5 | not recorded | not recorded | the job is not finished (2 jobs), the job owns only some workers of a session, and that session is not counted (3 jobs) |
| api_retries (quality) | not recorded | 0 of 5 | not recorded | not recorded | the job is not finished (2 jobs), the job owns only some workers of a session, and that session is not counted (3 jobs) |
| compactions (count) | not recorded | 0 of 5 | not recorded | not recorded | the job is not finished (2 jobs), the job owns only some workers of a session, and that session is not counted (3 jobs) |
| retouches (quality) | partial | 3 of 5 | 0 | 1 | the job is not finished (2 jobs) |
| muda_time | not recorded | 0 of 5 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| muda_time.defects (quality) | not recorded | 0 of 5 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| muda_time.overproduction | not recorded | 0 of 5 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| muda_time.waiting | not recorded | 0 of 5 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| muda_time.non_utilized_talent | not recorded | 0 of 5 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| muda_time.transportation | not recorded | 0 of 5 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| muda_time.inventory | not recorded | 0 of 5 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| muda_time.motion | not recorded | 0 of 5 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| muda_time.extra_processing | not recorded | 0 of 5 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (2 jobs), only some sessions supplied it (1 job) |
| search_waste | not recorded | 0 of 5 | not recorded | not recorded | published facts do not carry it (3 jobs), the job is not finished (2 jobs) |

### By host: claude-code

Jobs: 34; open, and so left out of every measure: 14.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 11 of 34 | 332371000 ms | 404295000 ms | the job was cancelled (2 jobs), the job is not finished (14 jobs), only some sessions supplied it (7 jobs) |
| queue_before_start | partial | 20 of 34 | 0 ms | 0 ms | the job is not finished (14 jobs) |
| active_time | partial | 7 of 34 | 995826 ms | 27785738 ms | the job is not finished (14 jobs), only some sessions supplied it (13 jobs) |
| flow_efficiency | partial | 1 of 34 | 0.01% | 0.01% | the job was cancelled (2 jobs), the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (7 jobs), the job is not finished (14 jobs), only some sessions supplied it (10 jobs) |
| human_wait | partial | 20 of 34 | 0 ms | 45633 ms | the job is not finished (14 jobs) |
| permission_wait | not recorded | 0 of 34 | not recorded | not recorded | the host does not record it (20 jobs), the job is not finished (14 jobs) |
| api_retry_wait | not recorded | 0 of 34 | not recorded | not recorded | the host records only some of it, so this is a lower bound (20 jobs), the job is not finished (14 jobs) |
| tool_failures (quality) | not recorded | 0 of 34 | not recorded | not recorded | the job is not finished (14 jobs), only some sessions supplied it (20 jobs) |
| tool_retries (quality) | not recorded | 0 of 34 | not recorded | not recorded | the job is not finished (14 jobs), the job owns only some workers of a session, and that session is not counted (20 jobs) |
| api_retries (quality) | not recorded | 0 of 34 | not recorded | not recorded | the job is not finished (14 jobs), the job owns only some workers of a session, and that session is not counted (20 jobs) |
| compactions (count) | not recorded | 0 of 34 | not recorded | not recorded | the job is not finished (14 jobs), the job owns only some workers of a session, and that session is not counted (20 jobs) |
| retouches (quality) | partial | 20 of 34 | 0 | 0 | the job is not finished (14 jobs) |
| muda_time | partial | 15 of 34 | 1217447 ms | 3992945 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (14 jobs) |
| muda_time.defects (quality) | partial | 15 of 34 | 138982 ms | 1570409 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (14 jobs) |
| muda_time.overproduction | partial | 15 of 34 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (14 jobs) |
| muda_time.waiting | partial | 15 of 34 | 0 ms | 1648026 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (14 jobs) |
| muda_time.non_utilized_talent | partial | 15 of 34 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (14 jobs) |
| muda_time.transportation | partial | 15 of 34 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (14 jobs) |
| muda_time.inventory | partial | 15 of 34 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (14 jobs) |
| muda_time.motion | partial | 15 of 34 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (14 jobs) |
| muda_time.extra_processing | partial | 15 of 34 | 0 ms | 0 ms | the independent evaluator has not labeled it (5 jobs), the job is not finished (14 jobs) |
| search_waste | not recorded | 0 of 34 | not recorded | not recorded | published facts do not carry it (20 jobs), the job is not finished (14 jobs) |

### By host: copilot-cli

Jobs: 3; open, and so left out of every measure: 1.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 2 of 3 | 9184000 ms | 70259000 ms | the job is not finished (1 job) |
| queue_before_start | partial | 2 of 3 | 3104205 ms | 70080205 ms | the job is not finished (1 job) |
| active_time | partial | 2 of 3 | 492851 ms | 1903165 ms | the job is not finished (1 job) |
| flow_efficiency | partial | 2 of 3 | 0.00% | 20.72% | the job is not finished (1 job) |
| human_wait | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| permission_wait | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| api_retry_wait | partial | 2 of 3 | 0 ms | 0 ms | the job is not finished (1 job) |
| tool_failures (quality) | not recorded | 0 of 3 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (2 jobs) |
| tool_retries (quality) | not recorded | 0 of 3 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (2 jobs) |
| api_retries (quality) | not recorded | 0 of 3 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (2 jobs) |
| compactions (count) | not recorded | 0 of 3 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (2 jobs) |
| retouches (quality) | partial | 2 of 3 | 0 | 0 | the job is not finished (1 job) |
| muda_time | not recorded | 0 of 3 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (1 job) |
| muda_time.defects (quality) | not recorded | 0 of 3 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (1 job) |
| muda_time.overproduction | not recorded | 0 of 3 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (1 job) |
| muda_time.waiting | not recorded | 0 of 3 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (1 job) |
| muda_time.non_utilized_talent | not recorded | 0 of 3 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (1 job) |
| muda_time.transportation | not recorded | 0 of 3 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (1 job) |
| muda_time.inventory | not recorded | 0 of 3 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (1 job) |
| muda_time.motion | not recorded | 0 of 3 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (1 job) |
| muda_time.extra_processing | not recorded | 0 of 3 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (1 job) |
| search_waste | not recorded | 0 of 3 | not recorded | not recorded | published facts do not carry it (2 jobs), the job is not finished (1 job) |

### By host: mixed

Jobs: 2; open, and so left out of every measure: 1.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| queue_before_start | partial | 1 of 2 | 0 ms | 0 ms | the job is not finished (1 job) |
| active_time | partial | 1 of 2 | 64514796 ms | 64514796 ms | the job is not finished (1 job) |
| flow_efficiency | not recorded | 0 of 2 | not recorded | not recorded | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job), the job is not finished (1 job) |
| human_wait | partial | 1 of 2 | 54672752 ms | 54672752 ms | the job is not finished (1 job) |
| permission_wait | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| api_retry_wait | not recorded | 0 of 2 | not recorded | not recorded | the host records only some of it, so this is a lower bound (1 job), the job is not finished (1 job) |
| tool_failures (quality) | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| tool_retries (quality) | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (1 job) |
| api_retries (quality) | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (1 job) |
| compactions (count) | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (1 job) |
| retouches (quality) | partial | 1 of 2 | 1 | 1 | the job is not finished (1 job) |
| muda_time | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.defects (quality) | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.overproduction | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.waiting | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.non_utilized_talent | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.transportation | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.inventory | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.motion | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.extra_processing | not recorded | 0 of 2 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (1 job) |
| search_waste | not recorded | 0 of 2 | not recorded | not recorded | published facts do not carry it (1 job), the job is not finished (1 job) |

### By job class: other

Jobs: 39; open, and so left out of every measure: 16.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 13 of 39 | 320052000 ms | 359776000 ms | the job was cancelled (2 jobs), the job is not finished (16 jobs), only some sessions supplied it (8 jobs) |
| queue_before_start | partial | 23 of 39 | 0 ms | 0 ms | the job is not finished (16 jobs) |
| active_time | partial | 10 of 39 | 995826 ms | 27785738 ms | the job is not finished (16 jobs), only some sessions supplied it (13 jobs) |
| flow_efficiency | partial | 3 of 39 | 0.01% | 20.72% | the job was cancelled (2 jobs), the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (8 jobs), the job is not finished (16 jobs), only some sessions supplied it (10 jobs) |
| human_wait | partial | 23 of 39 | 0 ms | 797996 ms | the job is not finished (16 jobs) |
| permission_wait | partial | 2 of 39 | 0 ms | 0 ms | the host does not record it (20 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| api_retry_wait | partial | 2 of 39 | 0 ms | 0 ms | the host records only some of it, so this is a lower bound (21 jobs), the job is not finished (16 jobs) |
| tool_failures (quality) | not recorded | 0 of 39 | not recorded | not recorded | the job is not finished (16 jobs), only some sessions supplied it (23 jobs) |
| tool_retries (quality) | not recorded | 0 of 39 | not recorded | not recorded | the job is not finished (16 jobs), the job owns only some workers of a session, and that session is not counted (23 jobs) |
| api_retries (quality) | not recorded | 0 of 39 | not recorded | not recorded | the job is not finished (16 jobs), the job owns only some workers of a session, and that session is not counted (23 jobs) |
| compactions (count) | not recorded | 0 of 39 | not recorded | not recorded | the job is not finished (16 jobs), the job owns only some workers of a session, and that session is not counted (23 jobs) |
| retouches (quality) | partial | 23 of 39 | 0 | 0 | the job is not finished (16 jobs) |
| muda_time | partial | 15 of 39 | 1217447 ms | 3992945 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.defects (quality) | partial | 15 of 39 | 138982 ms | 1570409 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.overproduction | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.waiting | partial | 15 of 39 | 0 ms | 1648026 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.non_utilized_talent | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.transportation | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.inventory | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.motion | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| muda_time.extra_processing | partial | 15 of 39 | 0 ms | 0 ms | the independent evaluator has not labeled it (7 jobs), the job is not finished (16 jobs), only some sessions supplied it (1 job) |
| search_waste | not recorded | 0 of 39 | not recorded | not recorded | published facts do not carry it (23 jobs), the job is not finished (16 jobs) |

## Tool kinds

Calls and failures summed over 262 sessions with facts, each session counted once; most failures first.

| Tool kind | State | Calls | Failures | Sessions counted (n of N) | Why not whole |
| --- | --- | ---: | ---: | ---: | --- |
| shell | partial | 63642 | 2846 | 89 of 95 | the session log ended mid-record and the session was still open |
| other | partial | 1992 | 132 | 16 of 21 | the session log ended mid-record and the session was still open |
| read | partial | 5631 | 109 | 29 of 34 | the session log ended mid-record and the session was still open |
| mcp | partial | 1352 | 42 | 8 of 13 | the session log ended mid-record and the session was still open |
| desk | partial | 722 | 25 | 84 of 90 | the session log ended mid-record and the session was still open |
| edit | partial | 3049 | 20 | 18 of 22 | the session log ended mid-record and the session was still open |
| web | partial | 797 | 20 | 16 of 20 | the session log ended mid-record and the session was still open |
| agent | partial | 1945 | 16 | 17 of 21 | the session log ended mid-record and the session was still open |
| search | partial | 682 | 2 | 98 of 103 | the session log ended mid-record and the session was still open |
| skill | partial | 471 | 0 | 24 of 30 | the session log ended mid-record and the session was still open |

## Sign-off

- Jobs with a sign-off record: 54; with no work record: 16. Jobs with a work record and no sign-off record: 1.
- Accepted (recorded by the agent on the operator's word): 0.
- Delivered, waiting for sign-off: 11. Refused: 0. Reopened: 1.
- Delivered before sign-off was recorded: 15. Not delivered yet: 27.
- Refusal reasons: none.
- Waits that ended in an answer: none.
- Waits still open (at least this long): at least 1 hour 3, at least 1 day 8.

## First-pass yield

- First-pass yield: at most 5 of 6 delivered jobs passed first time (upper bound 83.33%; 5 waiting for sign-off).
- Sent back: 1. Only changed asks came back: 0.
- Left out of the count: 44 jobs (the task card does not record what was sent back), 4 jobs (the job has no standing delivery yet), 1 job (no outcome record is available).

## Rework

- Jobs with returns recorded: 17 of 55 (partial: the task card does not record what was sent back and no outcome record is available).
- Returns caught in the task: none. At review: none. After delivery: agent_error 1, changed_ask 4, new_information 1.
- Returns that were changed asks: 4.
- Reason check on refusals: not recorded (no refusal could be compared with the agent's reason).

## Human attention

- Human attention per accepted outcome: no accepted outcomes yet. The estimated attention so far, with nothing to divide it by, is at least 34.5 hours over at least 887 human turns (the host's record did not include it and a host records the human's turns only in part, so this is a lower bound and some sessions did not record all of the human's turns, so this is a lower bound).
- Human turns per accepted outcome: no accepted outcomes yet.
- Where the estimate went: 29.3 hours on jobs, 5.1 hours on sessions that were not on any job, 0 ms on sessions that could not be placed on a job. All of it is in the headline, including time on refused, unsigned and undelivered work.
- Sessions in the period: 252, of which 37 record the human's turns completely. Sessions from before turns were recorded are not in the period. A host that does not record the human's turns (such as Codex) or records them only in part (such as Copilot, or Claude Code when only some prompts carry an origin) makes the figure a lower bound.
- Permission decisions, reported beside the headline and not in it: 0, estimated at 0 ms (partial: the host does not record it).
- Method: version 1. An estimate of the time the human spent reading the reply and writing the prompt, never longer than the gap before the prompt, and at least 1 second per turn. Reading a reply by size: none 0 ms, xs 1 second, s 5 seconds, m 30 seconds, l 2.5 minutes, xl 6.7 minutes. Writing a prompt by size: none 2 seconds, xs 3 seconds, s 25 seconds, m 2.5 minutes, l 3 minutes, xl 3 minutes. A permission decision counts at most 5 seconds.

## Coverage

- Jobs: 39; open: 16.
- Unattributed sessions: 222 of 262 (447474978 ms of 4237141293 ms session time).
- Jobs fully labeled: 15; partially labeled: 1; unlabeled: 7.
- Labels files: 26; used: 23; unused: the facts do not record which part of the session was the job's (3 files); stop labels dropped: none.
- Job class: every job is other; published facts do not carry the task card's kind.
- Search waste: unavailable; published facts do not carry the organization signal.
