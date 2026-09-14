# T113-S3 BUCK regional fallback fixture

This fixture was captured from routing phase 12 of the real 96-component
Allwinner T113-S3 Linux PCB in `t113-yalc-validation/index.circuit.tsx`. The
phase contains the placed BUCK regulators and SoC fanout produced by Core; it
is not a hand-built or reduced routing input.

The SRJ has 42 connections, 462 obstacles, and 166 traces routed by earlier
phases. Before the fix, the GrowShrink validator checked raw via-to-pad geometry
and rejected a candidate that the regional output's normal clearance
preparation could make valid. Applying that same preparation in the validator
exposed a second issue: a same-net via merge candidate became stale after an
earlier merge in the same batch had already deduplicated it.

The SVG snapshot renders the exact 96-component circuit without routed copper
beside the same PCB with all 208 phase output traces, and the test requires the
phase output to have no relaxed DRC errors.
