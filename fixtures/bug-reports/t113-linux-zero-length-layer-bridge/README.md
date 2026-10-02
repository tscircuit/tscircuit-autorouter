# T113 zero-length layer bridge

This fixture is the `HDMI_TMDS_CLOCK_BRIDGE` Pipeline9 input from the T113-S3
Linux board. A regional reroute absorbs both sides of U4's feedback fanout but
leaves the zero-length inner-layer bridge between them, so reconstruction tries
to append a stale point after the replacement already spans the full trace.
