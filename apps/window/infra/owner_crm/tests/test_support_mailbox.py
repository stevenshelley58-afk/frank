import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

path = Path(__file__).resolve().parents[2] / "owner_marketing/support_mailbox.py"
spec = importlib.util.spec_from_file_location("support_mailbox", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SupportMailboxTests(unittest.TestCase):
    def test_existing_is_readonly_and_never_created(self):
        client = Mock(); client.select.return_value = ("OK", [])
        self.assertEqual(module.ensure_folder(client, True), "unchanged")
        client.select.assert_called_once_with('"Support"', readonly=True)
        client.create.assert_not_called(); client.fetch.assert_not_called()
    def test_missing_preview_does_not_create(self):
        client = Mock(); client.select.return_value = ("NO", [])
        with self.assertRaisesRegex(RuntimeError, "routing_folder_missing"): module.ensure_folder(client)
        client.create.assert_not_called()
    def test_creation_requires_real_readback(self):
        client = Mock(); client.select.side_effect = [("NO", []), ("OK", [])]; client.create.return_value = ("OK", [])
        self.assertEqual(module.ensure_folder(client, True), "created")
        client.create.assert_called_once_with('"Support"')
    def test_false_creation_fails_closed(self):
        client = Mock(); client.select.return_value = ("NO", []); client.create.return_value = ("OK", [])
        with self.assertRaisesRegex(RuntimeError, "routing_folder_readback_failed"): module.ensure_folder(client, True)

    def test_notifications_folder_uses_exact_native_name(self):
        client = Mock(); client.select.return_value = ("OK", [])
        self.assertEqual(module.ensure_folder(client, False, "Notifications"), "unchanged")
        client.select.assert_called_once_with('"Notifications"', readonly=True)
    def test_unknown_folder_is_rejected_before_imap(self):
        client = Mock()
        with self.assertRaisesRegex(RuntimeError, "unsupported_folder"): module.ensure_folder(client, True, "Other")
        client.select.assert_not_called(); client.create.assert_not_called()

if __name__ == "__main__": unittest.main()
