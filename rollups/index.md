# Factory rollups

Totals and distributions across jobs, grouped by plugin version, host, job class and waste type; tool kinds are summed per session. They name no person, machine, date or time of day.

Only finished jobs count: every measure of a job that is not done or cancelled, or whose lead time is censored, is excluded as open_job. Only complete values count: a measure a finished job could not supply, or could supply only for some sessions (partial), is excluded and listed with its reason, never counted as zero. Medians and p75 use the nearest-rank method: the value at rank ceil(p × n) of the counted values sorted ascending.

## Waste by type

Muda time from the independent evaluator's labels, largest first; ties are broken by waste name. A job counts only when it is finished and every one of its sessions is labeled. Each session's waste counts once in a total, even when several jobs share the session.

### All jobs

No fully labeled finished job yet: 0 of 43 jobs fully labeled; excluded: not_labeled 16, open_job 26, partial 1.

### By job class: other

No fully labeled finished job yet: 0 of 43 jobs fully labeled; excluded: not_labeled 16, open_job 26, partial 1.

### By plugin version: 3.2.0-alpha.48

No fully labeled finished job yet: 0 of 1 jobs fully labeled; excluded: not_labeled 1.

### By plugin version: 3.2.0-alpha.93

No fully labeled finished job yet: 0 of 8 jobs fully labeled; excluded: not_labeled 3, open_job 5.

### By plugin version: 3.2.0-alpha.98

No fully labeled finished job yet: 0 of 2 jobs fully labeled; excluded: not_labeled 2.

### By plugin version: 3.2.0-alpha.112

No fully labeled finished job yet: 0 of 1 jobs fully labeled; excluded: open_job 1.

### By plugin version: 3.2.0-alpha.122

No fully labeled finished job yet: 0 of 8 jobs fully labeled; excluded: not_labeled 6, open_job 2.

### By plugin version: 3.2.0-alpha.143

No fully labeled finished job yet: 0 of 6 jobs fully labeled; excluded: not_labeled 1, open_job 5.

### By plugin version: 3.2.0-alpha.147

No fully labeled finished job yet: 0 of 1 jobs fully labeled; excluded: open_job 1.

### By plugin version: 3.2.0-alpha.159

No fully labeled finished job yet: 0 of 3 jobs fully labeled; excluded: open_job 3.

### By plugin version: mixed

No fully labeled finished job yet: 0 of 12 jobs fully labeled; excluded: not_labeled 2, open_job 9, partial 1.

### By plugin version: unknown

No fully labeled finished job yet: 0 of 1 jobs fully labeled; excluded: not_labeled 1.

## Measures

Quality measures, which andon watches first, are marked (quality).

### All jobs

Jobs: 43; open, and so left out of every measure: 26.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 14 | 12403000 ms | 31254000 ms | cancelled 1, job_offsets_unavailable 2, open_job 26 |
| queue_before_start | 15 | 182727464 ms | 531299150 ms | job_offsets_unavailable 2, open_job 26 |
| active_time | 10 | 65229 ms | 995826 ms | job_offsets_unavailable 2, open_job 26, partial 5 |
| flow_efficiency | 10 | 0.00% | 50.61% | cancelled 1, job_offsets_unavailable 2, open_job 26, partial 4 |
| human_wait | 15 | 38580 ms | 3197111 ms | job_offsets_unavailable 2, open_job 26 |
| permission_wait | 0 | unavailable | unavailable | host_does_not_record 15, job_offsets_unavailable 2, open_job 26 |
| api_retry_wait | 15 | 0 ms | 0 ms | job_offsets_unavailable 2, open_job 26 |
| tool_failures (quality) | 10 | 0 | 3 | open_job 26, partial 7 |
| tool_retries (quality) | 10 | 0 | 3 | open_job 26, partial 1, worker_split 6 |
| api_retries (quality) | 10 | 0 | 0 | open_job 26, partial 1, worker_split 6 |
| compactions | 10 | 0 | 0 | open_job 26, partial 1, worker_split 6 |
| retouches (quality) | 17 | 0 | 0 | open_job 26 |
| muda_time | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 17, open_job 26 |

