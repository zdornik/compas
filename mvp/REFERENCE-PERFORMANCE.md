# Shared PostgreSQL reference catalog · 19 October 2026

All runtime reference data already resides in the same PostgreSQL 17 database:
GRLS products, original documents/pages, EAEU/NSI names, ESKLP registrations and
provider interactions. Excel/CSV/JSON archives are offline import inputs, not web
request dependencies. Patient records retain their encrypted storage, ownership
checks and RLS boundaries in that database.

Migration 013 adds public derived tables `catalog_products`, `catalog_substances`,
`catalog_terms` and `catalog_state`. They keep the original GRLS IDs, precompute
registration normalization, source-language search terms and picker counts, and
serve search with FTS, literal ILIKE indexes and ordered browse indexes. Page and
total come from one SQL statement/snapshot. Empty browsing and source statistics
use import-time totals instead of repeatedly counting large source relations.
The [PostgreSQL pg_trgm indexes](https://www.postgresql.org/docs/17/pgtrgm.html)
support literal LIKE/ILIKE queries here; similarity is never used to approve a
medical identity.

Medical identity resolution, complete-component validation, blocked source
conflicts and provider-pair lookup still read authoritative tables. No PDF is
required for an already verified ingredient identity. Missing pairs/instructions
still do not establish safety (`safeToCombine=null`). No personal-data cache or
browser persistence was introduced.

## Measurements

Same local Docker service, same data and API responses; HTTP wall time, five
samples after one warmup per case, not a production capacity assessment.

| Public read | Before median, ms | After median, ms |
| --- | ---: | ---: |
| Source status/counts | 357.4 | 6.2 |
| Russian product search | 495.5 | 4.9 |
| English product search | 492.6 | 8.4 |
| Latin INN autocomplete | 797.8 | 2.9 |
| Trade-name autocomplete | 315.2 | 2.2 |
| Full KLP code | 830.4 | 5.4 |
| Product card, unchanged lookup | 6.3 | 8.9 |
| Interactions, unchanged lookup | 28.7 | 18.5 |

All eight response objects and 18 additional search/browse/pagination responses
matched the previous API, including ordering, counts and medical mapping gaps.
`EXPLAIN (ANALYZE, BUFFERS)` confirms index-backed lookup and removal of repeated
NSI unnest joins/counts from the request path. Bounded smoke load: 32 public reads,
8 concurrent workers, median 19.3 ms, p95 55.1 ms, max 65.8 ms, zero errors; every
response matched the baseline. Rate limits remained enabled. Tests read no patient
records. Build and 102 automated tests pass.

## Publication and operation

Source importers acquire the shared advisory write lock. One-shot dictionary
imports publish their source changes and derived catalog in one transaction;
document downloads publish instruction links/product availability in a batch.
Readers keep seeing the prior complete catalog until commit. Per-document layout
imports only refresh status totals after a changed batch. Unchanged polling does
not rebuild the catalog. Runtime has SELECT only; refresh functions are revoked
from PUBLIC. The downloader has no database credential.

The integration check inserts synthetic public reference rows in a transaction,
rebuilds the catalog, proves a separate reader still sees the previous generation,
then rolls everything back and checks the original source/state remained intact.
The initial migration populates the catalog before web startup; missing publication
returns unavailable, not a successful empty catalog.

Offline maintenance after deliberate administrator changes:

```sh
docker compose run --rm --no-deps knowledge-import node server/rebuild-reference-catalog.mjs
```

Reproducible public checks (raw evidence stays in ignored `qa/`):

```sh
node scripts/benchmark-reference.mjs --label=before
node scripts/check-reference-parity.mjs --capture
# Apply migrations, build and restart the local web service.
node scripts/benchmark-reference.mjs --label=after
node scripts/check-reference-parity.mjs
node scripts/benchmark-reference-concurrency.mjs
docker compose run --rm --no-deps -v ./qa:/app/qa:ro knowledge-import node server/check-reference-catalog.mjs
docker compose run --rm --no-deps -v ./qa:/app/qa knowledge-import node server/profile-reference.mjs --after
```

Space these checks across rate-limit windows. Refresh cost and index storage are
paid on import, outside interactive requests. Web pool remains bounded at eight
connections. A production deployment can use this same schema on managed
PostgreSQL; backups/restore, deployment sizing, monitoring, identity verification
and clinical/legal validation still require their own work. The separate Internet
demo was not modified.
