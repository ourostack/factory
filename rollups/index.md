# Factory rollups

Totals and distributions across jobs, grouped by plugin version, host, job class and waste type; tool kinds are summed per session. They name no person, machine, date or time of day.

Only finished jobs count: every measure of a job that is not done or cancelled, or whose lead time is censored, is excluded because the job is not finished. Only complete values count: a measure a finished job could not supply, or could supply only for some sessions, is excluded and listed with its reason, never counted as zero. Jobs counted reads n of N: the jobs whose value counted, of all jobs in the group, open ones included. Compactions (count) is how many compactions happened, which every host records; compaction wait time is a different number and is recorded only where the host records it. Every group has a state: measured when n equals N, partial when some jobs counted, and not recorded when none did, in which case there is no median. A value the host records only partly is a lower bound, so it is left out of n and listed under its reason. Medians and p75 use the nearest-rank method: the value at rank ceil(p × n) of the counted values sorted ascending.

## Waste by type

Muda time from the independent evaluator's labels, largest first; ties are broken by waste name. A job counts only when it is finished and every one of its sessions is labeled. Each job counts only its own part of a session, and where several jobs hold the same time, a total counts it once. The unknown row, once any label could say it, is time the evaluator looked at and could not tell: it is not counted in muda time, but each row's share is of all labeled waste time, unknown included. Confidence is the time in the row by how sure the evaluator was; it reads not recorded when a label that speaks to the row is from an evaluator that recorded none. Evaluator versions are the versions of those labels.

### All jobs

Muda time: 276930064 ms (partial) across 15 of 67 jobs fully labeled; excluded: the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs). Sessions summed: 17, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 270847568 ms | 94.97% | 94.97% | 8 | 223466749 / 47380819 / 0 ms | 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.25 |
| unknown | 8277137 ms | 2.90% | 97.87% | 4 | 0 / 1787475 / 6489662 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| defects | 6062441 ms | 2.13% | 99.99% | 12 | 977697 / 5084744 / 0 ms | 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.42 |
| extra_processing | 12523 ms | 0.00% | 100.00% | 2 | 0 / 11138 / 1385 ms | 3.2.0-alpha.258, 3.2.0-alpha.264 |
| motion | 7532 ms | 0.00% | 100.00% | 1 | 0 / 7532 / 0 ms | 3.2.0-alpha.315 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.25, 3.2.42 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.25, 3.2.42 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.25, 3.2.42 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.25, 3.2.42 |

### By job class: other

Muda time: 276930064 ms (partial) across 15 of 67 jobs fully labeled; excluded: the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs). Sessions summed: 17, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 270847568 ms | 94.97% | 94.97% | 8 | 223466749 / 47380819 / 0 ms | 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.25 |
| unknown | 8277137 ms | 2.90% | 97.87% | 4 | 0 / 1787475 / 6489662 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| defects | 6062441 ms | 2.13% | 99.99% | 12 | 977697 / 5084744 / 0 ms | 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.42 |
| extra_processing | 12523 ms | 0.00% | 100.00% | 2 | 0 / 11138 / 1385 ms | 3.2.0-alpha.258, 3.2.0-alpha.264 |
| motion | 7532 ms | 0.00% | 100.00% | 1 | 0 / 7532 / 0 ms | 3.2.0-alpha.315 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.25, 3.2.42 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.25, 3.2.42 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.25, 3.2.42 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.202, 3.2.0-alpha.253, 3.2.0-alpha.258, 3.2.0-alpha.264, 3.2.0-alpha.292, 3.2.0-alpha.315, 3.2.0-alpha.330, 3.2.25, 3.2.42 |

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

Muda time: 52465043 ms (partial) across 3 of 15 jobs fully labeled; excluded: the independent evaluator has not labeled it (9 jobs), the job is not finished (3 jobs). Sessions summed: 2, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 51994267 ms | 98.05% | 98.05% | 2 | 48049036 / 3945231 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| unknown | 565750 ms | 1.07% | 99.11% | 1 | 0 / 0 / 565750 ms | 3.2.0-alpha.315 |
| defects | 463244 ms | 0.87% | 99.99% | 2 | 411100 / 52144 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| motion | 7532 ms | 0.01% | 100.00% | 1 | 0 / 7532 / 0 ms | 3.2.0-alpha.315 |
| extra_processing | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |

### By plugin version: 3.2.0-alpha.292

Muda time: 183443 ms (measured) across 1 of 1 jobs fully labeled; excluded: none. Sessions summed: 1, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 100129 ms | 54.58% | 54.58% | 1 | 100129 / 0 / 0 ms | 3.2.0-alpha.292 |
| defects | 83314 ms | 45.42% | 100.00% | 1 | 83314 / 0 / 0 ms | 3.2.0-alpha.292 |
| extra_processing | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.292 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.292 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.292 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.292 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.292 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.292 |
| unknown | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.292 |

### By plugin version: 3.2.0-alpha.311

No fully labeled finished job yet (not recorded): 0 of 4 jobs fully labeled; excluded: the independent evaluator has not labeled it (1 job), the job is not finished (3 jobs).

### By plugin version: 3.2.0-alpha.326

Muda time: 39416100 ms (measured) across 1 of 1 jobs fully labeled; excluded: none. Sessions summed: 1, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 39123750 ms | 99.26% | 99.26% | 1 | 39123750 / 0 / 0 ms | 3.2.0-alpha.330 |
| defects | 292350 ms | 0.74% | 100.00% | 1 | 215812 / 76538 / 0 ms | 3.2.0-alpha.330 |
| extra_processing | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.330 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.330 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.330 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.330 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.330 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.330 |
| unknown | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.330 |

### By plugin version: 3.2.0-alpha.334

No fully labeled finished job yet (not recorded): 0 of 1 jobs fully labeled; excluded: the job is not finished (1 job).

### By plugin version: 3.2.31