### By plugin version: 3.2.0-alpha.48

Jobs: 1; open, and so left out of every measure: 0.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 1 | 5057 ms | 5057 ms | none |
| queue_before_start | 1 | 0 ms | 0 ms | none |
| active_time | 1 | 52009 ms | 52009 ms | none |
| flow_efficiency | 1 | 100.00% | 100.00% | none |
| human_wait | 1 | 38580 ms | 38580 ms | none |
| permission_wait | 0 | unavailable | unavailable | host_does_not_record 1 |
| api_retry_wait | 1 | 0 ms | 0 ms | none |
| tool_failures (quality) | 1 | 3 | 3 | none |
| tool_retries (quality) | 1 | 3 | 3 | none |
| api_retries (quality) | 1 | 0 | 0 | none |
| compactions | 1 | 0 | 0 | none |
| retouches (quality) | 1 | 0 | 0 | none |
| muda_time | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 1 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 1 |

### By plugin version: 3.2.0-alpha.93

Jobs: 8; open, and so left out of every measure: 5.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 2 | 2844000 ms | 23579000 ms | cancelled 1, open_job 5 |
| queue_before_start | 3 | 0 ms | 436487077 ms | open_job 5 |
| active_time | 0 | unavailable | unavailable | open_job 5, partial 3 |
| flow_efficiency | 0 | unavailable | unavailable | cancelled 1, open_job 5, partial 2 |
| human_wait | 3 | 2320146 ms | 3197111 ms | open_job 5 |
| permission_wait | 0 | unavailable | unavailable | host_does_not_record 3, open_job 5 |
| api_retry_wait | 3 | 0 ms | 3061996 ms | open_job 5 |
| tool_failures (quality) | 0 | unavailable | unavailable | open_job 5, partial 3 |
| tool_retries (quality) | 0 | unavailable | unavailable | open_job 5, worker_split 3 |
| api_retries (quality) | 0 | unavailable | unavailable | open_job 5, worker_split 3 |
| compactions | 0 | unavailable | unavailable | open_job 5, worker_split 3 |
| retouches (quality) | 3 | 0 | 0 | open_job 5 |
| muda_time | 0 | unavailable | unavailable | not_labeled 3, open_job 5 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 3, open_job 5 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 3, open_job 5 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 3, open_job 5 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 3, open_job 5 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 3, open_job 5 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 3, open_job 5 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 3, open_job 5 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 3, open_job 5 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 3, open_job 5 |

### By plugin version: 3.2.0-alpha.98

Jobs: 2; open, and so left out of every measure: 0.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 2 | 2638575 ms | 6087584 ms | none |
| queue_before_start | 2 | 0 ms | 0 ms | none |
| active_time | 2 | 5218197 ms | 5271355 ms | none |
| flow_efficiency | 2 | 50.61% | 85.58% | none |
| human_wait | 2 | 3635146 ms | 5413464 ms | none |
| permission_wait | 0 | unavailable | unavailable | host_does_not_record 2 |
| api_retry_wait | 2 | 0 ms | 0 ms | none |
| tool_failures (quality) | 0 | unavailable | unavailable | partial 2 |
| tool_retries (quality) | 0 | unavailable | unavailable | worker_split 2 |
| api_retries (quality) | 0 | unavailable | unavailable | worker_split 2 |
| compactions | 0 | unavailable | unavailable | worker_split 2 |
| retouches (quality) | 2 | 0 | 0 | none |
| muda_time | 0 | unavailable | unavailable | not_labeled 2 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 2 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 2 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 2 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 2 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 2 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 2 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 2 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 2 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 2 |

