# Differential-pair post-processing reports success after rejection

For the real Ethernet board, see `../rgmii-phy-post-processing/REPORT.md` and
`tests/bugs/rgmii-phy-post-processing.test.ts`. This smaller case remains the
fast parent-Pipeline9 integration regression.

The SRJ comes from a four-pad tscircuit board: two 0.15 mm traces, a 0.2 mm
edge-to-edge pair gap, 0.1 mm length tolerance, and a deliberately strict 0.1 mm
maximum uncoupled length. The negative endpoint is 3 mm shorter than the
positive endpoint. It is a failure-reporting reproduction, not a complete
Ethernet board or evidence of manufacturable signal integrity.

Pipeline9 currently finishes with `solved=true`, `failed=false`, and no error.
The nested length-matching `PostProcessingSolver` rejects the pair with a
`no-valid-candidate` diagnostic and returns its input HD routes. The autorouter's
`LengthMatchingPostProcessingSolver` reads only `hdRoutes`, discarding
`postProcessingErrors`.

Expected behavior: Pipeline9 fails and preserves the pair-specific diagnostic.
An infeasible constraint must not be reported as successful routing.

Run the characterization regression and create its actual solver snapshot:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test tests/bugs/differential-pair-silent-failure.test.ts --timeout 9999999
```

The Cosmos fixture pins Pipeline9 and uses the same SRJ with the interactive
pipeline debugger. The snapshot records real post-processing geometry and the
parent solver's status. Ordinary clearance DRC alone does not validate the
differential-pair coupling constraint.
