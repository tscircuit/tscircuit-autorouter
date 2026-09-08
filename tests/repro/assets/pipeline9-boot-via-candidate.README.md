# Recorded boot-resistor via candidate

This fixture comes from a real TSX T113-S3 Linux-board build, not a manually
invented route. It isolates a geometry interpretation bug; it is not a complete
board, a fresh minimal-circuit autoroute, or manufacturing approval.

The fixture retains the actual `U_SOC` T113-S3 and `R_BOOT_SEL1` 3.3kΩ
`0402WGF3301TCE` components, all their source/PCB ports, the processor's complete
129-pad footprint, and both resistor pads. Selected record fields preserve their
original values. Both earlier native connections and preloaded traces remain:

- `source_trace_121`: R_BOOT_SEL1.pin1 → U_SOC.PC5.
- `source_trace_122`: R_BOOT_SEL1.pin2 → GND, originally using a native plane
  fanout to inner5, with a .55mm via pad and .30mm drill.

`candidateRoute` is the exact recorded internal replacement
`source_trace_122_fixed_100_0`, from the first raw-accepted/canonical-rejected
regional candidate in node `cmn_29`. `nodeWithPortPoints` is the actual recorded
regional constructor input, including all twelve ports for the five neighboring
SD routes and the ground replacement. Only the ground candidate is replayed by
the geometry regression; the other five candidate routes are intentionally not
included. Neither pads nor route coordinates have been changed.

The explicit via is at (-2.4770933636363623, 41.14003266666667), but the final
point is (-2.546, 41.1, z5). The faulty raw geometry helper checks the final
point as the via center. The native validator rejects the actual via's
.051188823mm gap to pin1/PC5 against the .10mm rule. Pin2/GND belongs to the
same net and is intentionally excluded by that validator. The raw proxy's gap
to PC5 is .129816mm, incorrectly passing. Materialization already honors the
explicit via; the regression makes validation inspect that same geometry.

The SVG compares the raw and materialized interpretations. The repro PR
records the erroneous acceptance; the stacked fix changes that assertion and
the first SVG panel to agree with the materialized copper. The test exercises
the native portfolio validator without mocking its decision.

```sh
bun test tests/repro/pipeline9-boot-via-endpoint.test.ts --timeout 9999999
```

## Provenance and regeneration

The JSON includes the exact phase-input SHA256, original source/trace/net IDs,
source versions, and portable capture filenames. Its recorded runtime included
isolated experimental patches and process-local observation; this is not a
claim that the entire captured solve ran on pristine published packages. The
captured raw route itself is unmodified and the targeted geometry helper can
be exercised independently.

With the original diagnostic artifact bundle available, run:

```sh
bun scripts/extract-pipeline9-boot-via-repro.ts \
  /path/to/artifacts/native-sd-south-interface \
  /path/to/artifacts/audit/phase153-materialization-observe/captures.json
```

The bundle must also contain the sibling
`phase153-sd-south-interface-diagnosis/captures.json`, which supplies the actual
regional constructor node. The extractor verifies the specific phase-input
hash and fails on a different board revision. The committed JSON is sufficient
for the regression test; tests do not need the original external bundle.

The generated asset uses compact JSON to retain the full authentic footprint
under 100KB. No absolute host paths are stored in it.
