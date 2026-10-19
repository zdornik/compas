# Broader medication coverage · 19 October 2026

The full GRLS metadata catalog is already imported: 126,861 historical/current
records and 3,745 INN/group/composition names. The physician library previously
defaulted to the psychiatry collection. It now opens the full catalog; the explicit
“Только психиатрия” filter remains available. Current source statuses are the
default, with history selectable separately. Library totals describe the whole
corpus instead of presenting 136 selected psychiatry names as the total coverage.

The shared patient/doctor/onboarding ProductPicker accepts trade names and INNs,
including official English/Latin labels. An exact INN ranks before partial or
combination matches, including when other records have no English label. Selecting
an INN opens its own GRLS trade names/registrations; the final choice retains the
specific product ID. Choosing a substance alone never silently chooses a brand or
creates a treatment scheme. The input now explicitly says “Препарат или действующее
вещество”. An unrelated null-intake crash discovered while checking an empty local
research profile was also fixed.

## Additional official instructions

`scripts/knowledge/chronic-groups.json` describes an inspectable collection, based
on the literal GRLS pharmacotherapeutic-group field. The first breadth pass covers
465 full INNs/compositions, selected from 4,448 eligible current registrations.
It includes lipid-lowering and antigout groups, blood-pressure/heart medicines,
diabetes, antithrombotics, thyroid, obstructive airway disease, acid-related
conditions, immunosuppression, glaucoma, bone and urological groups. The first
explicit examples are allopurinol and statins. This is collection/search scope,
not a clinical formulary or approved-indication assignment.

The preparer preserves full combination names, excludes pharmaceutical substances,
checks source statuses and expiry/annulment dates, and selects one newest eligible
registration per full INN for this first pass. The psychiatry target file is not
overwritten. PDFs remain linked only to their own registration; one downloaded
brand never supplies another registration's instruction automatically. Original
bytes, URLs and hashes use the existing archive/import pipeline.

465 is a download target count, not completed downloads or newly approved DDI
identities. Downloads run with two workers, persisted per-registration results,
an independent chronic manifest and resumable caches. HTTP timeouts and unavailable
originals remain explicit errors/gaps. At verification, the priority allopurinol,
atorvastatin, rosuvastatin, simvastatin and pitavastatin PDFs were downloaded and
imported successfully; the remaining queue was still running.

Migration 014 stores 1,056 source-backed search-alias relations. Exact whole phrases
such as “статины”, “мочегонные”, “антикоагулянты” and “ИПП” expand public search only.
Specific aliases use their own source class (e.g. antacids are not PPI aliases).
No similarity-based medical matching, provider-ID creation or automatic diagnosis
is performed. Source evidence and the registry/configuration hashes are retained.

Migration 015 publishes PDF availability and ready counts without rewriting naming
dictionaries. Source dictionary imports still use the full atomic catalog rebuild.
The runtime cannot execute either refresh function or change source tables.

## Reproduce / resume

```sh
python3 scripts/knowledge/prepare-chronic.py --apply
docker compose run --rm --no-deps migrate
docker compose run --rm --no-deps knowledge-import node server/import-chronic-collection.mjs
docker compose up -d --no-build knowledge-chronic-download knowledge-chronic-import
```

The download service has no DB credentials; only the separate offline importer
writes the shared knowledge schema. The instruction-only importer does not reimport
GRLS or reset existing naming/identity decisions. The separate public demo remains
unchanged. Rerunning the downloader reuses successful registration/file caches;
failed requests remain retryable. Neither the metadata catalog nor every DDI name
requires a downloaded PDF.

Validation: build and 103 JavaScript tests; six Python selection tests; live public
API checks for seven common chronic INNs, their exact-first autocomplete, group
search (202 current statin-related records, including source combinations), source
identities and priority PDFs. A source-only transaction verifies ready counts on
both addition/removal of a PDF link, unchanged naming-table row fingerprints,
runtime read-only grants and complete rollback of synthetic rows. No actual patient
treatment was created or altered. The isolated browser walkthrough confirmed the
exact-INN → trade-registration → selected-product flow without saving a treatment.
While background import was active, median HTTP times were 14.6 ms for rosuvastatin
search, 20.3 ms for the statin group and 5.4 ms for INN autocomplete (five samples
after one warmup each).

```sh
python3 tests/test_chronic_scope.py
node scripts/check-chronic-reference.mjs
docker compose run --rm --no-deps knowledge-import node server/check-instruction-publication.mjs
```

Benchmarks from the preceding optimization are in REFERENCE-PERFORMANCE.md. Their
strict baseline replay is for the same source snapshot; a live growing corpus can
legitimately change instruction counts and ready-first ordering.