Muda time: 699437 ms (partial) across 2 of 7 jobs fully labeled; excluded: the independent evaluator has not labeled it (3 jobs), the job is not finished (2 jobs). Sessions summed: 1, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| waiting | 552216 ms | 78.95% | 78.95% | 1 | 552216 / 0 / 0 ms | 3.2.25 |
| defects | 147221 ms | 21.05% | 100.00% | 1 | 11373 / 135848 / 0 ms | 3.2.42 |
| extra_processing | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.25, 3.2.42 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.25, 3.2.42 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.25, 3.2.42 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.25, 3.2.42 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.25, 3.2.42 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.25, 3.2.42 |
| unknown | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.25, 3.2.42 |

### By plugin version: mixed

Muda time: 2127927 ms (partial) across 2 of 4 jobs fully labeled; excluded: the job is not finished (1 job), only some sessions supplied it (1 job). Sessions summed: 8, each session's time once; shared by several jobs: 0.

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

Muda time: 181910 ms (partial) across 3 of 28 jobs fully labeled; excluded: the independent evaluator has not labeled it (10 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job). Sessions summed: 2, each session's time once; shared by several jobs: 0.

| Waste | Time | Share | Cumulative | Jobs | Confidence (high / medium / low) | Evaluator versions |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| unknown | 5923912 ms | 97.02% | 97.02% | 2 | 0 / 0 / 5923912 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| defects | 143330 ms | 2.35% | 99.37% | 3 | 5372 / 137958 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| waiting | 38580 ms | 0.63% | 100.00% | 1 | 38580 / 0 / 0 ms | 3.2.0-alpha.264 |
| extra_processing | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| inventory | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| motion | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| non_utilized_talent | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| overproduction | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |
| transportation | 0 ms | 0.00% | 100.00% | 0 | 0 / 0 / 0 ms | 3.2.0-alpha.264, 3.2.0-alpha.315 |

## Measures

Quality measures, which andon watches first, are marked (quality).

### All jobs

Jobs: 67; open, and so left out of every measure: 27.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 20 of 67 | 190602491 ms | 404295000 ms | the job was cancelled (3 jobs), the job is not finished (27 jobs), only some sessions supplied it (17 jobs) |
| queue_before_start | partial | 40 of 67 | 0 ms | 0 ms | the job is not finished (27 jobs) |
| active_time | partial | 20 of 67 | 1654987 ms | 16622011 ms | the job is not finished (27 jobs), only some sessions supplied it (20 jobs) |
| flow_efficiency | partial | 8 of 67 | 0.02% | 20.72% | the job was cancelled (3 jobs), the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (17 jobs), the job is not finished (27 jobs), only some sessions supplied it (12 jobs) |
| human_wait | partial | 40 of 67 | 0 ms | 2972093 ms | the job is not finished (27 jobs) |
| permission_wait | partial | 7 of 67 | 0 ms | 0 ms | the host does not record it (30 jobs), the job is not finished (27 jobs), only some sessions supplied it (3 jobs) |
| api_retry_wait | partial | 7 of 67 | 0 ms | 0 ms | the host records only some of it, so this is a lower bound (33 jobs), the job is not finished (27 jobs) |
| tool_failures (quality) | not recorded | 0 of 67 | not recorded | not recorded | the job is not finished (27 jobs), only some sessions supplied it (40 jobs) |
| tool_retries (quality) | not recorded | 0 of 67 | not recorded | not recorded | the job is not finished (27 jobs), the job owns only some workers of a session, and that session is not counted (40 jobs) |
| api_retries (quality) | not recorded | 0 of 67 | not recorded | not recorded | the job is not finished (27 jobs), the job owns only some workers of a session, and that session is not counted (40 jobs) |
| compactions (count) | not recorded | 0 of 67 | not recorded | not recorded | several different causes (3 jobs), the job is not finished (27 jobs), the job owns only some workers of a session, and that session is not counted (37 jobs) |
| retouches (quality) | partial | 40 of 67 | 0 | 0 | the job is not finished (27 jobs) |
| muda_time | partial | 15 of 67 | 147221 ms | 1988945 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.defects (quality) | partial | 15 of 67 | 83314 ms | 292350 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.overproduction | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.waiting | partial | 15 of 67 | 38580 ms | 1648026 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.non_utilized_talent | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.transportation | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.inventory | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.motion | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.extra_processing | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| search_waste | not recorded | 0 of 67 | not recorded | not recorded | published facts do not carry it (40 jobs), the job is not finished (27 jobs) |

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

