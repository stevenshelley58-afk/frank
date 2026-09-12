# Owner CRM native field setup

This folder contains the declarative Custom Field contract for the isolated owner
Frappe CRM site. It uses only native Frappe REST resources, and does not create a
custom Frappe app or import Lead, Contact, billing, or research records.

The fixed target is the loopback endpoint `http://127.0.0.1:18081` with site
`owner.crm.internal`. The adapter reads the Administrator password at runtime
from `/srv/frank/secrets/owner-crm.env`; it keeps the authenticated session in
memory, logs out after setup, and never writes or prints a token.

From a committed release checkout, run:

```bash
python3 apps/window/infra/owner_crm_setup/setup_adapter.py
python3 apps/window/infra/owner_crm_setup/setup_adapter.py --apply
```

The first command is the default and only plans missing fields. `--apply`
creates missing definitions after preflighting both native DocTypes and every
existing field. Existing definitions must have the deterministic name and the
same closed definition; incompatible definitions or duplicate matches fail
before any write. Redirects, non-loopback targets, malformed responses, unsafe
secret files, and missing credentials fail closed.

CRM Lead fields contain private research source/evidence references and an
explicit `review_required` default for owner eligibility review. They never
represent historic sendability or consent. Contact fields mirror Blockwise
profile/workspace identity, Stripe-authoritative subscription status,
Blockwise-authoritative access status, and the last accepted sync timestamp.
The adapter does not configure email, scheduler, billing, access, or outbound
delivery.
