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

The stacked fix pins the corrected dataset fixture from
`tscircuit/dataset-srj18#19`. Its regenerated obstacle is a 2 mm by 4.5 mm
rectangle on both copper layers, centered at the J4 pin 1 routing endpoint.

`srj18-sample002-state.svg` is the corrected final routed output rendered with
`convertSrjToGraphicsObject` and a white background. Pipeline 9 still emits 244
traces, and every final trace endpoint matches its expected port.

Input SRJ SHA-256:
`1f023bb6fe96a791160f98c845011b802db0857a4b4023407b19a4b2a830ca53`

Output SRJ SHA-256:
`a24cfb513b6ae90374c4ffe830f95fbe5b69208a5d969830ca3129ff7b2e531c`
