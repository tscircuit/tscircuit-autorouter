# T113-S3 supervisor boundary-clearance failure

This fixture contains the complete Circuit JSON emitted by the failed
41-component T113-S3 Linux board and the complete SimpleRouteJson input passed
to Pipeline 9 after its three fanout solvers completed. The Circuit JSON keeps
all 41 source and PCB components and all 222 PCB ports. The routing input keeps
all 222 physical obstacles, 72 connection endpoints, and 40 automatic fanout
traces. No component, obstacle, connection, route, or via was reduced or
manually replaced for this regression.

The source circuit contains the 129-pad Allwinner T113-S3, 28 SoC passives and
its crystal, a TLV76718 regulator with four passives, and a TPS3808 supervisor
with four passives. The failing batch adds the supervisor and its four passives
to the preceding 36-component circuit. The fixture was recorded before global
routing, so every existing trace is native fanout-solver output.

Pipeline 9 fails while routing the 1.8 V pair from U1.VCC_PLL (`pcb_port_19`)
to U1.VCC_RTC (`pcb_port_25`). The global topology assigns a boundary point
0.1898934041 mm from the adjacent DXIN pad. B01 requires 0.2 mm at that point
for a 0.1 mm trace and its 0.15 mm obstacle-clearance margin, so its own detailed
clearance test rejects the assigned endpoint.

The test renders the captured Circuit JSON directly with
`convertCircuitJsonToPcbSvg`. Its committed PCB SVG is therefore the real failed
board with its original component and pad geometry and no custom annotations,
crops, or replacement graphics. The stacked fix renders the same circuit after
adding only the 94 traces produced by Pipeline 9, so the SVG diff shows the
actual board changing from unrouted to routed.

The routing fixture is normalized JSON: properties whose captured JavaScript
value was `undefined` are omitted. This preserves the runtime SimpleRouteJson
object while making the regression independent of the solver-debug serializer.

Provenance from the original immutable checkpoint:

- Circuit JSON SHA-256: `448050914e9bc06aa991e912e7b913590b38849e228474572d463c2ffc1198ca`
- Compressed Circuit JSON SHA-256: `75ecc3fabd22596e326e00dcf3c47747b04392b430ddb899535c7edc13d76d61`
- TSX SHA-256: `ea95d15caa8b15b1c2fb2badd2b22a0c10d2c3e626dc81e56c1253fcc48a8950`
- Normalized SRJ SHA-256: `39b2cea4cb806939bab67a1fac9bfcef020e054cc15c18d13da144bf24a8ed7f`
- Compressed SRJ SHA-256: `48c2e93083ecd1a21742a188f27be6056a4d41e13ef72fc756db2b8680240280`

Run the exact reproduction with:

```sh
bun test tests/bugs/t113-linux-supervisor-boundary-clearance.test.ts --timeout 9999999
```
