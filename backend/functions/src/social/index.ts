/**
 * The social desk: the people you hire, the content they plan and make, the
 * accounts they post to, the queue you approve everything through, and what
 * they learn from their own page afterwards.
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

/** The one-click half of connecting: Facebook Login instead of a pasted token. */
export {
  adminGetMetaConnectState,
  adminSetMetaApp,
  adminStartMetaConnect,
  adminFinishMetaConnect,
  adminChooseMetaPage,
} from './meta';

export {
  adminGetSocialRoles,
  adminHireSocialEmployee,
  adminUpdateSocialEmployee,
  adminFireSocialEmployee,
  adminSeedSocialTeam,
} from './employees';

export { adminGetSocialSettings, adminUpdateSocialSettings } from './settings';

/** The month plan the calendar shows and the daily run follows. */
export { adminPlanSocialMonth, adminEditPlanSlot } from './strategy';

/** A new Studio workspace's first days: market read → content → posting → funnel → close. */
export { adminLaunchMarket, socialLaunchSweep } from './launch';

export {
  socialDailyContent,
  socialPublishSweep,
  adminGenerateSocialPost,
  adminRequestSocialChanges,
  adminReviewSocialPost,
  adminPublishSocialPost,
  adminRenderSocialPost,
  adminAttachSocialMedia,
  adminDeleteSocialPost,
} from './pipeline';

/** The paid side: Meta campaigns planned, made, measured and steered here. */
export { socialAdsSync, adminSyncAds, adminSetAdsSettings, adminCreateAd, adminAdAction } from './ads';

export {
  socialPageRead,
  socialProfileAudit,
  adminReadOwnPage,
  adminAuditProfile,
} from './insights';

export {
  socialEngagement,
  adminSyncSocialComments,
  adminReplySocialComment,
  adminSetCommentStatus,
} from './engagement';
