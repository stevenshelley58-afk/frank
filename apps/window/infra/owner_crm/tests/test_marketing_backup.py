import pathlib
import unittest

ROOT = pathlib.Path(__file__).parents[1]
BACKUP = (ROOT / "bin/marketing-backup.sh").read_text()
RESTORE = (ROOT / "bin/marketing-restore-drill.sh").read_text()

class MarketingBackupTest(unittest.TestCase):
    def test_backup_uses_native_engines_and_explicit_artifacts(self):
        for value in ("mysqldump", "--single-transaction", ".backup /backup/$name", "frank_owner_marketing_config", "frank_owner_marketing_media", "private-config.tar.gz", '"off_host":false'):
            self.assertIn(value, BACKUP)
        self.assertNotIn("frank_owner_notifications_cache.tar.gz", BACKUP)
        self.assertNotIn("restic ", BACKUP)

    def test_restore_is_disposable_and_compares_all_state(self):
        for value in ("--network none", "--tmpfs /var/lib/mysql", "CREATE DATABASE IF NOT EXISTS mautic", "Mautic table counts differ", "Mautic config hashes differ", "Mautic media hashes differ", "private runtime config hashes differ", "ntfy table counts differ", "PRAGMA integrity_check", "production_db_changed:false"):
            self.assertIn(value, RESTORE)
        self.assertNotIn("docker exec -i frank-owner-marketing-db", RESTORE)

if __name__ == "__main__":
    unittest.main()
