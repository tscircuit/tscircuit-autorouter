# Metal-touch panel: power via almost touches a ground pad

This reproduction uses the 14-component, four-channel LDC1614 metal-touch panel.
Pipeline 9 receives a **0.15 mm via-copper-edge to pad-edge clearance** rule.
It reports success, but a 0.6 mm V3V3 via at approximately
(-0.6348087672, -2.54004) has only **0.0000013 mm** clearance to U1's
bottom-layer GND pad. These are different nets. Two connected trace records
share this via position; the test counts it as one physical violation.

The test intentionally asserts the known defect, following the repro pattern
in PR #2751. It is a normal test: a solver failure, geometry mismatch, or snapshot
failure fails the test. A future fix should change the clearance assertion to
require zero violations. The producing pipeline stage has not been isolated.

The snapshot contains the full routed PCB beside a close-up of the actual pad
and via. The outer pink area marks the via's copper radius plus the required
clearance; it intersects the GND pad. The inner orange disk is the via copper,
and the white disk is its drill. The close-up is in board coordinates, not a
mirrored bottom-side view.

## Fixture provenance

`fixtures/bug-reports/metal-touch-via-pad-clearance/input.srj.json.gz` is the
saved full-board input **after** the original board adapter's coil-obstacle
correction. That correction expands only the four winding obstacles from the
incorrect 0.1 mm thickness to their physical 0.2 mm width and includes their
end extents. It does not move the QFN pad or change the via-clearance rule.
The test passes this input directly to the current Pipeline 9 with caching
disabled; it does not apply a solver patch or reuse saved routed output.

The matching `unrouted.circuit.json.gz` was derived from the original failing
board's Circuit JSON by removing autorouted traces, vias, diagnostics,
schematic/CAD elements, and project metadata. It preserves all 14 PCB
components, the board outline, pads, holes, silkscreen, source connectivity,
and all four authored 52-point winding traces. Newly solved copper is added
to these elements for the full-board snapshot.

Decompressed SHA-256 values are checked in the test:

- SRJ: `851680efcc93d52b162577f18a3f14f55646c05102288e8090ea782cd4b0a108`
- Circuit JSON: `be0ae9459d19a8066689acaf79a264b48de1bb44e2260e9413d49aa4cff358c2`

The earlier board-level DRC used a 0.1 mm threshold and also rejected this
pair. This repro uses the stricter 0.15 mm rule actually declared in the SRJ.
It establishes this specific clearance defect, not overall manufacturing
readiness or absence of other board errors.

Run:

```sh
bun test tests/repro/pipeline9-metal-touch-via-pad-clearance.test.ts --timeout 9999999
```