Jobs: 15; open, and so left out of every measure: 3.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 9 of 15 | 332371000 ms | 404295000 ms | the job was cancelled (2 jobs), the job is not finished (3 jobs), only some sessions supplied it (1 job) |
| queue_before_start | partial | 12 of 15 | 0 ms | 0 ms | the job is not finished (3 jobs) |
| active_time | partial | 1 of 15 | 27785738 ms | 27785738 ms | the job is not finished (3 jobs), only some sessions supplied it (11 jobs) |
| flow_efficiency | not recorded | 0 of 15 | not recorded | not recorded | the job was cancelled (2 jobs), the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job), the job is not finished (3 jobs), only some sessions supplied it (9 jobs) |
| human_wait | partial | 12 of 15 | 0 ms | 0 ms | the job is not finished (3 jobs) |
| permission_wait | not recorded | 0 of 15 | not recorded | not recorded | the host does not record it (12 jobs), the job is not finished (3 jobs) |
| api_retry_wait | not recorded | 0 of 15 | not recorded | not recorded | the host records only some of it, so this is a lower bound (12 jobs), the job is not finished (3 jobs) |
| tool_failures (quality) | not recorded | 0 of 15 | not recorded | not recorded | the job is not finished (3 jobs), only some sessions supplied it (12 jobs) |
| tool_retries (quality) | not recorded | 0 of 15 | not recorded | not recorded | the job is not finished (3 jobs), the job owns only some workers of a session, and that session is not counted (12 jobs) |
| api_retries (quality) | not recorded | 0 of 15 | not recorded | not recorded | the job is not finished (3 jobs), the job owns only some workers of a session, and that session is not counted (12 jobs) |
| compactions (count) | not recorded | 0 of 15 | not recorded | not recorded | the job is not finished (3 jobs), the job owns only some workers of a session, and that session is not counted (12 jobs) |
| retouches (quality) | partial | 12 of 15 | 0 | 0 | the job is not finished (3 jobs) |
| muda_time | partial | 3 of 15 | 797996 ms | 51656519 ms | the independent evaluator has not labeled it (9 jobs), the job is not finished (3 jobs) |
| muda_time.defects (quality) | partial | 3 of 15 | 2996 ms | 460248 ms | the independent evaluator has not labeled it (9 jobs), the job is not finished (3 jobs) |
| muda_time.overproduction | partial | 3 of 15 | 0 ms | 0 ms | the independent evaluator has not labeled it (9 jobs), the job is not finished (3 jobs) |
| muda_time.waiting | partial | 3 of 15 | 797996 ms | 51196271 ms | the independent evaluator has not labeled it (9 jobs), the job is not finished (3 jobs) |
| muda_time.non_utilized_talent | partial | 3 of 15 | 0 ms | 0 ms | the independent evaluator has not labeled it (9 jobs), the job is not finished (3 jobs) |
| muda_time.transportation | partial | 3 of 15 | 0 ms | 0 ms | the independent evaluator has not labeled it (9 jobs), the job is not finished (3 jobs) |
| muda_time.inventory | partial | 3 of 15 | 0 ms | 0 ms | the independent evaluator has not labeled it (9 jobs), the job is not finished (3 jobs) |
| muda_time.motion | partial | 3 of 15 | 0 ms | 7532 ms | the independent evaluator has not labeled it (9 jobs), the job is not finished (3 jobs) |
| muda_time.extra_processing | partial | 3 of 15 | 0 ms | 0 ms | the independent evaluator has not labeled it (9 jobs), the job is not finished (3 jobs) |
| search_waste | not recorded | 0 of 15 | not recorded | not recorded | published facts do not carry it (12 jobs), the job is not finished (3 jobs) |

### By plugin version: 3.2.0-alpha.292

Jobs: 1; open, and so left out of every measure: 0.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | not recorded | 0 of 1 | not recorded | not recorded | the job was cancelled (1 job) |
| queue_before_start | measured | 1 of 1 | 0 ms | 0 ms | none |
| active_time | measured | 1 of 1 | 287973 ms | 287973 ms | none |
| flow_efficiency | not recorded | 0 of 1 | not recorded | not recorded | the job was cancelled (1 job) |
| human_wait | measured | 1 of 1 | 100129 ms | 100129 ms | none |
| permission_wait | not recorded | 0 of 1 | not recorded | not recorded | the host does not record it (1 job) |
| api_retry_wait | not recorded | 0 of 1 | not recorded | not recorded | the host records only some of it, so this is a lower bound (1 job) |
| tool_failures (quality) | not recorded | 0 of 1 | not recorded | not recorded | only some sessions supplied it (1 job) |
| tool_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| api_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| compactions (count) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| retouches (quality) | measured | 1 of 1 | 0 | 0 | none |
| muda_time | measured | 1 of 1 | 183443 ms | 183443 ms | none |
| muda_time.defects (quality) | measured | 1 of 1 | 83314 ms | 83314 ms | none |
| muda_time.overproduction | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.waiting | measured | 1 of 1 | 100129 ms | 100129 ms | none |
| muda_time.non_utilized_talent | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.transportation | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.inventory | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.motion | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.extra_processing | measured | 1 of 1 | 0 ms | 0 ms | none |
| search_waste | not recorded | 0 of 1 | not recorded | not recorded | published facts do not carry it (1 job) |

### By plugin version: 3.2.0-alpha.311

Jobs: 4; open, and so left out of every measure: 3.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 1 of 4 | 10396968 ms | 10396968 ms | the job is not finished (3 jobs) |
| queue_before_start | partial | 1 of 4 | 0 ms | 0 ms | the job is not finished (3 jobs) |
| active_time | not recorded | 0 of 4 | not recorded | not recorded | the job is not finished (3 jobs), only some sessions supplied it (1 job) |
| flow_efficiency | not recorded | 0 of 4 | not recorded | not recorded | the job is not finished (3 jobs), only some sessions supplied it (1 job) |
| human_wait | partial | 1 of 4 | 0 ms | 0 ms | the job is not finished (3 jobs) |
| permission_wait | not recorded | 0 of 4 | not recorded | not recorded | the host does not record it (1 job), the job is not finished (3 jobs) |
| api_retry_wait | not recorded | 0 of 4 | not recorded | not recorded | the host records only some of it, so this is a lower bound (1 job), the job is not finished (3 jobs) |
| tool_failures (quality) | not recorded | 0 of 4 | not recorded | not recorded | the job is not finished (3 jobs), only some sessions supplied it (1 job) |
| tool_retries (quality) | not recorded | 0 of 4 | not recorded | not recorded | the job is not finished (3 jobs), the job owns only some workers of a session, and that session is not counted (1 job) |
| api_retries (quality) | not recorded | 0 of 4 | not recorded | not recorded | the job is not finished (3 jobs), the job owns only some workers of a session, and that session is not counted (1 job) |
| compactions (count) | not recorded | 0 of 4 | not recorded | not recorded | the job is not finished (3 jobs), the job owns only some workers of a session, and that session is not counted (1 job) |
| retouches (quality) | partial | 1 of 4 | 0 | 0 | the job is not finished (3 jobs) |
| muda_time | not recorded | 0 of 4 | not recorded | not recorded | the independent evaluator has not labeled it (1 job), the job is not finished (3 jobs) |
| muda_time.defects (quality) | not recorded | 0 of 4 | not recorded | not recorded | the independent evaluator has not labeled it (1 job), the job is not finished (3 jobs) |
| muda_time.overproduction | not recorded | 0 of 4 | not recorded | not recorded | the independent evaluator has not labeled it (1 job), the job is not finished (3 jobs) |
| muda_time.waiting | not recorded | 0 of 4 | not recorded | not recorded | the independent evaluator has not labeled it (1 job), the job is not finished (3 jobs) |
| muda_time.non_utilized_talent | not recorded | 0 of 4 | not recorded | not recorded | the independent evaluator has not labeled it (1 job), the job is not finished (3 jobs) |
| muda_time.transportation | not recorded | 0 of 4 | not recorded | not recorded | the independent evaluator has not labeled it (1 job), the job is not finished (3 jobs) |
| muda_time.inventory | not recorded | 0 of 4 | not recorded | not recorded | the independent evaluator has not labeled it (1 job), the job is not finished (3 jobs) |
| muda_time.motion | not recorded | 0 of 4 | not recorded | not recorded | the independent evaluator has not labeled it (1 job), the job is not finished (3 jobs) |
| muda_time.extra_processing | not recorded | 0 of 4 | not recorded | not recorded | the independent evaluator has not labeled it (1 job), the job is not finished (3 jobs) |
| search_waste | not recorded | 0 of 4 | not recorded | not recorded | published facts do not carry it (1 job), the job is not finished (3 jobs) |

