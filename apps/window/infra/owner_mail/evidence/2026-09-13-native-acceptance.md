# Native owner mailbox acceptance - 13 September 2026

- Source commit during activation: `04073e8633636779c4da3f64258799cc4f7cc0d4`.
- The pre-activation IMAP review was read-only and header-only: four UNSEEN messages were counted. The owner then approved their native baseline synchronization. Two provider setup messages were imported as native Communications; two existing controlled self-sends were not duplicated.
- Native account `Blockwise Owner Inbox` was activated for `hello@blockwise.sale` using the owner login `blockwise@purelymail.com`; inbound/outbound mail, the site mail gate and the opt-in scheduler were enabled.
- Controlled native outbound Communication `bm8pgmqv02` queued as `bmcic5achi` with status `Sent` to `blockwise@purelymail.com`. Its actual Sent-folder copy was verified read-only.
- The owner-only reply was imported as native Communication `cnoo9kp8jv` and has `in_reply_to` `bm8pgmqv02`, proving native reply threading.
- Repeating native receipt created zero new Communications. The non-approved historical queue record `c4b70t7jbe` remains preserved as `Error` and was not dispatched.

The private, root-only detailed receipt is `/srv/frank/verification/owner-crm-final-20260913/mailbox-native-acceptance.json`.
