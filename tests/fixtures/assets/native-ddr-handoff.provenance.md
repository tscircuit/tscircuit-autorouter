# ButterStick and i.MX6 DDR handoffs

The two `*-native-ddr-handoff.srj.json.gz` fixtures come from rendering the DDR board TSX with `tscircuit@0.0.3259`, `@tscircuit/core@0.0.2437` and `@tscircuit/capacity-autorouter@0.0.1139`. [Board sources at 24dc44c](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/tree/24dc44c166d4258c3538f8b1f66953f1b6f58690/circuits)

`inputSrj` is the input Core passed to the autorouter after the two data-byte phases completed. `preloadedConnections` contains the connections from those two earlier phase inputs so the continuity check and SVG can account for every requested net.

| Board | SMT pads | Fixed PCB traces | Data-byte nets | Remaining nets |
| --- | ---: | ---: | ---: | ---: |
| ButterStick | 581 | 32 | 16 | 39 |
| i.MX6 | 401 | 17 | 16 | 37 |

## Earlier i.MX6 clearance regressions

The 498-component board used by the repair regression has 1,926 pad and hole obstacles. Its 17 fixed data-byte traces come directly from that checkpoint’s Circuit JSON. The force-improvement fixture retains the five incoming routes in cell `cmn_459` and the single 0.4 mm through via `checkpoint_via_23`. At this stage the router uses the via’s circular footprint. The unguarded force candidate reduces the copper gap from 0.0512 mm to 0.0040 mm. [Original clearance regression](https://github.com/tscircuit/tscircuit-autorouter/pull/3952)
