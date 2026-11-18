Captured from the unchanged native A13 TSX board in [core-ddr-benchmark](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/tree/24dc44c166d4258c3538f8b1f66953f1b6f58690), using published tscircuit 0.0.3209 / Core 0.0.2400 / autorouter 0.0.1117 / bus-lanes-solver 0.0.60.

The request contains all 64 remaining connections after the four data phases. The 32 completed data paths are fixed obstacles, exactly as Core supplies them. Native pads, placement, four layers and physical rules are unchanged. Board coordinates are millimetres, +X right and +Y up.

[Published ten-board comparison](https://github.com/tscircuit/core/actions/runs/44050671541) and [captured-stage profile](https://github.com/tscircuit/core/actions/runs/44054665228). The five-minute native Core run times out during remaining routing; this uncapped solver repro finishes and records its actual remaining DRC findings. It does not claim timing or impedance qualification.
