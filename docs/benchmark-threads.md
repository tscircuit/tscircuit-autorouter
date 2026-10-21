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

For `/benchmark --dataset 18 --threads 4`, the same-machine job runs four
independent passes sequentially: Base with inline routing, PR with inline routing,
Base with four workers, then PR with four workers. The table shows `Base`, `PR`,
`Base (4T)`, and `PR (4T)` in that order. Other thread counts use the corresponding
labels. Each pass retains that revision's own benchmark harness and algorithms,
with separate raw reports, snapshots, and stage timings. Threaded comparisons
therefore run twice as many passes as ordinary comparisons.

Inline passes explicitly use `--threads 1`; threaded passes use the requested
worker count and its sample-concurrency budget. Reports show effective configured
threads and concurrent samples, including when an older base only supports a
serial implementation. Omitting `--threads`, or using `--threads 1`, retains the
ordinary Base/PR comparison. Threaded profiling and Pipeline9's separate networked
mode are rejected.