### By plugin version: 3.2.0-alpha.326

Jobs: 1; open, and so left out of every measure: 0.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | not recorded | 0 of 1 | not recorded | not recorded | only some sessions supplied it (1 job) |
| queue_before_start | measured | 1 of 1 | 0 ms | 0 ms | none |
| active_time | measured | 1 of 1 | 1654987 ms | 1654987 ms | none |
| flow_efficiency | not recorded | 0 of 1 | not recorded | not recorded | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (1 job) |
| human_wait | measured | 1 of 1 | 39123750 ms | 39123750 ms | none |
| permission_wait | not recorded | 0 of 1 | not recorded | not recorded | the host does not record it (1 job) |
| api_retry_wait | not recorded | 0 of 1 | not recorded | not recorded | the host records only some of it, so this is a lower bound (1 job) |
| tool_failures (quality) | not recorded | 0 of 1 | not recorded | not recorded | only some sessions supplied it (1 job) |
| tool_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| api_retries (quality) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| compactions (count) | not recorded | 0 of 1 | not recorded | not recorded | the job owns only some workers of a session, and that session is not counted (1 job) |
| retouches (quality) | measured | 1 of 1 | 0 | 0 | none |
| muda_time | measured | 1 of 1 | 39416100 ms | 39416100 ms | none |
| muda_time.defects (quality) | measured | 1 of 1 | 292350 ms | 292350 ms | none |
| muda_time.overproduction | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.waiting | measured | 1 of 1 | 39123750 ms | 39123750 ms | none |
| muda_time.non_utilized_talent | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.transportation | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.inventory | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.motion | measured | 1 of 1 | 0 ms | 0 ms | none |
| muda_time.extra_processing | measured | 1 of 1 | 0 ms | 0 ms | none |
| search_waste | not recorded | 0 of 1 | not recorded | not recorded | published facts do not carry it (1 job) |

### By plugin version: 3.2.0-alpha.334

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

### By plugin version: 3.2.31

Jobs: 7; open, and so left out of every measure: 2.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 3 of 7 | 53243865 ms | 63157320 ms | the job is not finished (2 jobs), only some sessions supplied it (2 jobs) |
| queue_before_start | partial | 5 of 7 | 0 ms | 0 ms | the job is not finished (2 jobs) |
| active_time | partial | 5 of 7 | 16622011 ms | 37729031 ms | the job is not finished (2 jobs) |
| flow_efficiency | partial | 3 of 7 | 27.29% | 35.32% | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (2 jobs), the job is not finished (2 jobs) |
| human_wait | partial | 5 of 7 | 0 ms | 0 ms | the job is not finished (2 jobs) |
| permission_wait | not recorded | 0 of 7 | not recorded | not recorded | the host does not record it (5 jobs), the job is not finished (2 jobs) |
| api_retry_wait | not recorded | 0 of 7 | not recorded | not recorded | the host records only some of it, so this is a lower bound (5 jobs), the job is not finished (2 jobs) |
| tool_failures (quality) | not recorded | 0 of 7 | not recorded | not recorded | the job is not finished (2 jobs), only some sessions supplied it (5 jobs) |
| tool_retries (quality) | not recorded | 0 of 7 | not recorded | not recorded | the job is not finished (2 jobs), the job owns only some workers of a session, and that session is not counted (5 jobs) |
| api_retries (quality) | not recorded | 0 of 7 | not recorded | not recorded | the job is not finished (2 jobs), the job owns only some workers of a session, and that session is not counted (5 jobs) |
| compactions (count) | not recorded | 0 of 7 | not recorded | not recorded | the job is not finished (2 jobs), the job owns only some workers of a session, and that session is not counted (5 jobs) |
| retouches (quality) | partial | 5 of 7 | 0 | 0 | the job is not finished (2 jobs) |
| muda_time | partial | 2 of 7 | 147221 ms | 552216 ms | the independent evaluator has not labeled it (3 jobs), the job is not finished (2 jobs) |
| muda_time.defects (quality) | partial | 2 of 7 | 0 ms | 147221 ms | the independent evaluator has not labeled it (3 jobs), the job is not finished (2 jobs) |
| muda_time.overproduction | partial | 2 of 7 | 0 ms | 0 ms | the independent evaluator has not labeled it (3 jobs), the job is not finished (2 jobs) |
| muda_time.waiting | partial | 2 of 7 | 0 ms | 552216 ms | the independent evaluator has not labeled it (3 jobs), the job is not finished (2 jobs) |
| muda_time.non_utilized_talent | partial | 2 of 7 | 0 ms | 0 ms | the independent evaluator has not labeled it (3 jobs), the job is not finished (2 jobs) |
| muda_time.transportation | partial | 2 of 7 | 0 ms | 0 ms | the independent evaluator has not labeled it (3 jobs), the job is not finished (2 jobs) |
| muda_time.inventory | partial | 2 of 7 | 0 ms | 0 ms | the independent evaluator has not labeled it (3 jobs), the job is not finished (2 jobs) |
| muda_time.motion | partial | 2 of 7 | 0 ms | 0 ms | the independent evaluator has not labeled it (3 jobs), the job is not finished (2 jobs) |
| muda_time.extra_processing | partial | 2 of 7 | 0 ms | 0 ms | the independent evaluator has not labeled it (3 jobs), the job is not finished (2 jobs) |
| search_waste | not recorded | 0 of 7 | not recorded | not recorded | published facts do not carry it (5 jobs), the job is not finished (2 jobs) |

