# Travel Community

## Deployment

1. Apply existing migrations through `019_personal_activity_anonymous_trips.sql`.
2. Run `supabase/020_travel_community.sql` in the Supabase SQL editor as the trusted database owner.
3. Deploy the Angular app from this branch.

Migration 020 is transactional and rerunnable. It needs the existing `profiles`,
`is_app_admin()` and `audit_app_change()` definitions. No new Supabase project,
auth settings, Storage bucket, Edge Function, API key, or Realtime publication is
needed. Do not enable Realtime for the new tables for this implementation.
Apply migrations in order; rerunning an earlier search-view migration can replace
later view definitions unrelated to Community.

## Data and Permissions

- `community_posts`: author, category, title/content, optional airport/route/flight/date.
- `community_comments`: post, author, optional parent, content, deleted marker.
- `community_reactions`: author, exactly one post/comment target, reaction type.
- `community_reports`: reporter, exactly one target, reason/details, moderation status.

All tables have RLS. Authenticated travelers can read posts/comments/reactions;
only their authors can mutate them. Column grants prevent changing ownership,
timestamps, comment parents or reaction targets. Authors default to `auth.uid()`;
the UI does not supply an author ID. Constraint checks bound text, validate
categories/reactions and enforce exactly one target. Partial unique indexes permit
only one reaction and one report per user/target.

Comment validation prevents replies to replies and cross-post parent references.
It locks the parent in a restricted security-definer trigger because a row lock
under the caller's UPDATE RLS would incorrectly hide another user's parent comment.
The trigger has no standalone browser execution privilege, and comment writes
still pass normal RLS. The UI uses a deleted-comment marker to preserve replies.
A direct authorized hard deletion promotes surviving replies to top-level comments;
deleting a post removes its whole discussion, reactions and reports.

Foreign keys reference existing profile/auth records, without copying display names
or avatars. Removing an account/profile cascades its Community records. Current
display names and avatars are joined in the read RPCs, not fetched individually.
No email, phone, private profile fields, contact approvals, requests, or private
messages are joined or exposed by Community RPCs.

Reports are readable only by their reporter and existing administrators. Normal
users cannot modify moderation status or delete reports. One report never removes
content. Administrators can review reports through the Supabase SQL editor:

```sql
select id, reporter_user_id, post_id, comment_id, reason, details, status, created_at
from public.community_reports
where status = 'OPEN'
order by created_at;

-- After reviewing a specific report, use its UUID:
-- update public.community_reports set status = 'REVIEWED' where id = '<report UUID>';
```

The existing admin UI does not yet include a Community moderation queue. Trusted
database operators can remove inappropriate content following their moderation
policy. The existing privacy-safe audit trigger covers Community changes without
copying post text, comment text or report details into activity history.

## Application Behavior

Routes: `/community`, `/community/new`, `/community/my-posts`,
`/community/:postId`, `/community/:postId/edit`. All require authentication.
Sharing copies a deep link; its recipient must sign in to read the post.

`/community?airport=JFK` prefilters the same feed. A future
`/airport/:code/community` page can use the same `CommunityService.feed()` airport
filter; no separate airport forum or tables are needed.

Feed requests return at most 20 posts, plus a `has_more` flag. Comments and each
reply thread have independent 20-row pages. Newest comments/replies appear first.
Most Discussed orders by non-deleted comment/reply count, then recent posting time.
Search uses bound SQL arguments and a literal case-insensitive substring across
title, content, airport/route codes and flight number. No dynamic SQL from user text
is used. Offset pagination is deterministic for an unchanged dataset; concurrent
posts/deletes can shift pages, so refresh resets to the latest page and the UI
deduplicates loaded IDs. Indexes cover all requested feed and relationship fields.
Very large forums may later need indexed full-text search and count caching;
neither is needed to change the API or data model.

Reads have abortable timeouts and generation guards. Foreground refresh uses the
existing `AuthService.appForeground$`. Subscriptions are component-scoped and
disposed on navigation. There are no new global listeners, Realtime channels,
Supabase clients, auth callbacks, or session changes.

Reactions and comments update after a successful write without reloading the page.
Network failures retain the draft and show errors. An uncertain save is not retried
automatically to avoid duplicate posts/comments. Use refresh to check the result.

The owned-trip integration is on Trip Detail: Post to Community opens a reviewable
form with only origin, destination, start date and the first leg's flight number.
It does not copy notes, contact data, requests or chat messages, and does not store
a link to a private itinerary. Posts made from anonymous trips are still attributed
to the Community author; the user reviews and explicitly publishes the new post.
The post editor and comment composer display the sensitive-information warning.
Airport updates have an explicit user-generated-information notice.

## Verification

- `npm run test:community`: isolated PostgreSQL/PGlite tests with users A/B/C and
  anonymous access. Covers direct RLS, column privileges, impersonation, parent
  validation, reaction toggle/replace/uniqueness, report privacy, constraints,
  cascading behavior, current profile projection, safe search and pagination.
- `npm run build`: production Angular compile.
- Start Angular locally on port 4203. Run `node scripts/verify-community.mjs` with
  Playwright installed, or set `PLAYWRIGHT_MODULE` to its package directory.
  `COMMUNITY_TEST_URL` overrides the local URL. The script uses three synthetic
  sessions and mocks/blocks all external traffic, so it cannot write production data.
  It exercises editor/detail/feed flows, comments/replies, reactions, reports,
  trip-prefill privacy, filters, pagination, desktop/mobile layout, errors/retry,
  five simulated visibility/focus returns and navigation to existing pages.
  This environment's automated browser keeps tabs visible/focused, so native tab
  switching cannot be verified here; the test explicitly delivers lifecycle events.

These local checks do not replace testing against a deployed Supabase staging
project. After applying 020 in staging, use three disposable accounts to repeat
the direct permission checks and browser flows. In particular, test five or more
tab returns with a real refreshed access token and confirm existing search,
requests, messages, My Trips and logout still work. No production migration or
live-account actions were performed by the implementation tests.
