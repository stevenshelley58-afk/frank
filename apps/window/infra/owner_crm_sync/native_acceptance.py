"""Controlled native fixture. No email/charges; retains labelled fixture for inspection."""
import json
import uuid
from customer_sync import *

def main():
    c=load_sync_credentials()
    store=FrappeContactStore()
    store.authenticate(c.frappe_api_key,c.frappe_api_secret)
    workspace=str(uuid.uuid4()); profile=str(uuid.uuid4())
    row={"workspaceId":workspace,"owner":{"profileId":profile,"name":"CRM Acceptance Fixture", "email":"crm-acceptance@example.invalid"},
        "billingAccessState":"trialing", "stripeSubscriptionStatus":"trialing", "trial":{"state":"active", "startedAt":"2026-09-01T00:00:00Z", "endsAt":"2026-09-15T00:00:00Z"},
        "mappingAmbiguities":[], "sourceObservedAt":"2026-09-13T00:00:00Z"}
    snapshot=map_snapshot_row(row)
    assert apply_plan(store,snapshot)=="create"
    assert apply_plan(store,snapshot)=="unchanged"
    records=store.find_contact_by_identity(profile_uuid=profile,workspace_uuid=workspace)
    assert len(records)==1
    first=store.get_contact(records[0].name)
    assert first.values["email_ids"][0]["email_id"]=="crm-acceptance@example.invalid"
    row.update(stripeSubscriptionStatus="past_due", sourceObservedAt="2026-09-13T01:00:00Z")
    assert apply_plan(store,map_snapshot_row(row))=="update"
    try:
        store.update_contact(first.name,{"modified":first.values["modified"], "custom_blockwise_subscription_status":"BAD_STALE_VALUE"})
    except ConnectorError:
        pass
    else:
        raise AssertionError("native modified concurrency guard failed")
    assert apply_plan(store,snapshot)=="held_stale"
    conflict={**row,"workspaceId":str(uuid.uuid4())}
    assert apply_plan(store,map_snapshot_row(conflict))=="held_conflict"
    fresh=store.get_contact(first.name)
    assert fresh.values["custom_blockwise_subscription_status"]=="past_due"
    store.reconcile_hold(workspace,"held_conflict")
    store.reconcile_hold(workspace,"held_conflict")
    store.reconcile_hold(workspace,"unchanged")
    for path in ["/api/resource/User", "/api/resource/Email%20Account"]:
        try:
            store._request("GET",path)
        except ConnectorError:
            pass
        else:
            raise AssertionError("service identity has excess read permission")
    try:
        store._request("DELETE","/api/resource/Contact/"+urllib.parse.quote(first.name,safe=""))
    except ConnectorError:
        pass
    else:
        raise AssertionError("service identity unexpectedly permitted delete")
    print(json.dumps({"native_acceptance":"passed", "create_replay_update_stale_conflict":True,
        "native_concurrency":True,"native_exception_task":True,"permission_denials":True,
        "fixture_retained":True,"fixture_contact":first.name}))
    store.close()

if __name__=="__main__": main()
