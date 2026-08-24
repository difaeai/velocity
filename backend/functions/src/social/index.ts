/**
 * The social desk: four agents that plan, write, design, cut and post
 * Velocity's content, plus the accounts they post to and the queue an admin
 * approves everything through.
 *
 * Reading order if you are new to this: types.ts (the shapes and the crew),
 * crew.ts (who the four are and the standup they hold), pipeline.ts (what
 * happens on a run), then engagement.ts (what happens after a post is live).
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
  adminRequestSocialChanges,
  adminReviewSocialPost,
  adminPublishSocialPost,
  adminAttachSocialMedia,
  adminDeleteSocialPost,
} from './pipeline';

export {
  socialEngagement,
  adminSyncSocialComments,
  adminReplySocialComment,
  adminSetCommentStatus,
} from './engagement';
