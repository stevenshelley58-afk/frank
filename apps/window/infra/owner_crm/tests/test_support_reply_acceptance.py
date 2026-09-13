import importlib.util,json,sys,tempfile,unittest
from email.message import EmailMessage
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).parent;sys.path.insert(0,str(ROOT.parent.parent/'owner_crm_setup'))
s=importlib.util.spec_from_file_location('support',ROOT.parent/'bin'/'support-reply-acceptance.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_fixed_scope(self):
  self.assertEqual((m.TICKET,m.PARENT,m.RECIPIENT,m.OWNER_USER),('0003','9lvbn08rlv','blockwise@purelymail.com','owner@blockwise.sale'))
 def test_native_method_loads_real_doc(self):
  class A:
   def _request(self,*args,**kwargs):self.args=args;self.kwargs=kwargs;return {}
  api=A();m.send_native(api,'00000000-0000-4000-8000-000000000001')
  self.assertEqual(api.args,('POST','/api/method/run_doc_method'));self.assertEqual(api.kwargs['body']['dt'],'HD Ticket');self.assertEqual(api.kwargs['body']['dn'],m.TICKET)
  sent=json.loads(api.kwargs['body']['args']);self.assertEqual(sent['to'],m.RECIPIENT);self.assertEqual(sent['attachments'],[]);self.assertIsNone(sent['cc']);self.assertIsNone(sent['bcc'])
 def mail(self,marker,sender='Owner <owner@blockwise.sale>',recipient=None,reply='parent@example.test'):
  message=EmailMessage();message['Subject']=m.OUTBOUND_SUBJECT;message['From']=sender;message['To']=recipient or m.RECIPIENT;message['In-Reply-To']=f'<{reply}>';message['Message-ID']='<outbound@example.test>';message.set_content(m.message_for(marker));return message.as_bytes()
 def test_mail_parses_exact_headers(self):
  marker='00000000-0000-4000-8000-000000000001';proof=m.inspect_mail(self.mail(marker),marker,'parent@example.test');self.assertEqual(proof['from'],'owner@blockwise.sale');self.assertEqual(proof['in_reply_to'],'parent@example.test')
 def test_mail_rejects_substring_wrong_recipient_and_thread(self):
  marker='00000000-0000-4000-8000-000000000001'
  self.assertIsNone(m.inspect_mail(self.mail(marker,sender='attacker@example.test owner@blockwise.sale'),marker,'parent@example.test'))
  self.assertIsNone(m.inspect_mail(self.mail(marker,recipient='other@purelymail.com'),marker,'parent@example.test'))
  self.assertIsNone(m.inspect_mail(self.mail(marker,reply='wrong@example.test'),marker,'parent@example.test'))
 def test_acceptance_requires_sent_queue_and_imap(self):
  marker='00000000-0000-4000-8000-000000000001'
  with tempfile.TemporaryDirectory() as directory,patch.object(m,'RECEIPT',Path(directory)/'receipt.json'):
   receipt={**m.receipt_base(marker,'accepted'),'parent_message_id':'parent','communication':'comm','queue':'queue','queue_status':'Not Sent','imap':{'from':'owner@blockwise.sale','to':m.RECIPIENT,'subject':m.OUTBOUND_SUBJECT,'in_reply_to':'parent','message_id':'outbound'}}
   m.RECEIPT.write_text(json.dumps(receipt));m.RECEIPT.chmod(0o600)
   with self.assertRaisesRegex(RuntimeError,'unsafe_existing_receipt'):m.read_receipt()
   receipt['queue_status']='Sent';m.RECEIPT.write_text(json.dumps(receipt));m.RECEIPT.chmod(0o600);self.assertEqual(m.read_receipt()['state'],'accepted')
 def test_queue_sender_parses_native_display_name(self):
  row={'name':'queue','status':'Sent','communication':'comm','reference_doctype':'HD Ticket','reference_name':m.TICKET,'sender':'Blockwise Owner Inbox <hello@blockwise.sale>'}
  with patch.object(m,'list_rows',return_value=[row]):self.assertEqual(m.queue_status(object(),'comm')['status'],'Sent')
 def test_resume_without_communication_never_sends(self):
  receipt=m.receipt_base('00000000-0000-4000-8000-000000000001','prepared')
  with patch.object(m,'find_communication',return_value=None),patch.object(m,'write_receipt') as write,patch.object(m,'send_native') as send:
   with self.assertRaisesRegex(RuntimeError,'no_resend'):m.reconcile(object(),object(),receipt,'parent@example.test',30)
   send.assert_not_called();self.assertEqual(write.call_args.args[0]['state'],'uncertain')
if __name__=='__main__':unittest.main()
