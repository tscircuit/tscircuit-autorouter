# SRJ18 solver profile

Profiled 14 completed problems out of 16 (2 incomplete) with concurrency 1. The profiling command took 2608.21s wall-clock time.

Measured on a Blacksmith 4-vCPU Ubuntu 24.04 ARM runner on 2026-08-18, against autorouter commit `2601b9eb`. Incomplete problems excluded from the table: sample014, sample015.

Each cell is the inclusive wall-clock time accumulated by every completed instance of that solver for the problem. Nested solver timings can overlap, so solver rows should not be added together to infer problem wall time. An em dash means the solver did not run.

| Solver | sample001 | sample002 | sample003 | sample004 | sample005 | sample006 | sample007 | sample008 | sample009 | sample010 | sample011 | sample012 | sample013 | sample016 | Total |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Problem wall time** | **27.97s** | **340.75s** | **33.71s** | **116.20s** | **25.76s** | **718.41s** | **44.46s** | **167.22s** | **71.08s** | **140.50s** | **111.28s** | **268.17s** | **236.43s** | **65.46s** | **2367.41s** |
| SingleHighDensityRouteSolver | 32.40s | 4430.75s | 115.39s | 345.38s | 15.27s | 6256.85s | 20.61s | 498.43s | 82.45s | 1743.12s | 970.79s | 345.13s | 1918.19s | 158.63s | 16933.39s |
| CachedIntraNodeRouteSolver | 32.81s | 3644.76s | 116.04s | 346.60s | 15.91s | 5702.46s | 21.02s | 500.23s | 82.12s | 1055.79s | 965.60s | 332.92s | 1922.70s | 159.14s | 14898.09s |
| HighDensitySolver | 9.62s | 173.94s | 12.49s | 43.64s | 8.12s | 258.33s | 10.17s | 59.28s | 15.53s | 99.30s | 44.73s | 57.96s | 126.40s | 16.46s | 935.98s |
| GrowShrinkHighDensityIntraNodeSolver | 9.59s | 173.90s | 12.47s | 43.62s | 8.10s | 258.28s | 10.15s | 59.24s | 15.51s | 99.28s | 44.70s | 57.90s | 126.37s | 16.44s | 935.55s |
| PortfolioSingleIntraNodeSolver | 9.58s | 173.89s | 12.46s | 43.61s | 8.09s | 258.26s | 10.14s | 59.22s | 15.50s | 99.27s | 44.69s | 57.89s | 126.36s | 16.43s | 935.41s |
| TinyHypergraphPortPointPathingSolver | 2.43s | 5.63s | 2.47s | 3.79s | 2.37s | 44.80s | 6.86s | 25.81s | 3.77s | 4.98s | 30.60s | 40.82s | 21.92s | 4.60s | 200.87s |
| TraceSimplificationSolver | 6.30s | 39.52s | 1.77s | 3.69s | 5.45s | 23.89s | 6.52s | 12.16s | 5.53s | 7.39s | 7.44s | 32.81s | 6.60s | 4.48s | 163.56s |
| MultiSimplifiedPathSolver | 3.55s | 13.45s | 1.40s | 1.85s | 3.11s | 9.68s | 5.08s | 9.83s | 4.57s | 5.76s | 6.49s | 26.76s | 5.41s | 4.00s | 100.95s |
| MultiHeadPolyLineIntraNodeSolver3 | — | 1.21s | 181.88ms | 24.08s | 1.85ms | 7.76s | — | 10.55s | 340.81ms | 284.17ms | 333.80ms | 193.72ms | 23.35s | 814.17ms | 69.11s |
| UselessViaRemovalSolver | 1.45s | 15.12s | 210.61ms | 1.42s | 1.16s | 13.69s | 672.81ms | 1.28s | 633.28ms | 724.64ms | 692.50ms | 2.79s | 737.82ms | 264.58ms | 40.85s |
| SingleRouteUselessViaRemovalSolver | 1.18s | 14.24s | 126.33ms | 1.32s | 911.54ms | 13.35s | 276.76ms | 653.91ms | 358.51ms | 354.98ms | 335.76ms | 811.34ms | 478.06ms | 144.60ms | 34.53s |
| TraceWidthSolver | 319.90ms | 575.54ms | 159.46ms | 110.16ms | 256.42ms | 669.62ms | 674.51ms | 1.48s | 1.10s | 1.42s | 839.73ms | 7.61s | 535.61ms | 561.87ms | 16.31s |
| SingleSimplifiedPathSolver | 901.47ms | 3.24s | 210.12ms | 439.43ms | 891.85ms | 3.39s | 427.57ms | 486.29ms | 254.24ms | 273.80ms | 400.73ms | 1.22s | 457.82ms | 167.04ms | 12.75s |
| CrossingViaReductionSolver | 832.36ms | 8.84s | 17.03ms | 230.75ms | 678.75ms | 392.13ms | 74.48ms | 58.79ms | 43.74ms | 41.43ms | 58.48ms | 244.84ms | 70.71ms | 11.80ms | 11.59s |
| ViaPossibilitiesSolver2 | — | 568.92ms | 65.81ms | 206.08ms | 1.41ms | 1.08s | — | 153.05ms | 0.35ms | 132.95ms | 208.80ms | 112.10ms | 1.05s | 44.85ms | 3.63s |
| CapacityMeshEdgeSolver2_NodeTreeOptimization | 65.22ms | 71.64ms | 80.75ms | 42.06ms | 45.30ms | 783.01ms | 120.51ms | 103.21ms | 312.89ms | 73.36ms | 101.05ms | 452.50ms | 155.41ms | 127.48ms | 2.53s |
| PreprocessSimpleRouteJsonSolver | 55.79ms | 86.75ms | 34.50ms | 53.15ms | 48.76ms | 211.51ms | 77.73ms | 197.02ms | 104.33ms | 153.10ms | 158.33ms | 885.59ms | 111.64ms | 119.66ms | 2.30s |
| MultipleHighDensityRouteStitchSolver3 | 85.04ms | 237.90ms | 42.02ms | 64.75ms | 82.07ms | 128.78ms | 87.66ms | 123.37ms | 60.05ms | 88.46ms | 98.17ms | 266.49ms | 113.05ms | 54.67ms | 1.53s |
| AvailableSegmentPointSolver | 20.13ms | 38.84ms | 27.20ms | 17.17ms | 21.82ms | 143.41ms | 36.45ms | 46.65ms | 54.08ms | 43.41ms | 32.94ms | 103.14ms | 55.45ms | 50.67ms | 691.36ms |
| SingleHighDensityRouteStitchSolver3 | 26.23ms | 39.87ms | 15.90ms | 23.59ms | 18.54ms | 62.64ms | 22.88ms | 50.59ms | 24.13ms | 26.99ms | 32.74ms | 73.56ms | 43.02ms | 25.84ms | 486.50ms |
| NetToPointPairsSolver2_OffBoardConnection | 20.23ms | 27.41ms | 10.33ms | 6.50ms | 12.09ms | 28.65ms | 25.84ms | 37.01ms | 23.47ms | 31.02ms | 31.62ms | 78.87ms | 23.24ms | 27.55ms | 383.84ms |
| EscapeViaLocationSolver | 14.62ms | 17.22ms | 8.93ms | 7.40ms | 11.81ms | 29.93ms | 19.22ms | 24.97ms | 20.52ms | 20.98ms | 25.72ms | 66.64ms | 22.62ms | 22.61ms | 313.21ms |
| NodeDimensionSubdivisionSolver | 2.15ms | 3.44ms | 9.67ms | 4.75ms | 1.33ms | 77.75ms | 1.97ms | 15.42ms | 24.44ms | 8.64ms | 4.64ms | 24.71ms | 48.81ms | 13.70ms | 241.42ms |
| SameNetViaMergerSolver | 16.59ms | 38.93ms | 8.06ms | 9.99ms | 8.66ms | 31.11ms | 9.92ms | 26.60ms | 7.67ms | 11.25ms | 12.74ms | 34.21ms | 16.83ms | 7.28ms | 239.84ms |
| SingleLayerNoDifferentRootIntersectionsIntraNodeSolver | 5.47ms | 23.95ms | — | 1.85ms | — | — | 6.52ms | 2.98ms | — | 3.32ms | — | 18.37ms | 4.45ms | — | 66.92ms |
| Pipeline4HighDensityRepairSolver | 0.21ms | 0.07ms | 0.04ms | 0.06ms | 0.06ms | 0.12ms | 0.05ms | 0.07ms | 0.05ms | 0.05ms | 0.06ms | 0.20ms | 0.06ms | 0.07ms | 1.17ms |
