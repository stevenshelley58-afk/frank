"""Customer-language contract tests for the Mini Frank intake guide.

These are deliberately fixture-based: the guide is a customer surface, so its
deterministic output boundary must reject paraphrases of implementation talk
without treating ordinary Australian business wording as technical jargon.
"""

from __future__ import annotations

import unittest

import json

from mini_frank import (
    MINI_GUIDE_SAFE_FALLBACK,
    MINI_GUIDE_SCHEMA,
    _customer_safe_guide_reply,
    _customer_safe_guide_turn,
)


class MiniGuideContractTests(unittest.TestCase):
    @staticmethod
    def question_card() -> dict:
        return {
            "schema": MINI_GUIDE_SCHEMA,
            "message": "I can shape this around the result that matters most to your business.",
            "understanding": [{
                "key": "problem",
                "label": "What needs fixing",
                "value": "Turn interest in the business into more booked jobs.",
                "assumed": False,
            }],
            "next": {
                "kind": "question",
                "id": "desired_action",
                "question": "What should people do after they see the ad?",
                "why": "This helps every ad lead to the right result.",
                "options": [
                    {
                        "id": "send_enquiry",
                        "label": "Send an enquiry",
                        "detail": "Collect their details so the business can follow up.",
                        "recommended": True,
                    },
                    {
                        "id": "book_now",
                        "label": "Book now",
                        "detail": "Take people straight to a booking step.",
                        "recommended": False,
                    },
                ],
                "allow_other": True,
                "allow_choose_for_me": True,
            },
        }

    @classmethod
    def preview_card(cls) -> dict:
        card = cls.question_card()
        card["message"] = "Here are two simple directions based on what you told me."
        card["next"] = {
            "kind": "preview",
            "id": "ad_direction",
            "question": "Which direction feels closest to your business?",
            "why": "Both solve the same problem, but they feel different to customers.",
            "options": [
                {
                    "id": "quick_offer",
                    "label": "Quick and clear",
                    "detail": "Lead with the offer and one clear next step.",
                    "recommended": True,
                    "preview": {
                        "kind": "ad",
                        "title": "Your offer",
                        "subtitle": "A short reason to act today.",
                        "items": ["Main benefit", "Simple proof"],
                        "action": "Send an enquiry",
                    },
                },
                {
                    "id": "trust_first",
                    "label": "Trust first",
                    "detail": "Start with reassurance before showing the offer.",
                    "recommended": False,
                    "preview": {
                        "kind": "page",
                        "title": "Why customers choose us",
                        "subtitle": "A calm introduction to the business.",
                        "items": ["Customer promise", "What happens next"],
                        "action": "See the offer",
                    },
                },
            ],
            "allow_other": True,
            "allow_choose_for_me": True,
        }
        return card

    @classmethod
    def confirm_card(cls) -> dict:
        card = cls.question_card()
        card["message"] = (
            "I understand the useful first version and the result it should create. "
            "Click Solve this for me — free."
        )
        card["next"] = {
            "kind": "confirm",
            "id": "solve_free",
            "question": "",
            "why": "",
            "options": [],
            "allow_other": True,
            "allow_choose_for_me": False,
        }
        return card

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
            "Click Solve this for me — free."
        )

    def test_rejects_unicode_list_glyphs(self):
        self.assert_replaced(
            "Two choices: \u2022 use a form \u2022 use a spreadsheet. Tell me which."
        )

    def test_keeps_ordinary_business_and_company_name_language(self):
        cases = (
            "Yes. I'll help your software company organise new customer enquiries so the "
            "right person follows up quickly. I'll keep it simple. Click Solve this for me "
            "— free.",
            "Yes. I'll help your technical service team turn new calls into clear jobs and "
            "follow-ups. I'll keep it simple. Click Solve this for me — free.",
            "Yes. I'll help your restaurant server team keep bookings clear during busy "
            "services. I'll keep it simple. Click Solve this for me — free.",
            "Yes. I'll help API Plumbing turn online enquiries into booked jobs and prompt "
            "follow-ups. I'll keep it simple. Click Solve this for me — free.",
            "Yes. I'll help Code Electrical turn site enquiries into clear quotes and next "
            "steps. I'll keep it simple. Click Solve this for me — free.",
            "Yes. I'll help your architecture studio keep client approvals and next steps "
            "clear. I'll keep it simple. Click Solve this for me — free.",
            "Yes. I'll help Framework Fitness follow up new members without missed messages. "
            "I'll keep it simple. Click Solve this for me — free.",
            "Yes. I'll upgrade the way new leads are followed up so customers hear back "
            "quickly. I'll keep it simple. Click Solve this for me — free.",
            "Yes. I'll help HTML Homes turn inspection enquiries into clear viewing times and "
            "follow-ups. I'll keep it simple. Click Solve this for me — free.",
        )
        for reply in cases:
            with self.subTest(reply=reply):
                self.assert_retained(reply)

    def test_accepts_typed_question_preview_and_confirmation(self):
        for expected_kind, card in (
            ("question", self.question_card()),
            ("preview", self.preview_card()),
            ("confirm", self.confirm_card()),
        ):
            with self.subTest(kind=expected_kind):
                visible, guarded, retained = _customer_safe_guide_turn(json.dumps(card))
                self.assertTrue(retained)
                self.assertEqual(visible, card["message"])
                self.assertEqual(guarded["next"]["kind"], expected_kind)
                self.assertEqual(guarded["understanding"], card["understanding"])

    def test_accepts_safe_fenced_json_only(self):
        card = self.question_card()
        visible, guarded, retained = _customer_safe_guide_turn(
            "```json\n" + json.dumps(card) + "\n```"
        )
        self.assertTrue(retained)
        self.assertEqual(visible, card["message"])
        self.assertEqual(guarded["next"]["id"], "desired_action")

    def test_untyped_question_never_competes_with_the_free_action(self):
        visible, guarded, retained = _customer_safe_guide_turn(
            "Who are the customers you want this to help?"
        )
        self.assertFalse(retained)
        self.assertEqual(visible, MINI_GUIDE_SAFE_FALLBACK)
        self.assertEqual(guarded["next"]["kind"], "confirm")
        self.assertEqual(guarded["next"]["question"], "")
        self.assertEqual(guarded["next"]["options"], [])
        self.assertTrue(visible.endswith("Click Solve this for me — free."))

    def test_rejects_malicious_or_malformed_typed_cards_with_safe_confirmation(self):
        cases = []
        html = self.preview_card()
        html["next"]["options"][0]["preview"]["title"] = "<script>steal()</script>"
        cases.append(html)
        technical = self.question_card()
        technical["next"]["options"][0]["detail"] = "Connect an API endpoint and run Python."
        cases.append(technical)
        no_recommendation = self.question_card()
        no_recommendation["next"]["options"][0]["recommended"] = False
        cases.append(no_recommendation)
        question_with_preview = self.question_card()
        question_with_preview["next"]["options"][0]["preview"] = {
            "kind": "ad", "title": "Offer", "subtitle": "Simple offer",
            "items": ["Benefit", "Proof"], "action": "Book now",
        }
        cases.append(question_with_preview)
        mixed_confirm = self.confirm_card()
        mixed_confirm["next"]["question"] = "Which result do you want?"
        cases.append(mixed_confirm)
        second_question_in_message = self.question_card()
        second_question_in_message["message"] = "Should this feel friendly? I can shape the result."
        cases.append(second_question_in_message)
        second_question_in_detail = self.question_card()
        second_question_in_detail["next"]["options"][0]["detail"] = "Should customers enquire?"
        cases.append(second_question_in_detail)
        second_question_in_preview = self.preview_card()
        second_question_in_preview["next"]["options"][0]["preview"]["subtitle"] = (
            "Ready to book? A simple reason to act today."
        )
        cases.append(second_question_in_preview)
        confirm_understanding_question = self.confirm_card()
        confirm_understanding_question["understanding"][0]["value"] = "More booked jobs?"
        cases.append(confirm_understanding_question)

        for card in cases:
            with self.subTest(card=card):
                visible, guarded, retained = _customer_safe_guide_turn(json.dumps(card))
                self.assertFalse(retained)
                self.assertEqual(visible, MINI_GUIDE_SAFE_FALLBACK)
                self.assertEqual(guarded["next"]["kind"], "confirm")
                self.assertEqual(guarded["next"]["options"], [])

    def test_rejects_network_locations_opaque_internal_ids_and_overlong_copy(self):
        unsafe_values = (
            "Use localhost:8080 for the booking step.",
            "Send people to 127.0.0.1:3000 after the ad.",
            "Open ftp://internal.invalid for the offer.",
            "Use //internal.example for the form.",
            "Send this to [::1]:9000 for review.",
            "Use portal.example for the next step.",
        )
        cases = []
        for value in unsafe_values:
            card = self.question_card()
            card["next"]["options"][0]["detail"] = value
            cases.append(card)
        internal_id = self.question_card()
        internal_id["next"]["id"] = "api_endpoint"
        cases.append(internal_id)
        overlong = self.question_card()
        overlong["message"] = " ".join(["simple"] * 46)
        cases.append(overlong)
        overlong_question = self.question_card()
        overlong_question["next"]["question"] = (
            "What should every suitable customer do after seeing this offer in their busy day?"
        )
        cases.append(overlong_question)

        for card in cases:
            with self.subTest(card=card):
                visible, guarded, retained = _customer_safe_guide_turn(json.dumps(card))
                self.assertFalse(retained)
                self.assertEqual(visible, MINI_GUIDE_SAFE_FALLBACK)
                self.assertEqual(guarded["next"]["kind"], "confirm")

    def test_allows_only_one_explicitly_requested_preview_revision(self):
        first = self.preview_card()
        visible, guarded, retained = _customer_safe_guide_turn(
            json.dumps(first), preview_count=1
        )
        self.assertFalse(retained)
        self.assertEqual(visible, MINI_GUIDE_SAFE_FALLBACK)
        self.assertEqual(guarded["next"]["kind"], "confirm")

        same_id = self.preview_card()
        _visible, _guarded, retained = _customer_safe_guide_turn(
            json.dumps(same_id),
            preview_count=1,
            preview_revision_requested=True,
            previous_card_id="ad_direction",
        )
        self.assertFalse(retained)

        revised = self.preview_card()
        revised["next"]["id"] = "ad_direction_revised"
        visible, guarded, retained = _customer_safe_guide_turn(
            json.dumps(revised),
            preview_count=1,
            preview_revision_requested=True,
            previous_card_id="ad_direction",
        )
        self.assertTrue(retained)
        self.assertEqual(visible, revised["message"])
        self.assertEqual(guarded["next"]["id"], "ad_direction_revised")

        _visible, guarded, retained = _customer_safe_guide_turn(
            json.dumps(revised),
            preview_count=2,
            preview_revision_requested=True,
            previous_card_id="ad_direction",
        )
        self.assertFalse(retained)
        self.assertEqual(guarded["next"]["kind"], "confirm")

    def test_question_budget_falls_back_without_losing_prior_understanding(self):
        prior = self.question_card()["understanding"]
        visible, guarded, retained = _customer_safe_guide_turn(
            json.dumps(self.question_card()),
            prior_understanding=prior,
            questions_asked=3,
        )
        self.assertFalse(retained)
        self.assertEqual(visible, MINI_GUIDE_SAFE_FALLBACK)
        self.assertEqual(guarded["next"]["kind"], "confirm")
        self.assertEqual(guarded["understanding"], prior)


if __name__ == "__main__":
    unittest.main()