### By plugin version: 3.2.0-alpha.112

Jobs: 1; open, and so left out of every measure: 1.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 0 | unavailable | unavailable | open_job 1 |
| queue_before_start | 0 | unavailable | unavailable | open_job 1 |
| active_time | 0 | unavailable | unavailable | open_job 1 |
| flow_efficiency | 0 | unavailable | unavailable | open_job 1 |
| human_wait | 0 | unavailable | unavailable | open_job 1 |
| permission_wait | 0 | unavailable | unavailable | open_job 1 |
| api_retry_wait | 0 | unavailable | unavailable | open_job 1 |
| tool_failures (quality) | 0 | unavailable | unavailable | open_job 1 |
| tool_retries (quality) | 0 | unavailable | unavailable | open_job 1 |
| api_retries (quality) | 0 | unavailable | unavailable | open_job 1 |
| compactions | 0 | unavailable | unavailable | open_job 1 |
| retouches (quality) | 0 | unavailable | unavailable | open_job 1 |
| muda_time | 0 | unavailable | unavailable | open_job 1 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | open_job 1 |
| muda_time.overproduction | 0 | unavailable | unavailable | open_job 1 |
| muda_time.waiting | 0 | unavailable | unavailable | open_job 1 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | open_job 1 |
| muda_time.transportation | 0 | unavailable | unavailable | open_job 1 |
| muda_time.inventory | 0 | unavailable | unavailable | open_job 1 |
| muda_time.motion | 0 | unavailable | unavailable | open_job 1 |
| muda_time.extra_processing | 0 | unavailable | unavailable | open_job 1 |
| search_waste | 0 | unavailable | unavailable | open_job 1 |

### By plugin version: 3.2.0-alpha.122

Jobs: 8; open, and so left out of every measure: 2.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 6 | 20212000 ms | 46192000 ms | open_job 2 |
| queue_before_start | 6 | 531299150 ms | 3207276150 ms | open_job 2 |
| active_time | 6 | 65229 ms | 65229 ms | open_job 2 |
| flow_efficiency | 6 | 0.00% | 0.00% | open_job 2 |
| human_wait | 6 | 0 ms | 0 ms | open_job 2 |
| permission_wait | 0 | unavailable | unavailable | host_does_not_record 6, open_job 2 |
| api_retry_wait | 6 | 0 ms | 0 ms | open_job 2 |
| tool_failures (quality) | 6 | 0 | 0 | open_job 2 |
| tool_retries (quality) | 6 | 0 | 0 | open_job 2 |
| api_retries (quality) | 6 | 0 | 0 | open_job 2 |
| compactions | 6 | 0 | 0 | open_job 2 |
| retouches (quality) | 6 | 0 | 0 | open_job 2 |
| muda_time | 0 | unavailable | unavailable | not_labeled 6, open_job 2 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 6, open_job 2 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 6, open_job 2 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 6, open_job 2 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 6, open_job 2 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 6, open_job 2 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 6, open_job 2 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 6, open_job 2 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 6, open_job 2 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 6, open_job 2 |

### By plugin version: 3.2.0-alpha.143

Jobs: 6; open, and so left out of every measure: 5.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 0 | unavailable | unavailable | job_offsets_unavailable 1, open_job 5 |
| queue_before_start | 0 | unavailable | unavailable | job_offsets_unavailable 1, open_job 5 |
| active_time | 0 | unavailable | unavailable | job_offsets_unavailable 1, open_job 5 |
| flow_efficiency | 0 | unavailable | unavailable | job_offsets_unavailable 1, open_job 5 |
| human_wait | 0 | unavailable | unavailable | job_offsets_unavailable 1, open_job 5 |
| permission_wait | 0 | unavailable | unavailable | job_offsets_unavailable 1, open_job 5 |
| api_retry_wait | 0 | unavailable | unavailable | job_offsets_unavailable 1, open_job 5 |
| tool_failures (quality) | 1 | 16 | 16 | open_job 5 |
| tool_retries (quality) | 1 | 16 | 16 | open_job 5 |
| api_retries (quality) | 1 | 0 | 0 | open_job 5 |
| compactions | 1 | 0 | 0 | open_job 5 |
| retouches (quality) | 1 | 0 | 0 | open_job 5 |
| muda_time | 0 | unavailable | unavailable | not_labeled 1, open_job 5 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 1, open_job 5 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 1, open_job 5 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 1, open_job 5 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 1, open_job 5 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 1, open_job 5 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 1, open_job 5 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 1, open_job 5 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 1, open_job 5 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 1, open_job 5 |

