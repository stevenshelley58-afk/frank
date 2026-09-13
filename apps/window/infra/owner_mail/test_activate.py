import copy
import unittest
from activate import validate

class ActivationTests(unittest.TestCase):
    def setUp(self):
        self.state={"accounts":[{"name":"Blockwise Owner Inbox","email_id":"hello@blockwise.sale","enable_incoming":1,"enable_outgoing":1}],"pending_queue":0,"failed_queue":0,"enabled_email_notifications":0,"enabled_email_reports":0}
    def test_empty_native_queue_and_expected_mailbox(self):
        validate(self.state)
    def test_each_automatic_sender_blocks(self):
        for key in ["pending_queue","enabled_email_notifications","enabled_email_reports"]:
            state=copy.deepcopy(self.state);state[key]=1
            with self.assertRaises(RuntimeError):validate(state)
    def test_retained_error_is_not_dispatchable_queue_work(self):
        state=copy.deepcopy(self.state);state["failed_queue"]=1
        validate(state)
    def test_unknown_mailbox_blocks(self):
        self.state["accounts"].append({"name":"Other","enable_incoming":0,"enable_outgoing":1})
        with self.assertRaises(RuntimeError):validate(self.state)
    def test_disabled_mailbox_blocks(self):
        self.state["accounts"][0]["enable_incoming"]=0
        with self.assertRaises(RuntimeError):validate(self.state)
    def test_wrong_address_blocks(self):
        self.state["accounts"][0]["email_id"]="other@example.com"
        with self.assertRaises(RuntimeError):validate(self.state)

if __name__ == "__main__":unittest.main()
