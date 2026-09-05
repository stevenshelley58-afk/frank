import io
import unittest
import urllib.error
from unittest import mock

import server

AD_ID = "11111111-1111-4111-8111-111111111111"
ASSET_ID = "22222222-2222-4222-8222-222222222222"


class UpstreamBytes:
    def __init__(self, body=b"", status=200, headers=None):
        self.body = io.BytesIO(body)
        self.status = status
        self.headers = headers or {}
        self.closed = False

    def read(self, size=-1):
        return self.body.read(size)

    def getcode(self):
        return self.status

    def close(self):
        self.closed = True


class AdDbRoutesTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_ads_forward_documented_filters_and_rewrite_media_route(self):
        payload = {"items": [{"id": AD_ID, "media": [{"id": ASSET_ID, "archiveUrl": f"/v1/ad-db/ads/{AD_ID}/media/{ASSET_ID}", "sourceUrl": "https://cdn.example/private.mp4", "sourceURLs": ["https://cdn.example/private.mp4"]}]}], "page": {"nextCursor": None, "limit": 20}}
        with mock.patch.object(server, "hermes_request", return_value=payload) as upstream:
            response = self.client.get("/api/ad-db/ads?q=coast&locationRelation=office&limit=20")
        self.assertEqual(response.status_code, 200)
        upstream.assert_called_once_with("/v1/ad-db/ads?q=coast&locationRelation=office&limit=20", timeout=15)
        media = response.get_json()["items"][0]["media"][0]
        self.assertEqual(media["archiveUrl"], f"/api/ad-db/ads/{AD_ID}/media/{ASSET_ID}")
        self.assertNotIn("sourceUrl", media)
        self.assertNotIn("sourceURLs", media)

    def test_ad_prospects_and_runs_forward_only_to_canonical_read_routes(self):
        for route, target in ((f"/api/ad-db/ads/{AD_ID}", f"/v1/ad-db/ads/{AD_ID}"), ("/api/ad-db/prospects?agentName=Alex", "/v1/ad-db/prospects?agentName=Alex"), ("/api/ad-db/runs?status=paused", "/v1/ad-db/runs?status=paused")):
            with self.subTest(route=route), mock.patch.object(server, "hermes_request", return_value={"items": []}) as upstream:
                response = self.client.get(route)
            self.assertEqual(response.status_code, 200)
            upstream.assert_called_once_with(target, timeout=15)

    def test_rejects_unknown_filters_and_unsafe_identifiers_before_upstream(self):
        with mock.patch.object(server, "hermes_request") as upstream:
            self.assertEqual(self.client.get("/api/ad-db/ads?sourceUrl=https://cdn.example").status_code, 400)
            self.assertEqual(self.client.get("/api/ad-db/ads?locationType=target").status_code, 400)
            self.assertEqual(self.client.get("/api/ad-db/ads/%2E%2E").status_code, 404)
        upstream.assert_not_called()

    def _media(self, upstream, *, method="GET", headers=None):
        opener = mock.Mock()
        opener.open.return_value = upstream
        with mock.patch.object(server.urllib.request, "build_opener", return_value=opener), mock.patch.object(server, "HERMES_KEY", "session-secret"):
            response = self.client.open(
                f"/api/ad-db/ads/{AD_ID}/media/{ASSET_ID}",
                method=method,
                headers=headers or {},
            )
        return response, opener

    def test_media_route_streams_archive_bytes_and_auth_without_redirect(self):
        upstream = UpstreamBytes(
            b"abcdef",
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": "6",
                "Accept-Ranges": "bytes",
                "ETag": '"digest"',
            },
        )
        response, opener = self._media(upstream)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b"abcdef")
        self.assertEqual(response.headers["Content-Type"], "video/mp4")
        self.assertEqual(response.headers["ETag"], '"digest"')
        self.assertTrue(response.headers["Cache-Control"].startswith("private"))
        self.assertNotIn("Location", response.headers)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer session-secret")
        self.assertEqual(request.get_method(), "GET")
        self.assertTrue(upstream.closed)

    def test_media_route_preserves_range_and_head_contract(self):
        partial = UpstreamBytes(
            b"bcd",
            status=206,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": "3",
                "Content-Range": "bytes 1-3/6",
                "Accept-Ranges": "bytes",
                "ETag": '"digest"',
            },
        )
        response, opener = self._media(partial, headers={"Range": "bytes=1-3", "If-Range": '"digest"'})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.data, b"bcd")
        self.assertEqual(response.headers["Content-Range"], "bytes 1-3/6")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_header("Range"), "bytes=1-3")
        self.assertEqual(request.get_header("If-range"), '"digest"')

        head_upstream = UpstreamBytes(headers={"Content-Type": "video/mp4", "Content-Length": "6", "ETag": '"digest"'})
        head, opener = self._media(head_upstream, method="HEAD")
        self.assertEqual(head.status_code, 200)
        self.assertEqual(head.data, b"")
        self.assertEqual(head.headers["Content-Length"], "6")
        self.assertEqual(opener.open.call_args.args[0].get_method(), "HEAD")
        self.assertTrue(head_upstream.closed)

    def test_media_route_preserves_404_and_rejects_external_redirect(self):
        missing = urllib.error.HTTPError("http://hermes/media", 404, "missing", {}, io.BytesIO(b'{"detail":"missing"}'))
        opener = mock.Mock()
        opener.open.side_effect = missing
        with mock.patch.object(server.urllib.request, "build_opener", return_value=opener):
            response = self.client.get(f"/api/ad-db/ads/{AD_ID}/media/{ASSET_ID}")
        self.assertEqual(response.status_code, 404)

        redirect = urllib.error.HTTPError(
            "http://hermes/media",
            302,
            "redirect",
            {"Location": "https://cdn.example/private.mp4"},
            io.BytesIO(b""),
        )
        opener.open.side_effect = redirect
        with mock.patch.object(server.urllib.request, "build_opener", return_value=opener):
            response = self.client.get(f"/api/ad-db/ads/{AD_ID}/media/{ASSET_ID}")
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("Location", response.headers)


if __name__ == "__main__":
    unittest.main()