### By plugin version: 3.2.0-alpha.147

Jobs: 1; open, and so left out of every measure: 1.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 0 | unavailable | unavailable | open_job 1 |
| queue_before_start | 0 | unavailable | unavailable | open_job 1 |
| active_time | 0 | unavailable | unavailable | open_job 1 |
| flow_efficiency | 0 | unavailable | unavailable | open_job 1 |
| human_wait | 0 | unavailable | unavailable | open_job 1 |
| permission_wait | 0 | unavailable | unavailable | open_job 1 |
| api_retry_wait | 0 | unavailable | unavailable | open_job 1 |
| tool_failures (quality) | 0 | unavailable | unavailable | open_job 1 |
| tool_retries (quality) | 0 | unavailable | unavailable | open_job 1 |
| api_retries (quality) | 0 | unavailable | unavailable | open_job 1 |
| compactions | 0 | unavailable | unavailable | open_job 1 |
| retouches (quality) | 0 | unavailable | unavailable | open_job 1 |
| muda_time | 0 | unavailable | unavailable | open_job 1 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | open_job 1 |
| muda_time.overproduction | 0 | unavailable | unavailable | open_job 1 |
| muda_time.waiting | 0 | unavailable | unavailable | open_job 1 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | open_job 1 |
| muda_time.transportation | 0 | unavailable | unavailable | open_job 1 |
| muda_time.inventory | 0 | unavailable | unavailable | open_job 1 |
| muda_time.motion | 0 | unavailable | unavailable | open_job 1 |
| muda_time.extra_processing | 0 | unavailable | unavailable | open_job 1 |
| search_waste | 0 | unavailable | unavailable | open_job 1 |

### By plugin version: 3.2.0-alpha.159

Jobs: 3; open, and so left out of every measure: 3.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 0 | unavailable | unavailable | open_job 3 |
| queue_before_start | 0 | unavailable | unavailable | open_job 3 |
| active_time | 0 | unavailable | unavailable | open_job 3 |
| flow_efficiency | 0 | unavailable | unavailable | open_job 3 |
| human_wait | 0 | unavailable | unavailable | open_job 3 |
| permission_wait | 0 | unavailable | unavailable | open_job 3 |
| api_retry_wait | 0 | unavailable | unavailable | open_job 3 |
| tool_failures (quality) | 0 | unavailable | unavailable | open_job 3 |
| tool_retries (quality) | 0 | unavailable | unavailable | open_job 3 |
| api_retries (quality) | 0 | unavailable | unavailable | open_job 3 |
| compactions | 0 | unavailable | unavailable | open_job 3 |
| retouches (quality) | 0 | unavailable | unavailable | open_job 3 |
| muda_time | 0 | unavailable | unavailable | open_job 3 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | open_job 3 |
| muda_time.overproduction | 0 | unavailable | unavailable | open_job 3 |
| muda_time.waiting | 0 | unavailable | unavailable | open_job 3 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | open_job 3 |
| muda_time.transportation | 0 | unavailable | unavailable | open_job 3 |
| muda_time.inventory | 0 | unavailable | unavailable | open_job 3 |
| muda_time.motion | 0 | unavailable | unavailable | open_job 3 |
| muda_time.extra_processing | 0 | unavailable | unavailable | open_job 3 |
| search_waste | 0 | unavailable | unavailable | open_job 3 |

