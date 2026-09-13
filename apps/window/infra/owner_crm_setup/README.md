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

The first command is the default and only plans missing fields or narrow
unique upgrades. The apply mode creates missing definitions or upgrades the
three source identity definitions after preflighting both native DocTypes and
every existing field. Existing definitions must have the deterministic name and
the same closed definition; incompatible definitions or duplicate matches fail
before any write. Redirects, non-loopback targets, malformed responses, unsafe
secret files, and missing credentials fail closed.

CRM Lead fields contain private research source/evidence references and an
explicit `review_required` default for owner eligibility review. They never
represent historic sendability or consent. Contact fields mirror Blockwise
profile/workspace identity, Stripe-authoritative subscription status,
Blockwise-authoritative access status, and the last accepted sync timestamp.
The adapter does not configure email, scheduler, billing, access, or outbound
delivery.

### Source identity uniqueness

The three source identity fields use native Frappe unique flag 1:

- CRM Lead.custom_blockwise_prospect_source_uuid
- Contact.custom_blockwise_profile_uuid
- Contact.custom_blockwise_workspace_uuid

They remain optional read-only Data fields. The native columns are nullable and
default to NULL, so a manual Contact can leave all Blockwise identity fields
unset. The preflight treats NULL and the native empty value as absent, and
checks every non-empty value against the UUID contract. It rejects malformed or
duplicate identities before any Custom Field write. It requests only the identity
column, paginates with a hard record bound, and never prints record values.

When an existing target field is exact except for unique 0, the plan contains
only upgrade_unique and the apply path sends only {"unique": 1} for that
Custom Field. Any other mismatch, including unique 1 on a non-source field,
fails closed. This is a narrow schema change, not a record edit, merge, delete,
or import. The database unique index remains the final concurrent-write guard;
take the normal native backup and run the read-only preflight before approving
--apply.

After the backup and review, verify native nullability and indexes from the
running backend container with:

~~~bash
docker exec owner-crm-backend-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site owner.crm.internal mariadb --skip-column-names -e "
SELECT table_name, column_name, is_nullable, column_default, column_type
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN (0x74616243524d204c656164, 0x746162436f6e74616374)
  AND column_name IN (
    0x637573746f6d5f626c6f636b776973655f70726f73706563745f736f757263655f75756964,
    0x637573746f6d5f626c6f636b776973655f70726f66696c655f75756964,
    0x637573746f6d5f626c6f636b776973655f776f726b73706163655f75756964
  )
ORDER BY table_name, column_name;
SELECT table_name, index_name, non_unique, column_name
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name IN (0x74616243524d204c656164, 0x746162436f6e74616374)
  AND column_name IN (
    0x637573746f6d5f626c6f636b776973655f70726f73706563745f736f757263655f75756964,
    0x637573746f6d5f626c6f636b776973655f70726f66696c655f75756964,
    0x637573746f6d5f626c6f636b776973655f776f726b73706163655f75756964
  )
ORDER BY table_name, index_name, seq_in_index;
"'
~~~

## Native sales-stage mapping

The live CRM defaults already cover the accepted owner pipeline, so this setup
does not create or rename status records:

| Owner stage | Native status | Native meaning |
| --- | --- | --- |
| new | CRM Lead Status 'New' | Open |
| qualifying | Lead review task while 'New'; CRM Deal Status 'Qualification' after conversion | Review before the native deal handoff |
| conversation | CRM Lead Status 'Contacted' | Ongoing |
| meeting/demo | CRM Deal Status 'Demo/Making' | Ongoing |
| decision | CRM Deal Status 'Negotiation' then 'Ready to Close' | Ongoing |
| won/lost | CRM Deal Status 'Won' or 'Lost' | Native terminal outcomes |

Conversion is native: CRM Lead.convert_to_deal sets the lead to 'Qualified',
marks it converted, and creates a CRM Deal. 'Qualified' and 'Converted' are
therefore preserved as native conversion outcomes, not repurposed as the
owner's qualifying stage. 'Unqualified' and 'Junk' remain the native lost lead
outcomes. 'Proposal/Quotation' is available as an existing optional
commercial substage. 'Nurture' means deferred follow-up, not proof of qualification;
'Contacted' does not prove a reply. Conversation evidence comes from the linked
mail thread or an operator note. No onboarding or billing statuses are added; Stripe and
Blockwise remain authoritative for those concerns.

## Native owner login

`python3 owner_user.py` previews/verifies the dedicated owner@blockwise.sale System User. `--apply` creates it without sending an invitation, with native Sales Manager, Agent Manager, Inbox User and Knowledge Base Editor roles. The generated password stays in root-private `/srv/frank/secrets/owner-crm-login.env`. Replay never resets the password or silently changes an existing identity. This is not MFA/device enrollment or proof of mobile reachability.
