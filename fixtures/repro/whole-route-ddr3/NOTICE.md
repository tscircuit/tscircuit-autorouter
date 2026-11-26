# DDR3 benchmark fixture sources

The controller and DRAM ball mappings come from the boards in [Table I of the paper](https://arxiv.org/pdf/2610.35601#page=8) and [KiCadRoutingTools revision 2e319092](https://github.com/drandyhaas/KiCadRoutingTools/tree/2e319092d1ae645f12d1c601f8d4a049ca7885cd/awx). The design sources' license text is included alongside the data.

- Allwinner H3 K51 uses the [Allwinner H3 reference](https://github.com/hvwyl/allwinner-h3-ddr3-16x1-kicad) as prepared in `fb_t2q_pairs.kicad_pcb`. The 51-net set contains 15 DQ signals. Pipeline 9 routes the two terminated clock nets before the byte phases. The capture represents the fixed copper of nonbenchmark nets as keepouts.
- Zynq-7020 CLG400 full45 uses the [ZYNQ7020_AD9364_V2 reference](https://github.com/kangyuzhe666/ZYNQ7010-7020_AD9363) as packaged in KiCadRoutingTools. It crops and rotates the two outer layers around the 45 graded DDR3 nets in section VII-D.

## Replay

The `*.byte-phases.json.gz` files store the two `bus_lanes` phase inputs from tscircuit 0.0.3237. They follow the staged data-byte routing used by the [native H3 repro](https://github.com/tscircuit/tscircuit-autorouter/blob/main/tests/repro/h3-ddr-bank-address/board.tsx). Each byte permits top and bottom routing. The first H3 phase input also contains the two already routed clock nets. The two DQS pairs in the remaining phase use a 0.10 mm gap and a 0.50 mm skew target for this replay.

The `*.handoff.json.gz` files pass the emitted byte traces to Pipeline 9 as preloaded copper alongside the original pad obstacles. This preserves the actual wires and vias produced by the byte phases. The root snapshot tests run Pipeline 9 from this handoff.

Run these commands from this fixture directory to replay the byte phases and compare their copper to the handoff.

```sh
bun install
bun run replay-buses allwinner-h3-k51
bun run replay-buses zynq-clg400-full45
```
