# OSS catalog decision

Reviewed: 2026-08-30. This is a research record, not an installation approval.

## Decision

Frank will keep its versioned YAML/JSON declarations and receipt files as the
catalog authority. The smallest safe adapter borrows Backstage's Git-owned
metadata and ownership vocabulary, OpenMetadata's typed provenance/lineage
ideas, and Archify's stable typed projection boundary. It does not deploy a
portal, database, Neo4j, or collector. Every record carries a stable ID, source
locator and revision, owner, lifecycle, evidence receipts, freshness and
removal path. Unknown observations remain `unknown`.

| Candidate | Exact reviewed source | Licence | Signals and fit | Decision |
|---|---|---|---|---|
| Backstage catalog | https://github.com/backstage/backstage/tree/d5731882a9a45a6dea41df40ce9c25dafc2b4859/docs/features/software-catalog; https://github.com/backstage/backstage/blob/d5731882a9a45a6dea41df40ce9c25dafc2b4859/LICENSE | Apache-2.0 | Git metadata, ownership, relationships and extensibility are a strong vocabulary; full portal/backend is a large operational overlap. | adapt schema concepts only |
| NetBox | https://github.com/netbox-community/netbox/tree/dcc6afcf3014ed295a06c35717f09563d2b0aa59; https://github.com/netbox-community/netbox/blob/dcc6afcf3014ed295a06c35717f09563d2b0aa59/LICENSE.txt | Apache-2.0 | Mature infrastructure/DCIM relationship model, but its network/device/IP and database assumptions exceed one VPS and duplicate source authority. | reject deployment; study relationship conventions |
| OpenMetadata Standards | https://github.com/open-metadata/OpenMetadataStandards/tree/17f0244916e9ae111b54f8b1b1e02e76cfc6b374; https://github.com/open-metadata/OpenMetadataStandards/blob/17f0244916e9ae111b54f8b1b1e02e76cfc6b374/LICENSE | Apache-2.0 | Useful JSON schemas, entity relationships, lineage and provenance patterns; full metadata platform is out of scope. | adapt typed provenance |
| Cartography | https://github.com/cartography-cncf/cartography/tree/030848289203969e19a17bf25e45ff94a527bcef; https://github.com/cartography-cncf/cartography/blob/030848289203969e19a17bf25e45ff94a527bcef/LICENSE | Apache-2.0 | Collector patterns are relevant for future read-only inventory; required Neo4j graph and cloud collectors create a competing graph authority now. | reject initial deployment |

The exact source revisions, release/activity metadata, dependency evidence,
Scorecard results and bounded OSV applicability notes are recorded in
`decisions/oss/catalog-model.yaml`. The canonical accepted baseline proves that
no second catalog is needed for Step 1.

## Minimal Frank adapter

Own only a parser/validator, stable-ID normalizer, source/evidence pointer
resolver, and Archify projection serializer. It reads regular files beneath
`governance/control-plane`, rejects symlink escapes and arbitrary commands, and
emits immutable receipts. It never copies upstream UIs, mutates declarations,
or infers runtime health. Cost target is <10 MB resident and <1 CPU-second per
catalog read on the VPS; no persistent service or new database.

## Removal and security

Disable the catalog feature flag, preserve receipts, and repoint consumers to
the previous passing manifest. Remove the adapter only after references are
zero and the replacement manifest validates. Security unknowns are dependency
transitives and future parser behavior; implementation must run OSV-Scanner,
Scorecard checks and path-containment fixtures before enablement.

Sources and limitations are recorded in the machine-validated
`decisions/oss/catalog-model.yaml` receipt. Evidence is research input, not
installation or enablement approval.
