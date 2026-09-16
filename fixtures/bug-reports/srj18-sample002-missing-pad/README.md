# SRJ18 sample002 missing plated-slot obstacle

Pipeline 9 solves SRJ18 sample002 with 244 traces and relaxed DRC passes, but
the trace for `source_trace_54` appears to end in empty space near the lower
left of the board.

The endpoint is `pcb_port_157` at `(-39.2404, -18.2722)`. The source Circuit
JSON contains `pcb_plated_hole_58` at that coordinate with shape
`pill_hole_with_rect_pad` and a 2 mm by 4.5 mm rectangular pad. The generated
Simple Route JSON keeps the connection point but contains no obstacle for that
plated hole, so the final trace is geometrically correct relative to the SRJ
while the pad is absent from the routed-output visualization.

`srj18-sample002-state.svg` is the exact final routed output rendered with
`convertSrjToGraphicsObject` and a white background. It intentionally captures
the missing-pad baseline so the stacked fix can update the same artifact path.

Input SRJ SHA-256:
`2e2f6e8619e884afde2102e987cffcda8e7197ef2c63f8358aa5dd7cb14c8101`

Output SRJ SHA-256:
`e70d8247ccf8838906a782227bc401ef38d82e01bdf219df8b185a3b6470a66e`
