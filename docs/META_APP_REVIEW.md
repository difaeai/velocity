# Publishing the Meta app for Velocity Studio

Velocity Studio customers connect Instagram, Facebook and their ad account
through **Velocity's own Meta app** — the one already connected to
@velocityrides.app. Today that app is in **Development mode**, so only people
with a role on the app (admin, developer, tester) can sign in through it. To let
any customer connect with one click, the app has to go **Live** with **Advanced
Access** to the permissions below. Nothing in the code changes for that; it is
all console work at <https://developers.facebook.com/apps>.

Until it is approved, a customer can still be connected by adding their
Facebook account as a **Tester** (App roles → Roles → Add Testers) — useful for
the first few paying customers.

## 1. Business Verification (do this first — it takes days)

Meta Business Suite → Settings → Business info → **Start verification** for
**Berreto (Private) Limited**. Have ready:

- SECP certificate of incorporation (legal name exactly "Berreto (Private) Limited")
- NTN certificate or a utility bill / bank statement showing the business address
- A phone number and a website on the same name: velocityrides.app
- A domain email (business@velocityrides.app needs a real mailbox — see project notes)

Then connect the app to that business: App settings → Basic → **Verification**.

## 2. App settings → Basic

| Field | Value |
|---|---|
| App domains | `velocityrides.app` |
| Privacy policy URL | `https://velocityrides.app/privacy` (section 14 covers Studio — added 2026-10-23) |
| Terms of Service URL | `https://velocityrides.app/terms` |
| User data deletion | Instructions URL: `https://velocityrides.app/privacy` (section 14, "Your control") |
| Category | Business and Pages |
| App icon | 1024×1024 PNG — export it from `public/brand/velocity-icon.svg` |

Facebook Login → Settings → **Valid OAuth Redirect URIs** must contain exactly
`https://velocityrides.app/connect/instagram` (it already does for the house
desk).

## 3. Permissions to request (App Review → Permissions and features)

These are exactly what `backend/functions/src/social/meta.ts` asks for — request
nothing more, or review is refused for "unused permissions".

| Permission | What to write in "How will your app use it" |
|---|---|
| `pages_show_list` | After the business signs in, we list the Facebook Pages they manage so they can choose which Page Velocity Studio posts to. |
| `pages_read_engagement` | We read the Page's posts and their likes/comments counts to show the business which posts performed best and to plan better ones. |
| `pages_manage_posts` | We publish the posts and videos the business approved in our dashboard to their Facebook Page. |
| `pages_manage_engagement` | We post the replies the business approved (or allowed us to send) to comments on their own Page posts. |
| `instagram_basic` | We read the connected Instagram professional account's username, follower count and media list to show them in the dashboard. |
| `instagram_content_publish` | We publish the reels, posts, stories and carousels the business approved to their Instagram professional account. |
| `instagram_manage_comments` | We read comments on the business's own Instagram posts and publish the replies they approved. |
| `instagram_manage_insights` | We read reach, saves, shares and comments per post so the business sees what works and the planner learns from it. |
| `business_management` | Needed to read the Pages and Instagram accounts owned through the business's Meta Business account. |
| `ads_management` | Only when the business connects the Ads expert: we create, pause and adjust the campaigns they approved, never above the daily limit they set. |
| `ads_read` | We read campaign spend, reach, clicks, CTR, CPC and CPM to report them in the dashboard. |

`ads_management` / `ads_read` also need the **Marketing API** product added to the
app, and may need a separate review.

## 4. The screencast (one per permission group, ~2 minutes each)

Meta reviewers must *see* each permission used. Record the screen at
https://velocityrides.app with a test business account, in this order:

1. Open `/studio`, press **Start free**, sign up, fill the business form.
2. **Connected accounts → Connect Instagram**: the Facebook Login dialog, choose
   the Page, see Instagram + Facebook marked Connected (`pages_show_list`,
   `business_management`, `instagram_basic`).
3. Dashboard → **Make it** (a post) → it appears in a box → **Approve & post** →
   open Instagram and Facebook and show the post live (`instagram_content_publish`,
   `pages_manage_posts`).
4. **Comments**: a comment on that post appears, approve the drafted reply, show
   it live on Instagram (`instagram_manage_comments`, `pages_manage_engagement`).
5. **Analytics**: post performance read from the account (`instagram_manage_insights`,
   `pages_read_engagement`).
6. **Ads manager → Connect ad account**, make an ad, approve it, show it in Meta
   Ads Manager, then the numbers on the Ads page (`ads_management`, `ads_read`).

Give the reviewer a test login in the review notes (a Studio account plus a
Facebook test user that manages a test Page with a linked Instagram
professional account).

## 5. Go Live

After approval: App settings → toggle **App mode: Live**. Customers can then
connect with no app of their own. Re-test with a Facebook account that has no
role on the app.

## What the code already does for customers

- One shared Meta app for everyone (`system/socialMetaApp`); each customer's
  Page/Instagram/ad tokens are sealed in *their* workspace
  (`workspaces/{id}/socialAccounts/*/secret/credentials`,
  `workspaces/{id}/system/socialAds/secret/credentials`), unreadable from any
  client.
- The OAuth hand-off is pinned to the user **and** the workspace it started in.
- Long-lived user token before `/me/accounts`, so Page tokens do not expire
  (see docs/SOCIAL.md); the ads token lasts ~60 days and the Ads page warns at 7.
