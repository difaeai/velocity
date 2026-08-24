/**
 * The social desk: connected accounts, and the daily AI content pipeline that
 * posts to them.
 *
 * Reading order if you are new to this: types.ts (the shapes), accounts.ts
 * (getting a network connected), then pipeline.ts (what happens every morning).
 */
export {
  adminConnectSocialAccount,
  adminDisconnectSocialAccount,
  adminVerifySocialAccount,
  adminGetSocialConnectSchema,
} from './accounts';

export { adminGetSocialSettings, adminUpdateSocialSettings } from './settings';

export {
  socialDailyContent,
  adminGenerateSocialPost,
  adminReviewSocialPost,
  adminPublishSocialPost,
  adminAttachSocialVideo,
  adminDeleteSocialPost,
} from './pipeline';
