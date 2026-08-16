import unittest

from tool_apps import canonical_json, canonical_sha256


class CanonicalJsonTest(unittest.TestCase):
    def test_rfc8785_is_unicode_and_number_stable(self):
        left = {"z": "caf\u00e9", "a": [1.0, True, None]}
        right = {"a": [1, True, None], "z": "caf\u00e9"}
        self.assertEqual(canonical_json(left), b'{"a":[1,true,null],"z":"caf\xc3\xa9"}')
        self.assertEqual(canonical_sha256(left), canonical_sha256(right))

    def test_non_string_object_keys_are_rejected(self):
        with self.assertRaises(TypeError):
            canonical_json({1: "not-json"})

    def test_rfc8785_utf16_key_order_and_number_vectors(self):
        properties = {
            "\u20ac": "Euro Sign",
            "\r": "Carriage Return",
            "\ufb33": "Hebrew Letter Dalet With Dagesh",
            "1": "One",
            "\U0001f600": "Emoji: Grinning Face",
            "\u0080": "Control",
            "\u00f6": "Latin Small Letter O With Diaeresis",
        }
        self.assertEqual(
            canonical_json(properties),
            '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\U0001f600":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}'.encode(),
        )
        self.assertEqual(
            canonical_json([333333333.33333329, 1e30, 4.50, 2e-3, 1e-27]),
            b"[333333333.3333333,1e+30,4.5,0.002,1e-27]",
        )
        self.assertEqual(
            canonical_sha256(properties),
            "5e321556d22018a9656991a9e94f77ec175fa193e52a2429d312f8419ec8b08c",
        )


if __name__ == "__main__":
    unittest.main()