### By plugin version: mixed

Jobs: 4; open, and so left out of every measure: 1.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 1 of 4 | 601084000 ms | 601084000 ms | the job is not finished (1 job), only some sessions supplied it (2 jobs) |
| queue_before_start | partial | 3 of 4 | 0 ms | 0 ms | the job is not finished (1 job) |
| active_time | partial | 1 of 4 | 995826 ms | 995826 ms | the job is not finished (1 job), only some sessions supplied it (2 jobs) |
| flow_efficiency | not recorded | 0 of 4 | not recorded | not recorded | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (2 jobs), the job is not finished (1 job), only some sessions supplied it (1 job) |
| human_wait | partial | 3 of 4 | 1980715 ms | 174721713 ms | the job is not finished (1 job) |
| permission_wait | not recorded | 0 of 4 | not recorded | not recorded | the host does not record it (3 jobs), the job is not finished (1 job) |
| api_retry_wait | not recorded | 0 of 4 | not recorded | not recorded | the host records only some of it, so this is a lower bound (3 jobs), the job is not finished (1 job) |
| tool_failures (quality) | not recorded | 0 of 4 | not recorded | not recorded | the job is not finished (1 job), only some sessions supplied it (3 jobs) |
| tool_retries (quality) | not recorded | 0 of 4 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (3 jobs) |
| api_retries (quality) | not recorded | 0 of 4 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (3 jobs) |
| compactions (count) | not recorded | 0 of 4 | not recorded | not recorded | the job is not finished (1 job), the job owns only some workers of a session, and that session is not counted (3 jobs) |
| retouches (quality) | partial | 3 of 4 | 1 | 5 | the job is not finished (1 job) |
| muda_time | partial | 2 of 4 | 138982 ms | 1988945 ms | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.defects (quality) | partial | 2 of 4 | 138982 ms | 329781 ms | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.overproduction | partial | 2 of 4 | 0 ms | 0 ms | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.waiting | partial | 2 of 4 | 0 ms | 1648026 ms | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.non_utilized_talent | partial | 2 of 4 | 0 ms | 0 ms | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.transportation | partial | 2 of 4 | 0 ms | 0 ms | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.inventory | partial | 2 of 4 | 0 ms | 0 ms | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.motion | partial | 2 of 4 | 0 ms | 0 ms | the job is not finished (1 job), only some sessions supplied it (1 job) |
| muda_time.extra_processing | partial | 2 of 4 | 0 ms | 11138 ms | the job is not finished (1 job), only some sessions supplied it (1 job) |
| search_waste | not recorded | 0 of 4 | not recorded | not recorded | published facts do not carry it (3 jobs), the job is not finished (1 job) |

### By plugin version: unknown

