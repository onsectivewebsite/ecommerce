# Phase 36 — Product Q&A — Debug Pass

> What shipped, the invariants, every endpoint, and the deferred follow-ons.

## What shipped

- **Three models** — `ProductQuestion`, `ProductAnswer`, `AnswerHelpfulVote` —
  plus `QnaStatus` / `QnaAuthorRole` enums and a `QUESTION_ANSWERED`
  `NotificationKind`.
- **`QnaService`** — ask, answer, toggle-helpful, author soft-delete, "mine",
  seller list, admin list + hide/unhide for both questions and answers,
  public per-product listing.
- **Author-role snapshot.** When an answer is created, `resolveAuthorRole`
  resolves `ADMIN → SELLER → VERIFIED_OWNER → BUYER` once and stores it on the
  row; it is never recomputed on read.
- **Denormalized counts.** `ProductQuestion.answerCount` (VISIBLE answers) and
  `ProductAnswer.helpfulCount` (vote rows) are recomputed on every mutating
  path — answer create/delete/hide/unhide, vote toggle.
- **Notifications.** A new answer writes a `QUESTION_ANSWERED` feed entry to
  the question's asker (skipped when the asker answers themselves).
- **Rate limits.** `qna.ask` 20/3600s/user, `qna.answer` 30/3600s/user.
- **Frontend.** buyer-web `ProductQna` on the PDP + `/account/qna`;
  seller-web `/qna`; admin-web `/qna`; nav links in both portals + an account
  tile in buyer-web.

## Invariants

1. **Questions/answers attach to `ACTIVE` products only** — `ask` 404s otherwise.
2. **`answerCount` = count of `VISIBLE` answers**; recomputed by `recountAnswers`
   after every answer state change (create, author-delete, admin hide/unhide).
3. **`helpfulCount` = count of `AnswerHelpfulVote` rows**; recomputed by
   `recountHelpful` after every toggle.
4. **One helpful vote per `(answerId, userId)`** — a DB unique constraint; a
   second call deletes the row (toggle off). Count can't be inflated.
5. **You cannot mark your own answer helpful** — 400.
6. **Authors soft-delete their own content** (`DELETED_BY_AUTHOR`), idempotent
   (no-op if already deleted). Admins hide/unhide (`HIDDEN_BY_ADMIN`). No hard
   deletes — moderation history is preserved.
7. **Answering requires a `VISIBLE` question** — answering a hidden/deleted
   question 404s.
8. **Author role is a snapshot** — a later refund does not strip a
   `VERIFIED_OWNER` badge.

## Endpoint inventory

| Method | Path | Auth | Rate limit |
|--------|------|------|------------|
| GET  | `/qna/product/:productId` | public | — |
| GET  | `/qna/mine` | JWT | — |
| POST | `/qna/questions` | JWT | `qna.ask` 20/3600s user |
| POST | `/qna/questions/:id/answers` | JWT | `qna.answer` 30/3600s user |
| POST | `/qna/answers/:id/helpful` | JWT | — |
| DELETE | `/qna/questions/:id` | JWT | — |
| DELETE | `/qna/answers/:id` | JWT | — |
| GET  | `/seller/qna` | SELLER/ADMIN | — |
| POST | `/seller/qna/questions/:id/answers` | SELLER/ADMIN | — |
| GET  | `/admin/qna` | ADMIN | — |
| POST | `/admin/qna/questions/:id/{hide,unhide}` | ADMIN | — |
| POST | `/admin/qna/answers/:id/{hide,unhide}` | ADMIN | — |

## Schema additions

- `ProductQuestion`, `ProductAnswer`, `AnswerHelpfulVote` models.
- `QnaStatus` (`VISIBLE` / `HIDDEN_BY_ADMIN` / `DELETED_BY_AUTHOR`),
  `QnaAuthorRole` (`BUYER` / `VERIFIED_OWNER` / `SELLER` / `ADMIN`).
- `NotificationKind.QUESTION_ANSWERED`.
- `Product.questions`, `User.questionsAsked` / `answersGiven` / `answerVotes`
  back-relations.

## Manual test list

1. **Ask.** PDP → signed-in → post a question → appears at the top of the list.
2. **Answer as seller.** Sign in as the product's seller → answer → answer
   carries the **Seller** badge; asker gets a `QUESTION_ANSWERED` notification.
3. **Verified-owner badge.** Answer from an account with a `DELIVERED` order
   for that product → **Verified owner** badge.
4. **Helpful toggle.** Vote an answer → count +1; vote again → count back to 0.
5. **Self-vote.** Vote your own answer → 400.
6. **Author delete.** Delete your own question on `/account/qna` → drops from
   the public PDP list; `answerCount` of nothing else shifts.
7. **Admin hide.** Hide a question on admin `/qna` → whole thread disappears
   from the PDP; unhide restores it with per-answer statuses intact.
8. **Hide one answer.** Hide a single answer → question's `answerCount` drops
   by one; other answers stay.
9. **Rate limit.** Post 21 questions within the hour → the 21st is throttled.

## Decisions worth highlighting

- **Snapshot author role** rather than computing on read — one query at write
  time vs. N at read time, and a stable badge is the correct UX.
- **Reused the reviews moderation surface** — same `VISIBLE / HIDDEN_BY_ADMIN`
  shape and admin page layout, so moderators have one mental model.
- **Helpful-only, no downvote** — downvotes invite brigading; a purchase
  decision just needs the best answer to float up.
- **Denormalized counts** over `_count` aggregates on read — the PDP renders
  these on every product view; a stored integer beats a join each time, and
  the recompute paths are all low-frequency writes.

## Limitations / follow-ons

- **No answer editing** — delete and re-post.
- **No nested replies** — flat answer list; threading stays in messaging.
- **Public `viewerVoted` is always false on the server-rendered PDP** — the
  endpoint is unauthenticated; the client component toggles optimistically.
  An optional-auth guard would let the badge persist across reloads.
- **No seller notification on a new question** — only the asker is notified on
  an answer. A `qna.question.posted` listener could nudge the seller.
- **No abuse heuristics** beyond the rate limit (no spam/profanity scan).
