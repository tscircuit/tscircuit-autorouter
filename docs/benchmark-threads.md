# Routing threads per sample

`/benchmark --pipeline 9 --dataset srj18 --threads 4`

The same flag works with `./benchmark.sh` and the workflow's `threads` input.
Pipeline9 runs its high-density batches in a separate Bun worker pool for each
sample. `--threads 1` keeps execution inline; omitting the flag preserves existing
concurrency behavior. Other pipelines reject thread counts above one.

With N > 1, each sample reserves N routing workers plus one coordinator.
Concurrent samples are capped at the smaller of the requested `--concurrency`,
available CPUs divided by N + 1, and the existing 6 GiB per-sample memory limit.
For example, 32 available CPUs allow six samples with four workers each, or three
samples with eight workers each, before memory limits. At least one sample runs,
even when an explicit worker count exceeds available CPUs.

Reports record requested sample concurrency, actual sample workers,
`threadsPerSample`, and `cpuBudgetPerSample`. Sample timing includes pool startup,
message copying, and disposal. Workers are built once before samples start.
Worker failures fail the sample; they do not retry serially.

Same-machine comparisons use identical benchmark scripts on base and head.
Each revision builds its own worker payload from its own algorithms. The base
must already support the SolverRuntime API (#3125). Threaded profiling and
Pipeline9's separate networked execution mode are rejected.
