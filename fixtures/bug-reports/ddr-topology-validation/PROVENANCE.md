These are unchanged remaining-phase inputs from two real CPU + DDR boards,
rendered from TSX through published `tscircuit@0.0.3095` / core `0.0.2277`,
autorouter `0.0.1041`, and bundled bus-lanes-solver `0.0.45`.

- STM32MP157: OLIMEX STMP157-OLinuXino-LIME2 rev B1, STM32MP157CAA3x with two
  K4B4G1646D-BYK0 chips. Its 40-connection input equals the existing fixture at
  `tests/fixtures/assets/stmp157-remaining-mesh/input.srj.json.gz`; it is reused.
- A64: OLIMEX A64-OLinuXino rev H, Allwinner A64 with two K4B4G1646Q-HYK0 chips.
  `a64.input.srj.json.gz` contains its remaining 43 connections and six layers.

Both inputs follow four completed data bytes (32 signals). Placements, native
pads, existing-copper obstacles, widths, clearances and layers are unchanged.
The `*.preloaded.circuit.json.gz` files contain the actual preceding core output.
The SVGs show those 32 completed DQ routes; they do not show newly routed address,
clock or control signals. Timing and signal integrity are not qualified.

Both designs originate from OLIMEX/OLINUXINO revision
`85eee9c17ee13af65617d73bdd94de7ec49cfb42`, under CC-BY-SA-3.0-US.
Source URLs, capture versions and hashes are in `provenance.json`.

Run from the repository root:

```sh
timeout 120s bun fixtures/bug-reports/ddr-topology-validation/repro.ts stmp157
timeout 120s bun fixtures/bug-reports/ddr-topology-validation/repro.ts a64
```

The runner writes the real input-board SVG before starting Pipeline9, stops only
after topology merging completes, and reports elapsed time, mesh statistics and
an output hash. A watchdog termination is a failed run, not partial success.

On the recorded base, the merger creates 115,881 STM32MP157 regions and 98,097
A64 regions. Final validation then compares every pair, including disjoint
regions: approximately 6.7 billion and 4.8 billion pairs. The isolated profiled
base runs take 169.2 and 139.8 seconds. Their completed outputs are recorded by
hash, not used to bypass a fresh solve. These are local stage measurements,
not full-board routing results or a paired CI timing benchmark.

The indexed validator completes the same stages with byte-identical output.
An unchanged input-board SVG and unchanged mesh hash are expected for this
performance fix. Full-board runs still time out in the subsequent edge stage;
no additional complete DDR board is claimed.
