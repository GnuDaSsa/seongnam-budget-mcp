# Local workerd concurrency experiment

## Scope and limitations

Compared GitHub branch commit `8ebe2d1be6182801f0fcd9991f4a84a984f24beb` with a candidate limiting per-isolate expensive retrieval work. No deployment or production calls. Wrangler 4.158.0, workerd 2026-11-04, compatibility date 2026-11-07, macOS local file-backed static assets, same hash-verified corpus, localhost HTTP. Workerd started fresh for each run; three alternating runs per version. Eight different synthetic public-budget requests were issued concurrently, followed by a repeated batch. `workerd-trials-final.jsonl` contains per-request latency, citations, year/type/unit and evidence hashes.

The recorded memory is the maximum observed sum of two local workerd process RSS values sampled roughly every 75ms. It includes the local assets service and runtime, may miss peaks, and is not an isolate heap measurement. Local workerd did not enforce or reproduce the hosted 128MiB limit. This experiment cannot establish production memory safety, p95/p99, multi-isolate behavior, network latency, or a statistically significant speed difference. Three runs and eight hand-picked cases are not representative of all traffic.

## Observations

| Measure | Baseline median | Candidate median |
|---|---:|---:|
| First 8-query batch, elapsed | 1,293.14ms | 1,318.32ms |
| First batch, sampled two-process RSS peak | 612,608KiB | 457,472KiB |
| Repeat 8-query batch, elapsed | 21.80ms | 18.98ms |
| Errors over 3 first + repeat batches | 0 | 0 |

The three paired first batches produced 24/24 identical evidence hashes, and repeat batches another 24/24. A separate local Node adapter replay of 16 fixed presence/year/type checks passed 16/16 before and after with 16/16 matching evidence hashes; that set is small, partially snapshot-derived and does not measure precision or recall (`workerd-query-before.jsonl`, `workerd-query-after.jsonl`). One exploratory local trial of a 2-active gate and 1-active gate is retained separately; use the three final paired 1-active trials above for the main comparison.

The candidate admits one uncached search or evidence load at a time and up to 24 waiting operations per isolate, FIFO. Fully cached evidence bypasses the admission queue. Different kinds of requests (e.g. direct page reads) are not covered, and other isolates, platform/runtime allocations, uncancelled clients and upstream hangs are not bounded by it. The cap counts operations and queue entries, not bytes. Unit tests cover ordering, max concurrent work, queue overflow, permit release on failure and invalid limits; an integration test checks that a cached request does not wait behind a blocked cold query.

A separate fresh local Worker received 40 distinct year-filtered queries simultaneously: 26 completed, 14 returned the explicit retry-later MCP error, zero other errors and zero returned-year mismatches (`workerd-overload-final.jsonl`). This is intentional load shedding; it may cause callers to retry and is not proof that production cannot exhaust memory. Empty search is not evidence of absence.

## Reproduction on macOS

1. `npm ci && npm run snapshot:download` to restore manifest-verified assets. `npm run build` regenerates `snapshot/corpus/rank.bin.gz`; restore the verified download before a subsequent manifest check if its compressed hash differs. Copy `snapshot/semantic/tokens-*.gz` into ignored `dist/client/semantic/` for offline local tests.
2. Prepare an isolated prior-source directory: `mkdir -p work/baseline-src`, then `git archive 8ebe2d1 | tar -x -C work/baseline-src`. Supply the same verified ignored `snapshot/corpus`, semantic gzip files and dependencies in that directory, build it, and copy token gzip files into its `dist/client/semantic/`.
3. Install only into ignored work: `npm install --prefix work/worker-tools --no-save wrangler@4.158.0`. Run `node experiments/run-workerd-trials.mjs` with permission to bind loopback; it alternates baseline and current configs, launches only local Wrangler, samples both workerd process RSS via macOS `ps`, and stops each process. Set `BASE_CONFIG`, `GATED_CONFIG`, `WRANGLER_BIN`, or `WORKER_PORT` if needed. No credentials or Cloudflare deployment are required.
4. To rerun overload: `TRIALS=1 RUN_LABEL=gated PROBE_SCRIPT=experiments/workerd-overload.mjs node experiments/run-workerd-trials.mjs`. Run `npm run test:unit && npm test` for regression. Do not treat RSS as production isolate memory.
