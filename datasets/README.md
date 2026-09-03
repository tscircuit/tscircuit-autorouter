# Trace simplification Dataset 01

Generate the dataset with:

```sh
bun scripts/generate-trace-simplification-dataset-01.ts
```

`trace-simplification-dataset-01.jsonl` is newline-delimited JSON. Every line is
an independent `{ input, output }` example. Both fields are complete
`SimpleRouteJson` objects: `input` contains Pipeline 7's stitched, unsimplified
traces and `output` is the result from
`AutoroutingPipelineSolver11_Simplification`. This makes every example directly
replayable through the public JSON-in/JSON-out simplification API.

The generator appends and fsyncs each completed problem before atomically updating
its checkpoint. Restarting the same command scans existing records by
`problemId`, skips completed work, and truncates only an incomplete final line.
Failures go to the adjacent `.errors.jsonl` file and are retried on the next run.

Use `--start` and `--limit` for shards or smoke tests, `--output` for another
destination, and `--effort` to override Pipeline 7's default effort.
