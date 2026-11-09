# GitLab import validation — 2026-11-09

The initial government GitLab pre-receive scan rejected the import. The source was corrected without disabling or suppressing scanner rules:

- Parse HWPX XML with defusedxml and explicitly reject DTDs, entities, and external references.
- Remove the unused model2vec dependency; pin httpx2/httpcore2 to 2.16.0 and setuptools to 84.1.0.
- Store model source checksums as file/sha256 records rather than a filename-keyed dictionary. All checksum values are preserved. Remove an unused asset project identifier. The two reported generic API keys were non-secret metadata; no credentials were added.

Local validation after these changes:

- Build succeeded; 34 Node tests passed against the complete local corpus/assets.
- Five Python pipeline tests passed, including malicious XML rejection.
- pip-audit reported zero known vulnerabilities across 39 resolved Python packages (Python 3.13 resolution).
- A pure pyhwp extraction smoke test passed using setuptools 84.1.0 and the upstream `tests/hwp5_tests/fixtures/aligns.hwp` fixture. No Hancom COM was used.
- Independent source review verified unchanged checksum values and updated manifest consumers. A diagnostic using the upstream generic-api-key rule found no qualifying matches in the revised manifest; this does not replace the remote scanner.

Corpus files and model binaries remain excluded from Git. Full corpus tests require the assets described in the repository setup documentation; the GitLab CI job runs the source-only unit suite. Remote scan and CI outcomes must be checked separately from these local results.
