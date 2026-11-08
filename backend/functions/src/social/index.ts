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
  adminConnectAdsToken,
} from './meta';

/** Google Ads: connected with "Continue with Google" and read, never spent from. */
export {
  adminGetGoogleAdsState,
  adminSetGoogleAdsApp,
  adminStartGoogleAdsConnect,
  adminFinishGoogleAdsConnect,
  adminChooseGoogleAdsAccount,
  adminDisconnectGoogleAds,
  adminGoogleAdsSummary,
} from './googleAds';

/** YouTube, TikTok and TikTok Ads: Continue with the network, no pasted tokens. */
export { adminVideoConnect, adminSetVideoApp } from './videoConnect';

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
export { socialAdsSync, adminSyncAds, adminSetAdsSettings, adminCreateAd, adminDesignAd, adminAdAction } from './ads';

/** The Research Assistant's own job: a campaign run on a simulated audience before anything is spent. */
export { researchDummyCampaign } from './researchAssistant';
export { researchAddCompetitorAd, researchRemoveCompetitorAd } from './competitorAds';
export { researchFetchCompetitorAds, researchAdLibraryState, adminSetAdLibraryKey, competitorAdsWeekly } from './adLibrary';

/** The owner's WooCommerce store: real orders per campaign, totals only. */
export { storeStartConnect, storeWooCallback, storeSyncNow, storeDisconnect, storeSalesSync } from './store';

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
