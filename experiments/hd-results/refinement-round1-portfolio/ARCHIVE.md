# Complete renderer archive

This compact publication keeps the readable result tables, source/outcome summaries, verification and every arm/board's core measurements beside this file. The archive preserves **all eleven original renderer files byte-for-byte**, including the full arm context, paired rows, counter parity, phase tables and JSON cohorts. No measured value was recomputed for this view.

From this directory, run:

```sh
python3 decode_report_archive.py report-data
```

The destination must not already exist. The standalone Python3 decoder uses only the standard library. It verifies the base64 bytes, decoded tar.gz SHA256 and size, exact eleven-member file list, every member SHA256/size and every CSV row count before publishing the new directory. It rejects unexpected paths or member types. Read the extracted original `report-data/results.md` for the unchanged full-link version.

The [archive manifest](archive-manifest.json) records all hashes, sizes, member row counts and compact-column mappings. Original numeric CSV strings are retained exactly; unknown values remain unknown. `pipelineFinalIterations` stays unmeasured where blank, and no progress counter replaces it. The compact CSV omits bulky context/diagnostic columns only from the readable view; the untouched full `arm-samples.csv` remains in the archive.

The report archive is distinct from the original measurement artifact ZIP. The latter contains the raw run records, frozen protocol and captured inputs; its original run/artifact links, digest, size and recorded expiry are in [publication provenance](publication-provenance.json). The original measurement's packaging limitations remain explicit in [report verification](report-verification.json).
