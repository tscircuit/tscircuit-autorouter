# Record port point A* searches

Run a complete Pipeline 7 or 9 board with recording enabled:

```sh
bun scripts/record-port-point-search.ts \
  --pipeline 9 \
  --srj-path fixtures/legacy/assets/e2e3.json \
  --out-dir tmp/e2e3-search \
  --full-run
```

`--pipeline` accepts 7 (default) or 9. The output directory must be new. Without `--full-run`, execution ends after port
point pathing succeeds. `--effort N` controls solver effort (default 1).
`--events-jsonl-only` keeps every event in JSONL and omits duplicate mini files
for large recordings. Solver input and attempt snapshots remain complete.
`--no-record` runs the same pipeline without instrumentation for output comparisons.
Normal autorouter calls do not load or pay for this recorder.

Open `search/README.md` for local links to totals, representative event JSONs,
solver graphs, and route-attempt snapshots. `input.srj.json` retains the input,
`port-point-output.json` retains pathing output, and completed full runs also
write `output.srj.json`. `result.json` reports solver completion, not DRC validation.

`search/events.jsonl` holds every event in sequence. By default, the same records
exist as individual mini JSONs under `search/events/`, grouped into folders of
1,000 files; `--events-jsonl-only` omits those duplicate files.
`search/manifest.json` reports totals and whether recording completed or failed.
An abruptly terminated process retains its event files and a `recording` manifest;
that manifest's totals are not final.

Events include:

- `solver-start`: a new graph search, including constructor-time probe searches.
- `attempt-start`: route metadata; its snapshot saves assignments, region segments,
  congestion costs and remaining routes before starting the search.
- `candidate`: a candidate submitted to the frontier, with `g`, `h`, `f`, port,
  regions, globally unique ID and parent ID. Indexed heaps may replace a worse hop.
- `pop`, `pop-rejected`, `expansion`: frontier selections, stale/reserved rejections,
  and actual expansions with the ordered neighbor port IDs.
- `neighbor`: every examined neighbor, with outcome and computed cost when the
  algorithm evaluates it. Rejected neighbors don't necessarily have a candidate
  object or heuristic. Early goal contact stops the remaining neighbor loop.
- `path-proposed`, `path-result`: proposed segments and whether the route was
  accepted. Distance-aware search can queue a goal candidate before acceptance.
- `frontier-clear`, `frontier-exhausted`: discarded frontier IDs and exhaustion.

IDs for ports, regions, and routes are local to a solver. Resolve them through
`solvers/<solverId>/input.json`, which contains full topology and problem metadata.
Events also contain stage, iteration, route ID and attempt. Nonfinite numeric
values are represented as strings to avoid losing them as JSON nulls.

This Bun-only debugging runner instruments the locked tiny-hypergraph source in
memory before imports. It does not modify node_modules or the production solver.
A SHA-256 guard rejects upstream loop changes until the recorder is updated.
It covers the tiny-hypergraph A* used by Pipelines 7/9 and its nested searches, not
other port-point implementations or high-density search. Synchronous event writes
make recorded timing unsuitable for performance measurements. There is no sampling
or event cap; large searches can create substantial output.

Validation:

```sh
bun test tests/port-point-search-recording.test.ts --timeout 9999999
```

The test compares full e2e3 output with an uninstrumented run and checks every
individual event, candidate-parent link, and expanded neighbor sequence.
