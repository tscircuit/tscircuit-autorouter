# SRJ18 visual comparison for PR #2706

Review-only branch. Do not merge this branch.

These 16 PNG pairs enable GitHub's native image diff (2-up, Swipe, and Onion Skin).
The first commit contains the before images; the second replaces the same paths with the after images.
The code PR and its file tree are unchanged: https://github.com/tscircuit/tscircuit-autorouter/pull/2706

## Benchmark provenance

- Before: eb7e607ee793985a65994a768e5f1edb84d97d5b
- After: cd3306db174a68c9b957abd2c5039e25bc14acdf
- Pipeline 9, effort 1, all 16 SRJ18 samples, concurrency 4, 360-second limit per sample.
- Same Blacksmith 4-vCPU ARM Ubuntu 24.04 runner and Bun 1.4.2.
- Run: https://github.com/tscircuit/tscircuit-autorouter/actions/runs/35920291431
- Images rasterized from the completed benchmark SVGs at 1800 x 1800 with matching viewports.
- Sample 6 timed out after the change; sample 15 timed out before the change. Those sides show an explicit outcome card because no completed routing image exists.

Across the 14 samples solved on both versions: vias 2788 -> 2763; bends 18771 -> 10933; wire length 30638.6 -> 30281.8 mm. Both versions solved 15/16, with different timeout samples.
