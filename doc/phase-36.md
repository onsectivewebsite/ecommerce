# Phase 36 — Product Q&A

> Buyer questions on product pages, answered by sellers and verified owners, with helpful-votes and admin moderation.

## Goal

Add a community Q&A surface to every product page. A shopper deciding on a
purchase can ask a question; the seller, a verified owner of the product, or
any signed-in shopper can answer. Answers carry an author-role badge so the
reader can weigh them, and helpful-votes float the best answer to the top.
Admins moderate. This is a general ecommerce trust feature — independent of
a product's condition.

## Data model

Three models + two enums.

- **`ProductQuestion`** — `productId`, `askedByUserId`, `body`, `status`,
  denormalized `answerCount`, `hiddenReason`, timestamps.
- **`ProductAnswer`** — `questionId`, `answeredByUserId`, `body`,
  `authorRole`, `status`, denormalized `helpfulCount`, `hiddenReason`,
  timestamps.
- **`AnswerHelpfulVote`** — `(answerId, userId)` unique; one helpful mark per
  user per answer, toggleable.
- **`QnaStatus`** — `VISIBLE` / `HIDDEN_BY_ADMIN` / `DELETED_BY_AUTHOR`.
  Same lifecycle for questions and answers.
- **`QnaAuthorRole`** — `BUYER` / `VERIFIED_OWNER` / `SELLER` / `ADMIN`.
  Computed once, at answer-creation time (a snapshot, not recomputed on read).

`NotificationKind` gains `QUESTION_ANSWERED`.

## Author role resolution

When an answer is created, the author's role is resolved in priority order:

1. `ADMIN` — the user's account role is ADMIN.
2. `SELLER` — the user owns the Seller that owns the product.
3. `VERIFIED_OWNER` — the user has a `DELIVERED` order containing the product.
4. `BUYER` — everyone else.

## Invariants

1. **Questions and answers attach to live products only** — `ProductStatus.ACTIVE`.
2. **A question's `answerCount` equals its count of `VISIBLE` answers**;
   `helpfulCount` equals the answer's `AnswerHelpfulVote` rows. Both are
   denormalized and recomputed on every mutating path.
3. **Helpful-votes are idempotent per user** — a unique `(answerId, userId)`
   makes a second vote a no-op toggle; you cannot inflate a count.
4. **A user cannot mark their own answer helpful.**
5. **Authors soft-delete their own content** (`DELETED_BY_AUTHOR`); admins
   hide/unhide (`HIDDEN_BY_ADMIN`). Neither is a hard delete — moderation
   history is preserved.
6. **Hiding a question hides its whole thread** from public reads; answers
   keep their own status so an unhide restores the prior per-answer state.
7. **Posting is rate-limited** — questions and answers are user-generated
   content and spammable.

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET  | `/qna/product/:productId` | public | paginated questions + nested answers |
| POST | `/qna/questions` | JWT | ask — `qna.ask` 20/3600s user |
| POST | `/qna/questions/:id/answers` | JWT | answer — `qna.answer` 30/3600s user |
| POST | `/qna/answers/:id/helpful` | JWT | toggle helpful vote |
| DELETE | `/qna/questions/:id` | JWT | author soft-delete |
| DELETE | `/qna/answers/:id` | JWT | author soft-delete |
| GET  | `/qna/mine` | JWT | my questions + my answers |
| GET  | `/seller/qna` | SELLER/ADMIN | questions on my products, unanswered first |
| GET  | `/admin/qna` | ADMIN | moderation list, status filter |
| POST | `/admin/qna/questions/:id/{hide,unhide}` | ADMIN | |
| POST | `/admin/qna/answers/:id/{hide,unhide}` | ADMIN | |

## Events & notifications

- `qna.question.posted` `{ questionId, productId }`
- `qna.answer.posted` `{ answerId, questionId, productId }`
- On a new answer, the question's asker gets a `QUESTION_ANSWERED`
  notification-feed entry (skipped when the asker answers their own question).

## Frontend

- **buyer-web** — `ProductQna` client component on the PDP: question list with
  nested answers, role badges, helpful buttons, ask + answer forms (signed-in
  only). `/account/qna` lists the buyer's own questions and answers.
- **seller-web** — `/qna`: questions on the seller's products, unanswered
  first, inline answer box (posts as `SELLER`).
- **admin-web** — `/qna`: moderation table mirroring `/reviews` — status
  filter, hide/unhide on questions and answers.

## Decisions

- **Author role is snapshotted** at answer time rather than recomputed on
  read — it's cheap, stable, and a "verified owner" badge shouldn't vanish if
  the order is later refunded.
- **No nested replies / threading** — one question, a flat list of answers.
  Threading is messaging's job; Q&A stays scannable.
- **Helpful-vote only, no downvote** — downvotes invite brigading and add
  little for a purchase decision. Best answer floats up; bad answers just sit.
- **Reuses the reviews moderation pattern** — same `VISIBLE / HIDDEN_BY_ADMIN`
  status surface and admin UI shape, so moderators learn one mental model.