### By plugin version: mixed

Jobs: 12; open, and so left out of every measure: 9.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 3 | 28580000 ms | 94311000 ms | open_job 9 |
| queue_before_start | 3 | 0 ms | 182727464 ms | open_job 9 |
| active_time | 1 | 995826 ms | 995826 ms | open_job 9, partial 2 |
| flow_efficiency | 1 | 0.61% | 0.61% | open_job 9, partial 2 |
| human_wait | 3 | 1980715 ms | 133516033 ms | open_job 9 |
| permission_wait | 0 | unavailable | unavailable | host_does_not_record 3, open_job 9 |
| api_retry_wait | 3 | 0 ms | 0 ms | open_job 9 |
| tool_failures (quality) | 1 | 4 | 4 | open_job 9, partial 2 |
| tool_retries (quality) | 1 | 3 | 3 | open_job 9, partial 1, worker_split 1 |
| api_retries (quality) | 1 | 0 | 0 | open_job 9, partial 1, worker_split 1 |
| compactions | 1 | 0 | 0 | open_job 9, partial 1, worker_split 1 |
| retouches (quality) | 3 | 1 | 1 | open_job 9 |
| muda_time | 0 | unavailable | unavailable | not_labeled 2, open_job 9, partial 1 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 2, open_job 9, partial 1 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 2, open_job 9, partial 1 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 2, open_job 9, partial 1 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 2, open_job 9, partial 1 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 2, open_job 9, partial 1 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 2, open_job 9, partial 1 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 2, open_job 9, partial 1 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 2, open_job 9, partial 1 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 3, open_job 9 |

### By plugin version: unknown

Jobs: 1; open, and so left out of every measure: 0.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| queue_before_start | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| active_time | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| flow_efficiency | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| human_wait | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| permission_wait | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| api_retry_wait | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| tool_failures (quality) | 1 | 1 | 1 | none |
| tool_retries (quality) | 1 | 1 | 1 | none |
| api_retries (quality) | 1 | 0 | 0 | none |
| compactions | 1 | 0 | 0 | none |
| retouches (quality) | 1 | 0 | 0 | none |
| muda_time | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 1 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 1 |

### By host: claude-code

Jobs: 42; open, and so left out of every measure: 26.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 14 | 12403000 ms | 31254000 ms | cancelled 1, job_offsets_unavailable 1, open_job 26 |
| queue_before_start | 15 | 182727464 ms | 531299150 ms | job_offsets_unavailable 1, open_job 26 |
| active_time | 10 | 65229 ms | 995826 ms | job_offsets_unavailable 1, open_job 26, partial 5 |
| flow_efficiency | 10 | 0.00% | 50.61% | cancelled 1, job_offsets_unavailable 1, open_job 26, partial 4 |
| human_wait | 15 | 38580 ms | 3197111 ms | job_offsets_unavailable 1, open_job 26 |
| permission_wait | 0 | unavailable | unavailable | host_does_not_record 15, job_offsets_unavailable 1, open_job 26 |
| api_retry_wait | 15 | 0 ms | 0 ms | job_offsets_unavailable 1, open_job 26 |
| tool_failures (quality) | 9 | 0 | 3 | open_job 26, partial 7 |
| tool_retries (quality) | 9 | 0 | 3 | open_job 26, partial 1, worker_split 6 |
| api_retries (quality) | 9 | 0 | 0 | open_job 26, partial 1, worker_split 6 |
| compactions | 9 | 0 | 0 | open_job 26, partial 1, worker_split 6 |
| retouches (quality) | 16 | 0 | 0 | open_job 26 |
| muda_time | 0 | unavailable | unavailable | not_labeled 15, open_job 26, partial 1 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 15, open_job 26, partial 1 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 15, open_job 26, partial 1 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 15, open_job 26, partial 1 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 15, open_job 26, partial 1 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 15, open_job 26, partial 1 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 15, open_job 26, partial 1 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 15, open_job 26, partial 1 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 15, open_job 26, partial 1 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 16, open_job 26 |

