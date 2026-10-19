# Per-sample thread budgets

`/benchmark --dataset 18 --threads 4` reserves four routing workers per sample.
The flag also works with `./benchmark.sh` and the workflow's `threads` input.
With N > 1, sample concurrency is capped by available CPUs / (N + 1), the requested
`--concurrency`, and the existing 6 GiB per-sample memory limit (minimum one sample).
N = 1 reserves a single CPU. Without the flag, existing concurrency behavior stays
unchanged. Invalid counts and unsupported pipeline/profiling combinations reject.

This PR prepares the benchmark harness before the parallel solver lands. Pipeline9
in this revision executes serially: the runner explicitly logs this and reports
`effectiveThreadsPerSample: 1`. `threadsPerSample` records the requested budget,
not observed usage. #3125 supplies the worker pool and updates effective usage.

Merge this PR into main first, then rebase #3125 and repeat the benchmark comment.
Comment-triggered workflows execute from main. Both compared revisions must
understand the flag; copying head's benchmark harness into an older base would
introduce runtime/build imports the base cannot satisfy. Each revision therefore
keeps its own harness and algorithms, using the same reserved sample CPU budget.
The comparison measures the serial baseline against the parallel PR.
