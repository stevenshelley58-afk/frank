"""Expose owner context using native CRM Fields Layout, preserving other sections."""
import argparse,json
from urllib.parse import quote
from setup_adapter import FrappeRestClient,load_credentials
SECTIONS={
'Contact': [
 {'label':'Blockwise subscription','name':'blockwise_subscription','opened':True,'columns':[{'name':'blockwise_subscription_column','fields':['custom_blockwise_access_status','custom_blockwise_subscription_status','custom_blockwise_trial_state','custom_blockwise_trial_started_at','custom_blockwise_trial_ends_at','custom_blockwise_sync_state','custom_blockwise_last_synced_at']}]},
 {'label':'Source identifiers','name':'blockwise_source_ids','opened':False,'columns':[{'name':'blockwise_source_ids_column','fields':['custom_blockwise_profile_uuid','custom_blockwise_workspace_uuid','custom_blockwise_source_observed_at']}]}],
'CRM Lead': [{'label':'Outreach eligibility','name':'blockwise_outreach','opened':True,'columns':[{'name':'blockwise_outreach_column','fields':['custom_blockwise_eligibility','custom_blockwise_prospect_source_uuid','custom_blockwise_evidence_refs']}]}]}
def reconcile(current,desired):
    if not isinstance(current,list) or not all(isinstance(x,dict) for x in current): raise RuntimeError('Unexpected native layout')
    owned={x['name'] for x in desired}
    if len([x for x in current if x.get('name') in owned]) != len({x['name'] for x in current if x.get('name') in owned}): raise RuntimeError('Duplicate owner section')
    return [x for x in current if x.get('name') not in owned]+desired

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    user,password=load_credentials();api=FrappeRestClient();api.login(user,password)
    try:
        for dt,sections in SECTIONS.items():
            path='/api/resource/CRM%20Fields%20Layout/'+quote(dt+'-Side Panel',safe='')
            doc=api._request('GET',path)['data'];current=json.loads(doc['layout']);desired=reconcile(current,sections)
            # Native read-only metadata remains the authority; no HTML/CSS overlay.
            for section in sections:
                for field in section['columns'][0]['fields']:
                    meta=api._request('GET','/api/resource/Custom%20Field/'+quote(dt+'-'+field,safe=''))['data']
                    if not meta.get('read_only'): raise RuntimeError('Owner source field must be read-only')
            if current != desired and args.apply: api._request('PUT',path,body={'layout':json.dumps(desired),'modified':doc['modified']})
            print(json.dumps({'doctype':dt,'action':'unchanged' if current==desired else ('updated' if args.apply else 'would_update'),'native_layout':True}))
    finally:api.logout();api.close()
if __name__=='__main__':main()