### By host: copilot-cli

Jobs: 1; open, and so left out of every measure: 0.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| queue_before_start | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| active_time | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| flow_efficiency | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| human_wait | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| permission_wait | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| api_retry_wait | 0 | unavailable | unavailable | job_offsets_unavailable 1 |
| tool_failures (quality) | 1 | 1 | 1 | none |
| tool_retries (quality) | 1 | 1 | 1 | none |
| api_retries (quality) | 1 | 0 | 0 | none |
| compactions | 1 | 0 | 0 | none |
| retouches (quality) | 1 | 0 | 0 | none |
| muda_time | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 1 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 1 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 1 |

### By job class: other

Jobs: 43; open, and so left out of every measure: 26.

| Measure | Jobs counted | Median | p75 | Excluded |
| --- | ---: | ---: | ---: | --- |
| lead_time | 14 | 12403000 ms | 31254000 ms | cancelled 1, job_offsets_unavailable 2, open_job 26 |
| queue_before_start | 15 | 182727464 ms | 531299150 ms | job_offsets_unavailable 2, open_job 26 |
| active_time | 10 | 65229 ms | 995826 ms | job_offsets_unavailable 2, open_job 26, partial 5 |
| flow_efficiency | 10 | 0.00% | 50.61% | cancelled 1, job_offsets_unavailable 2, open_job 26, partial 4 |
| human_wait | 15 | 38580 ms | 3197111 ms | job_offsets_unavailable 2, open_job 26 |
| permission_wait | 0 | unavailable | unavailable | host_does_not_record 15, job_offsets_unavailable 2, open_job 26 |
| api_retry_wait | 15 | 0 ms | 0 ms | job_offsets_unavailable 2, open_job 26 |
| tool_failures (quality) | 10 | 0 | 3 | open_job 26, partial 7 |
| tool_retries (quality) | 10 | 0 | 3 | open_job 26, partial 1, worker_split 6 |
| api_retries (quality) | 10 | 0 | 0 | open_job 26, partial 1, worker_split 6 |
| compactions | 10 | 0 | 0 | open_job 26, partial 1, worker_split 6 |
| retouches (quality) | 17 | 0 | 0 | open_job 26 |
| muda_time | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.defects (quality) | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.overproduction | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.waiting | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.non_utilized_talent | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.transportation | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.inventory | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.motion | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| muda_time.extra_processing | 0 | unavailable | unavailable | not_labeled 16, open_job 26, partial 1 |
| search_waste | 0 | unavailable | unavailable | not_in_published_facts 17, open_job 26 |

## Tool kinds

Calls and failures summed over 302 sessions with facts, each session counted once; most failures first.

| Tool kind | Calls | Failures | Sessions |
| --- | ---: | ---: | ---: |
| shell | 61291 | 2068 | 91 |
| read | 5110 | 73 | 30 |
| other | 639 | 44 | 15 |
| edit | 4376 | 31 | 20 |
| agent | 1529 | 20 | 17 |
| web | 865 | 9 | 14 |
| desk | 233 | 7 | 83 |
| mcp | 150 | 6 | 10 |
| search | 583 | 0 | 95 |
| skill | 127 | 0 | 29 |

## Coverage

- Jobs: 43; open: 26.
- Unattributed sessions: 267 of 302 (547740827 ms of 2186759830 ms session time).
- Jobs fully labeled: 0; partially labeled: 1; unlabeled: 16.
- Labels files: 1; used: 1; unused: none.
- Job class: every job is other; published facts do not carry the task card's kind.
- Search waste: unavailable; published facts do not carry the organization signal.
