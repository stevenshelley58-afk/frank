import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location("owner_mail_setup",Path(__file__).with_name("setup.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class NativeMailTests(unittest.TestCase):
    def test_defaults_are_non_sending(self):
        p=module.payload("secret")
        for name in ["enable_incoming","enable_outgoing","default_incoming","default_outgoing","enable_auto_reply","create_contact","track_email_status"]:self.assertEqual(p[name],0)
    def test_tls_and_native_sent_folder(self):
        p=module.payload("secret",True)
        self.assertEqual((p["smtp_server"],p["smtp_port"],p["use_ssl_for_outgoing"]),("smtp.purelymail.com","465",1))
        self.assertEqual((p["email_server"],p["incoming_port"],p["use_ssl"]),("imap.purelymail.com","993",1))
        self.assertEqual((p["append_emails_to_sent_folder"],p["sent_folder_name"]),(1,"Sent"))
    def test_fixed_business_sender_separate_from_login(self):
        p=module.payload("secret",True)
        self.assertEqual(p["email_id"],"hello@blockwise.sale")
        self.assertEqual(p["login_id"],"blockwise@purelymail.com")
        self.assertEqual(p["no_smtp_authentication"],0)
if __name__=="__main__":unittest.main()