Jobs: 28; open, and so left out of every measure: 14.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 5 of 28 | 70259000 ms | 1235091141 ms | the job is not finished (14 jobs), only some sessions supplied it (9 jobs) |
| queue_before_start | partial | 14 of 28 | 0 ms | 3104205 ms | the job is not finished (14 jobs) |
| active_time | partial | 8 of 28 | 492851 ms | 10497945 ms | the job is not finished (14 jobs), only some sessions supplied it (6 jobs) |
| flow_efficiency | partial | 4 of 28 | 0.00% | 0.02% | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (9 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| human_wait | partial | 14 of 28 | 2179476 ms | 15088186 ms | the job is not finished (14 jobs) |
| permission_wait | partial | 7 of 28 | 0 ms | 0 ms | the host does not record it (4 jobs), the job is not finished (14 jobs), only some sessions supplied it (3 jobs) |
| api_retry_wait | partial | 7 of 28 | 0 ms | 0 ms | the host records only some of it, so this is a lower bound (7 jobs), the job is not finished (14 jobs) |
| tool_failures (quality) | not recorded | 0 of 28 | not recorded | not recorded | the job is not finished (14 jobs), only some sessions supplied it (14 jobs) |
| tool_retries (quality) | not recorded | 0 of 28 | not recorded | not recorded | the job is not finished (14 jobs), the job owns only some workers of a session, and that session is not counted (14 jobs) |
| api_retries (quality) | not recorded | 0 of 28 | not recorded | not recorded | the job is not finished (14 jobs), the job owns only some workers of a session, and that session is not counted (14 jobs) |
| compactions (count) | not recorded | 0 of 28 | not recorded | not recorded | several different causes (3 jobs), the job is not finished (14 jobs), the job owns only some workers of a session, and that session is not counted (11 jobs) |
| retouches (quality) | partial | 14 of 28 | 0 | 0 | the job is not finished (14 jobs) |
| muda_time | partial | 3 of 28 | 54458 ms | 125866 ms | the independent evaluator has not labeled it (10 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.defects (quality) | partial | 3 of 28 | 15878 ms | 125866 ms | the independent evaluator has not labeled it (10 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.overproduction | partial | 3 of 28 | 0 ms | 0 ms | the independent evaluator has not labeled it (10 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.waiting | partial | 3 of 28 | 0 ms | 38580 ms | the independent evaluator has not labeled it (10 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.non_utilized_talent | partial | 3 of 28 | 0 ms | 0 ms | the independent evaluator has not labeled it (10 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.transportation | partial | 3 of 28 | 0 ms | 0 ms | the independent evaluator has not labeled it (10 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.inventory | partial | 3 of 28 | 0 ms | 0 ms | the independent evaluator has not labeled it (10 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.motion | partial | 3 of 28 | 0 ms | 0 ms | the independent evaluator has not labeled it (10 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.extra_processing | partial | 3 of 28 | 0 ms | 0 ms | the independent evaluator has not labeled it (10 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| search_waste | not recorded | 0 of 28 | not recorded | not recorded | published facts do not carry it (14 jobs), the job is not finished (14 jobs) |

### By host: claude-code

Jobs: 44; open, and so left out of every measure: 14.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 16 of 44 | 190602491 ms | 359776000 ms | the job was cancelled (3 jobs), the job is not finished (14 jobs), only some sessions supplied it (11 jobs) |
| queue_before_start | partial | 30 of 44 | 0 ms | 0 ms | the job is not finished (14 jobs) |
| active_time | partial | 14 of 44 | 1654987 ms | 27785738 ms | the job is not finished (14 jobs), only some sessions supplied it (16 jobs) |
| flow_efficiency | partial | 4 of 44 | 1.53% | 27.29% | the job was cancelled (3 jobs), the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (11 jobs), the job is not finished (14 jobs), only some sessions supplied it (12 jobs) |
| human_wait | partial | 30 of 44 | 0 ms | 797996 ms | the job is not finished (14 jobs) |
| permission_wait | not recorded | 0 of 44 | not recorded | not recorded | the host does not record it (30 jobs), the job is not finished (14 jobs) |
| api_retry_wait | not recorded | 0 of 44 | not recorded | not recorded | the host records only some of it, so this is a lower bound (30 jobs), the job is not finished (14 jobs) |
| tool_failures (quality) | not recorded | 0 of 44 | not recorded | not recorded | the job is not finished (14 jobs), only some sessions supplied it (30 jobs) |
| tool_retries (quality) | not recorded | 0 of 44 | not recorded | not recorded | the job is not finished (14 jobs), the job owns only some workers of a session, and that session is not counted (30 jobs) |
| api_retries (quality) | not recorded | 0 of 44 | not recorded | not recorded | the job is not finished (14 jobs), the job owns only some workers of a session, and that session is not counted (30 jobs) |
| compactions (count) | not recorded | 0 of 44 | not recorded | not recorded | the job is not finished (14 jobs), the job owns only some workers of a session, and that session is not counted (30 jobs) |
| retouches (quality) | partial | 30 of 44 | 0 | 0 | the job is not finished (14 jobs) |
| muda_time | partial | 15 of 44 | 147221 ms | 1988945 ms | the independent evaluator has not labeled it (14 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.defects (quality) | partial | 15 of 44 | 83314 ms | 292350 ms | the independent evaluator has not labeled it (14 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.overproduction | partial | 15 of 44 | 0 ms | 0 ms | the independent evaluator has not labeled it (14 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.waiting | partial | 15 of 44 | 38580 ms | 1648026 ms | the independent evaluator has not labeled it (14 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.non_utilized_talent | partial | 15 of 44 | 0 ms | 0 ms | the independent evaluator has not labeled it (14 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.transportation | partial | 15 of 44 | 0 ms | 0 ms | the independent evaluator has not labeled it (14 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.inventory | partial | 15 of 44 | 0 ms | 0 ms | the independent evaluator has not labeled it (14 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.motion | partial | 15 of 44 | 0 ms | 0 ms | the independent evaluator has not labeled it (14 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| muda_time.extra_processing | partial | 15 of 44 | 0 ms | 0 ms | the independent evaluator has not labeled it (14 jobs), the job is not finished (14 jobs), only some sessions supplied it (1 job) |
| search_waste | not recorded | 0 of 44 | not recorded | not recorded | published facts do not carry it (30 jobs), the job is not finished (14 jobs) |

### By host: copilot-cli

Jobs: 13; open, and so left out of every measure: 6.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 4 of 13 | 70259000 ms | 1235091141 ms | the job is not finished (6 jobs), only some sessions supplied it (3 jobs) |
| queue_before_start | partial | 7 of 13 | 3104205 ms | 1041249105 ms | the job is not finished (6 jobs) |
| active_time | partial | 5 of 13 | 492851 ms | 1903165 ms | the job is not finished (6 jobs), only some sessions supplied it (2 jobs) |
| flow_efficiency | partial | 4 of 13 | 0.00% | 0.02% | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (3 jobs), the job is not finished (6 jobs) |
| human_wait | partial | 7 of 13 | 2179476 ms | 2972093 ms | the job is not finished (6 jobs) |
| permission_wait | partial | 7 of 13 | 0 ms | 0 ms | the job is not finished (6 jobs) |
| api_retry_wait | partial | 7 of 13 | 0 ms | 0 ms | the job is not finished (6 jobs) |
| tool_failures (quality) | not recorded | 0 of 13 | not recorded | not recorded | the job is not finished (6 jobs), only some sessions supplied it (7 jobs) |
| tool_retries (quality) | not recorded | 0 of 13 | not recorded | not recorded | the job is not finished (6 jobs), the job owns only some workers of a session, and that session is not counted (7 jobs) |
| api_retries (quality) | not recorded | 0 of 13 | not recorded | not recorded | the job is not finished (6 jobs), the job owns only some workers of a session, and that session is not counted (7 jobs) |
| compactions (count) | not recorded | 0 of 13 | not recorded | not recorded | several different causes (2 jobs), the job is not finished (6 jobs), the job owns only some workers of a session, and that session is not counted (5 jobs) |
| retouches (quality) | partial | 7 of 13 | 0 | 0 | the job is not finished (6 jobs) |
| muda_time | not recorded | 0 of 13 | not recorded | not recorded | the independent evaluator has not labeled it (7 jobs), the job is not finished (6 jobs) |
| muda_time.defects (quality) | not recorded | 0 of 13 | not recorded | not recorded | the independent evaluator has not labeled it (7 jobs), the job is not finished (6 jobs) |
| muda_time.overproduction | not recorded | 0 of 13 | not recorded | not recorded | the independent evaluator has not labeled it (7 jobs), the job is not finished (6 jobs) |
| muda_time.waiting | not recorded | 0 of 13 | not recorded | not recorded | the independent evaluator has not labeled it (7 jobs), the job is not finished (6 jobs) |
| muda_time.non_utilized_talent | not recorded | 0 of 13 | not recorded | not recorded | the independent evaluator has not labeled it (7 jobs), the job is not finished (6 jobs) |
| muda_time.transportation | not recorded | 0 of 13 | not recorded | not recorded | the independent evaluator has not labeled it (7 jobs), the job is not finished (6 jobs) |
| muda_time.inventory | not recorded | 0 of 13 | not recorded | not recorded | the independent evaluator has not labeled it (7 jobs), the job is not finished (6 jobs) |
| muda_time.motion | not recorded | 0 of 13 | not recorded | not recorded | the independent evaluator has not labeled it (7 jobs), the job is not finished (6 jobs) |
| muda_time.extra_processing | not recorded | 0 of 13 | not recorded | not recorded | the independent evaluator has not labeled it (7 jobs), the job is not finished (6 jobs) |
| search_waste | not recorded | 0 of 13 | not recorded | not recorded | published facts do not carry it (7 jobs), the job is not finished (6 jobs) |

### By host: mixed

Jobs: 10; open, and so left out of every measure: 7.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | not recorded | 0 of 10 | not recorded | not recorded | the job is not finished (7 jobs), only some sessions supplied it (3 jobs) |
| queue_before_start | partial | 3 of 10 | 0 ms | 0 ms | the job is not finished (7 jobs) |
| active_time | partial | 1 of 10 | 64514796 ms | 64514796 ms | the job is not finished (7 jobs), only some sessions supplied it (2 jobs) |
| flow_efficiency | not recorded | 0 of 10 | not recorded | not recorded | the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (3 jobs), the job is not finished (7 jobs) |
| human_wait | partial | 3 of 10 | 142363561 ms | 307112861 ms | the job is not finished (7 jobs) |
| permission_wait | not recorded | 0 of 10 | not recorded | not recorded | the job is not finished (7 jobs), only some sessions supplied it (3 jobs) |
| api_retry_wait | not recorded | 0 of 10 | not recorded | not recorded | the host records only some of it, so this is a lower bound (3 jobs), the job is not finished (7 jobs) |
| tool_failures (quality) | not recorded | 0 of 10 | not recorded | not recorded | the job is not finished (7 jobs), only some sessions supplied it (3 jobs) |
| tool_retries (quality) | not recorded | 0 of 10 | not recorded | not recorded | the job is not finished (7 jobs), the job owns only some workers of a session, and that session is not counted (3 jobs) |
| api_retries (quality) | not recorded | 0 of 10 | not recorded | not recorded | the job is not finished (7 jobs), the job owns only some workers of a session, and that session is not counted (3 jobs) |
| compactions (count) | not recorded | 0 of 10 | not recorded | not recorded | several different causes (1 job), the job is not finished (7 jobs), the job owns only some workers of a session, and that session is not counted (2 jobs) |
| retouches (quality) | partial | 3 of 10 | 3 | 4 | the job is not finished (7 jobs) |
| muda_time | not recorded | 0 of 10 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (7 jobs), only some sessions supplied it (1 job) |
| muda_time.defects (quality) | not recorded | 0 of 10 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (7 jobs), only some sessions supplied it (1 job) |
| muda_time.overproduction | not recorded | 0 of 10 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (7 jobs), only some sessions supplied it (1 job) |
| muda_time.waiting | not recorded | 0 of 10 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (7 jobs), only some sessions supplied it (1 job) |
| muda_time.non_utilized_talent | not recorded | 0 of 10 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (7 jobs), only some sessions supplied it (1 job) |
| muda_time.transportation | not recorded | 0 of 10 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (7 jobs), only some sessions supplied it (1 job) |
| muda_time.inventory | not recorded | 0 of 10 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (7 jobs), only some sessions supplied it (1 job) |
| muda_time.motion | not recorded | 0 of 10 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (7 jobs), only some sessions supplied it (1 job) |
| muda_time.extra_processing | not recorded | 0 of 10 | not recorded | not recorded | the independent evaluator has not labeled it (2 jobs), the job is not finished (7 jobs), only some sessions supplied it (1 job) |
| search_waste | not recorded | 0 of 10 | not recorded | not recorded | published facts do not carry it (3 jobs), the job is not finished (7 jobs) |

### By job class: other

Jobs: 67; open, and so left out of every measure: 27.

| Measure | State | Jobs counted (n of N) | Median | p75 | Excluded |
| --- | --- | ---: | ---: | ---: | --- |
| lead_time | partial | 20 of 67 | 190602491 ms | 404295000 ms | the job was cancelled (3 jobs), the job is not finished (27 jobs), only some sessions supplied it (17 jobs) |
| queue_before_start | partial | 40 of 67 | 0 ms | 0 ms | the job is not finished (27 jobs) |
| active_time | partial | 20 of 67 | 1654987 ms | 16622011 ms | the job is not finished (27 jobs), only some sessions supplied it (20 jobs) |
| flow_efficiency | partial | 8 of 67 | 0.02% | 20.72% | the job was cancelled (3 jobs), the task card's dates are shorter than the work its sessions recorded, so the lead time is at least that recorded span (17 jobs), the job is not finished (27 jobs), only some sessions supplied it (12 jobs) |
| human_wait | partial | 40 of 67 | 0 ms | 2972093 ms | the job is not finished (27 jobs) |
| permission_wait | partial | 7 of 67 | 0 ms | 0 ms | the host does not record it (30 jobs), the job is not finished (27 jobs), only some sessions supplied it (3 jobs) |
| api_retry_wait | partial | 7 of 67 | 0 ms | 0 ms | the host records only some of it, so this is a lower bound (33 jobs), the job is not finished (27 jobs) |
| tool_failures (quality) | not recorded | 0 of 67 | not recorded | not recorded | the job is not finished (27 jobs), only some sessions supplied it (40 jobs) |
| tool_retries (quality) | not recorded | 0 of 67 | not recorded | not recorded | the job is not finished (27 jobs), the job owns only some workers of a session, and that session is not counted (40 jobs) |
| api_retries (quality) | not recorded | 0 of 67 | not recorded | not recorded | the job is not finished (27 jobs), the job owns only some workers of a session, and that session is not counted (40 jobs) |
| compactions (count) | not recorded | 0 of 67 | not recorded | not recorded | several different causes (3 jobs), the job is not finished (27 jobs), the job owns only some workers of a session, and that session is not counted (37 jobs) |
| retouches (quality) | partial | 40 of 67 | 0 | 0 | the job is not finished (27 jobs) |
| muda_time | partial | 15 of 67 | 147221 ms | 1988945 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.defects (quality) | partial | 15 of 67 | 83314 ms | 292350 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.overproduction | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.waiting | partial | 15 of 67 | 38580 ms | 1648026 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.non_utilized_talent | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.transportation | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.inventory | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.motion | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| muda_time.extra_processing | partial | 15 of 67 | 0 ms | 0 ms | the independent evaluator has not labeled it (23 jobs), the job is not finished (27 jobs), only some sessions supplied it (2 jobs) |
| search_waste | not recorded | 0 of 67 | not recorded | not recorded | published facts do not carry it (40 jobs), the job is not finished (27 jobs) |

## Tool kinds

Calls and failures summed over 481 sessions with facts, each session counted once; most failures first.

| Tool kind | State | Calls | Failures | Sessions counted (n of N) | Why not whole |
| --- | --- | ---: | ---: | ---: | --- |
| shell | partial | 158096 | 9096 | 198 of 217 | the session log ended mid-record and the session was still open |
| read | partial | 31587 | 729 | 98 of 116 | the session log ended mid-record and the session was still open |
| other | partial | 22207 | 366 | 81 of 98 | the session log ended mid-record and the session was still open |
| mcp | partial | 2573 | 174 | 52 of 68 | the session log ended mid-record and the session was still open |
| edit | partial | 14939 | 119 | 54 of 72 | the session log ended mid-record and the session was still open |
| desk | partial | 3585 | 102 | 225 of 244 | the session log ended mid-record and the session was still open |
| search | partial | 2954 | 68 | 225 of 246 | the session log ended mid-record and the session was still open |
| web | partial | 1403 | 53 | 36 of 51 | the session log ended mid-record and the session was still open |
| agent | partial | 3077 | 16 | 43 of 59 | the session log ended mid-record and the session was still open |
| skill | partial | 3007 | 4 | 79 of 97 | the session log ended mid-record and the session was still open |

## Sign-off

- Jobs with a sign-off record: 100; with no work record: 34. Jobs with a work record and no sign-off record: 1.
- Accepted (recorded by the agent on the operator's word): 3.
- Delivered, waiting for sign-off: 27. Refused: 1. Reopened: 2.
- Delivered before sign-off was recorded: 19. Not delivered yet: 48.
- Refusal reasons: incomplete 1.
- Waits that ended in an answer: under 1 hour 2, under 1 day 1, under 7 days 1.
- Waits still open (at least this long): under 1 hour so far 1, at least 1 hour 2, at least 1 day 9, at least 7 days 15.

## First-pass yield

- First-pass yield: at most 18 of 21 delivered jobs passed first time (upper bound 85.71%; 16 waiting for sign-off).
- Sent back: 3. Only changed asks came back: 0.
- Left out of the count: 57 jobs (the task card does not record what was sent back), 22 jobs (the job has no standing delivery yet), 1 job (no outcome record is available).

## Rework

- Jobs with returns recorded: 57 of 101 (partial: the task card does not record what was sent back and no outcome record is available and some of what was sent back was not recorded).
- Returns caught in the task: changed_ask 1, new_information 1. At review: agent_error 2, changed_ask 2, new_information 3. After delivery: agent_error 4, changed_ask 8, new_information 1.
- Returns that were changed asks: 11.
- Reason check on refusals: not recorded (no refusal could be compared with the agent's reason).

## Human attention

- Human attention per accepted outcome: about 30.4 hours (an estimate, method version 1; partial, so a lower bound: the host's record did not include it and a host records the human's turns only in part, so this is a lower bound and some sessions did not record all of the human's turns, so this is a lower bound). That is 91.3 hours of estimated attention over 3 accepted outcomes.
- Human turns per accepted outcome: at least 804 (2412 human turns over 3 accepted outcomes).
- Where the estimate went: 83.2 hours on jobs, 8.1 hours on sessions that were not on any job, 3 minutes on sessions that could not be placed on a job. All of it is in the headline, including time on refused, unsigned and undelivered work.
- Sessions in the period: 471, of which 56 record the human's turns completely. Sessions from before turns were recorded are not in the period. A host that does not record the human's turns (such as Codex) or records them only in part (such as Copilot, or Claude Code when only some prompts carry an origin) makes the figure a lower bound.
- Permission decisions, reported beside the headline and not in it: 6, estimated at 30 seconds (partial: the host does not record it).
- Method: version 1. An estimate of the time the human spent reading the reply and writing the prompt, never longer than the gap before the prompt, and at least 1 second per turn. Reading a reply by size: none 0 ms, xs 1 second, s 5 seconds, m 30 seconds, l 2.5 minutes, xl 6.7 minutes. Writing a prompt by size: none 2 seconds, xs 3 seconds, s 25 seconds, m 2.5 minutes, l 3 minutes, xl 3 minutes. A permission decision counts at most 5 seconds.

## Coverage

- Jobs: 67; open: 27.
- Unattributed sessions: 391 of 481 (3091607903 ms of 20488323629 ms session time).
- Jobs fully labeled: 15; partially labeled: 2; unlabeled: 23.
- Labels files: 40; used: 33; unused: the labeled evidence no longer matches the facts (4 files), the facts do not record which part of the session was the job's (3 files); stop labels dropped: none.
- Job class: every job is other; published facts do not carry the task card's kind.
- Search waste: unavailable; published facts do not carry the organization signal.
