/**
 * The social desk: the people you hire, the content they plan and make, the
 * accounts they post to, and the queue you approve everything through.
 *
 * Reading order if you are new to this: types.ts (roles, stages, formats),
 * employees.ts (who works here and who picks up which job), crew.ts (what they
 * all know and the standup), pipeline.ts (a working day), then engagement.ts
 * (what happens after a piece is live).
 */
export {
  adminConnectSocialAccount,
  adminDisconnectSocialAccount,
  adminVerifySocialAccount,
  adminGetSocialConnectSchema,
} from './accounts';

export {
  adminGetSocialRoles,
  adminHireSocialEmployee,
  adminUpdateSocialEmployee,
  adminFireSocialEmployee,
  adminSeedSocialTeam,
} from './employees';

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
