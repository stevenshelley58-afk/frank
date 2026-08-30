"""Customer-language contract tests for the Mini Frank intake guide.

These are deliberately fixture-based: the guide is a customer surface, so its
deterministic output boundary must reject paraphrases of implementation talk
without treating ordinary Australian business wording as technical jargon.
"""

from __future__ import annotations

import unittest

from mini_frank import MINI_GUIDE_SAFE_FALLBACK, _customer_safe_guide_reply


class MiniGuideContractTests(unittest.TestCase):
    def assert_replaced(self, reply: str) -> None:
        guarded, retained = _customer_safe_guide_reply(reply)
        self.assertFalse(retained, reply)
        self.assertEqual(guarded, MINI_GUIDE_SAFE_FALLBACK)

    def assert_retained(self, reply: str) -> None:
        guarded, retained = _customer_safe_guide_reply(reply)
        self.assertTrue(retained, reply)
        self.assertEqual(guarded, reply)

    def test_rejects_paraphrased_process_and_implementation_choices(self):
        cases = (
            "I took a look at what is there already. There are two ways forward: add it to "
            "the current ads tool or start a fresh one. What would you like?",
            "The current setup has been reviewed. It could live alongside your ad work or on "
            "its own. Which direction should we take?",
            "I can make a webpage or a spreadsheet. Which do you want?",
            "I can write a program or use a form. Tell me which you would like.",
            "There are three ways forward: a form, a sheet, or a website. Pick what suits "
            "your business.",
            "First, I review existing work; then, I make the right thing.",
        )
        for reply in cases:
            with self.subTest(reply=reply):
                self.assert_replaced(reply)

    def test_rejects_false_started_or_future_progress_claims(self):
        self.assert_replaced(
            "I have begun your solution and will return when it is ready."
        )

    def test_rejects_malformed_or_unhelpful_response_shapes(self):
        # The response contract permits a maximum of four sentences. It must
        # also end in either one useful business question or a free-start cue.
        cases = (
            " ".join(["ordinary"] * 70),
            "Yes! I can help! It will be useful! I will keep it simple! Solve it free!",
            "Yes, certainly.",
            "I will make something useful for you.",
        )
        for reply in cases:
            with self.subTest(reply=reply):
                self.assert_replaced(reply)

        self.assert_retained("Who are the customers you want this to help?")
        self.assert_retained(
            "Yes. I'll make a simple Meta ad helper that turns a few details about your "
            "business into ready-to-use ads. I'll choose sensible defaults and keep it easy. "
            "Click Solve this for me -- free, then ask for free changes after you try it."
        )

    def test_rejects_unicode_list_glyphs(self):
        self.assert_replaced(
            "Two choices: \u2022 use a form \u2022 use a spreadsheet. Tell me which."
        )

    def test_keeps_ordinary_business_and_company_name_language(self):
        cases = (
            "Yes. I'll help your software company organise new customer enquiries so the "
            "right person follows up quickly. I'll keep it simple. Click Solve this for me "
            "-- free, then ask for free changes after you try it.",
            "Yes. I'll help your technical service team turn new calls into clear jobs and "
            "follow-ups. I'll keep it simple. Click Solve this for me -- free, then ask for "
            "free changes after you try it.",
            "Yes. I'll help your restaurant server team keep bookings clear during busy "
            "services. I'll keep it simple. Click Solve this for me -- free, then ask for "
            "free changes after you try it.",
            "Yes. I'll help API Plumbing turn online enquiries into booked jobs and prompt "
            "follow-ups. I'll keep it simple. Click Solve this for me -- free, then ask for "
            "free changes after you try it.",
            "Yes. I'll help Code Electrical turn site enquiries into clear quotes and next "
            "steps. I'll keep it simple. Click Solve this for me -- free, then ask for free "
            "changes after you try it.",
            "Yes. I'll help your architecture studio keep client approvals and next steps "
            "clear. I'll keep it simple. Click Solve this for me -- free, then ask for free "
            "changes after you try it.",
            "Yes. I'll help Framework Fitness follow up new members without missed messages. "
            "I'll keep it simple. Click Solve this for me -- free, then ask for free changes "
            "after you try it.",
            "Yes. I'll upgrade the way new leads are followed up so customers hear back "
            "quickly. I'll keep it simple. Click Solve this for me -- free, then ask for free "
            "changes after you try it.",
            "Yes. I'll help HTML Homes turn inspection enquiries into clear viewing times and "
            "follow-ups. I'll keep it simple. Click Solve this for me -- free, then ask for "
            "free changes after you try it.",
        )
        for reply in cases:
            with self.subTest(reply=reply):
                self.assert_retained(reply)


if __name__ == "__main__":
    unittest.main()
