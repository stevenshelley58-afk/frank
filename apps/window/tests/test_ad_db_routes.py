import unittest
from unittest import mock

import server


class AdDbRoutesTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_ads_forward_documented_filters_and_rewrite_media_route(self):
        payload = {"items": [{"id": "ad-1", "media": [{"id": "asset-1", "archiveUrl": "/v1/ad-db/ads/ad-1/media/asset-1", "sourceUrl": "https://cdn.example/private.mp4", "sourceURLs": ["https://cdn.example/private.mp4"]}]}], "page": {"nextCursor": None, "limit": 20}}
        with mock.patch.object(server, "hermes_request", return_value=payload) as upstream:
            response = self.client.get("/api/ad-db/ads?q=coast&locationRelation=office&limit=20")
        self.assertEqual(response.status_code, 200)
        upstream.assert_called_once_with("/v1/ad-db/ads?q=coast&locationRelation=office&limit=20", timeout=15)
        media = response.get_json()["items"][0]["media"][0]
        self.assertEqual(media["archiveUrl"], "/api/ad-db/ads/ad-1/media/asset-1")
        self.assertNotIn("sourceUrl", media)
        self.assertNotIn("sourceURLs", media)

    def test_ad_prospects_and_runs_forward_only_to_canonical_read_routes(self):
        for route, target in (("/api/ad-db/ads/ad-1", "/v1/ad-db/ads/ad-1"), ("/api/ad-db/prospects?agentId=agent-1", "/v1/ad-db/prospects?agentId=agent-1"), ("/api/ad-db/runs?status=paused", "/v1/ad-db/runs?status=paused")):
            with self.subTest(route=route), mock.patch.object(server, "hermes_request", return_value={"items": []}) as upstream:
                response = self.client.get(route)
            self.assertEqual(response.status_code, 200)
            upstream.assert_called_once_with(target, timeout=15)

    def test_rejects_unknown_filters_and_unsafe_identifiers_before_upstream(self):
        with mock.patch.object(server, "hermes_request") as upstream:
            self.assertEqual(self.client.get("/api/ad-db/ads?sourceUrl=https://cdn.example").status_code, 400)
            self.assertEqual(self.client.get("/api/ad-db/ads/%2E%2E").status_code, 404)
        upstream.assert_not_called()

    def test_media_route_relays_only_the_hermes_archived_redirect(self):
        response_value = server.redirect("/research-storage/assets/a", code=302)
        with mock.patch.object(server, "_ad_db_media_redirect", return_value=response_value) as relay:
            response = self.client.get("/api/ad-db/ads/ad-1/media/asset-1", follow_redirects=False)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/research-storage/assets/a")
        relay.assert_called_once_with("ad-1", "asset-1")


if __name__ == "__main__":
    unittest.main()
