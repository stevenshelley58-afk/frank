from pathlib import Path
import unittest


WEB = Path(__file__).resolve().parents[1] / "web"


class AdStudioPickerContractTest(unittest.TestCase):
    def test_source_picker_offers_device_and_vps_images(self):
        html = (WEB / "index.html").read_text(encoding="utf-8")
        studio = (WEB / "js" / "ad-studio.js").read_text(encoding="utf-8")
        app = (WEB / "js" / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="ad-source-dialog"', html)
        self.assertIn('id="ad-source-device"', html)
        self.assertIn('id="ad-source-vps-search"', html)
        self.assertIn('Choose from this device or the VPS', html)
        self.assertIn('fetch(`/api/tree?root=vps&path=', studio)
        self.assertIn('sources: selectedFiles.slice()', studio)
        self.assertIn('uploadVpsFiles(vpsFiles)', app)
        self.assertIn('fetch("/api/chat/uploads/vps"', app)
        self.assertIn('fetch("/api/ad-studio/runs"', app)
        self.assertIn('fetch(`/api/ad-studio/runs/${encodeURIComponent(ref.id)}`)', studio)
        run_handler = app.split('window.addEventListener("frank:ad-studio-run"', 1)[1].split(
            'window.addEventListener("frank:ad-studio-change-request"', 1
        )[0]
        self.assertNotIn("createChat(", run_handler)
        self.assertNotIn("enqueueTurn(", run_handler)


if __name__ == "__main__":
    unittest.main()
