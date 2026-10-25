# Preserve clipping during target restoration

A generated global via (blue, four layers) overlaps the corner of a component
pad (orange, top only). The sweep correctly clips the pad, but restoration
previously expanded it back over the authoritative via and failed validation.
Restore source bounds only when retained target area covers every original
layer; retain clipped cells otherwise. Input copper and overlap validation
remain unchanged. The pad retains 0.1575 mm², rather than regaining 0.0025 mm²
masked by the via.

![Inspected native regions at their physical size](targets.png)

The generated regression fails on the parent and passes with the fix. All 13
focused topology tests pass with 67 assertions. Blacksmith compares identical
1/128-pair cases, completion, input hashes and target areas; the existing full
85-sample native routing comparison remains enabled. Hosted results must be
reported on both PRs before merge. No full-board success or speed claim yet.
