import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

/**
 * The Firebase callable serializer encodes `undefined` object values as `null`
 * on the wire, which the backend zod schemas reject for `.optional()` fields —
 * the caller sees a bare "Invalid request." with no clue which field is at
 * fault. Drop undefined keys before sending so optional fields are truly absent.
 *
 * This bit the Reactivate button on the partners page: reactivating passes no
 * suspension reason, so `reason: undefined` arrived as `reason: null` and
 * failed `z.string().optional()`. Every admin call with an optional field had
 * the same latent bug, hence fixing it here rather than at one call site.
 *
 * Mirrors the identical helper in apps/mobile/src/api/client.ts — keep the two
 * in step.
 */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

function callable<Req, Res>(name: string): (data: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data: Req) => (await fn(stripUndefined(data) as Req)).data;
}

/** Admin-only backend actions (each guarded by requireAdmin server-side). */
export const adminApi = {
  approveDriver: callable<{ driverId: string }, { ok: boolean }>('approveDriver'),
  rejectDriver: callable<
    { driverId: string; reason?: string; suspend?: boolean; rejectedSections?: string[] },
    { ok: boolean }
  >('rejectDriver'),
  setUserRole: callable<{ targetUid: string; role: 'passenger' | 'driver' | 'admin' }, { ok: boolean }>(
    'setUserRole',
  ),
  resolveSafetyEvent: callable<{ eventId: string; resolution?: string }, { ok: boolean }>(
    'resolveSafetyEvent',
  ),
  markPayoutPaid: callable<{ payoutId: string }, { ok: boolean }>('markPayoutPaid'),
  adminCreateDriver: callable<
    {
      fullName: string;
      email: string;
      phone?: string;
      vehicleType: string;
      vehicleLabel: string;
      plate: string;
      cnic?: string;
      franchiseId?: string;
    },
    { ok: boolean; uid: string; passwordResetLink: string | null }
  >('adminCreateDriver'),
  updateDriver: callable<
    {
      driverId: string;
      fullName?: string;
      phone?: string;
      vehicleType?: string;
      vehicleLabel?: string;
      plate?: string;
      cnic?: string;
      franchiseId?: string | null;
    },
    { ok: boolean }
  >('updateDriver'),
  deleteDriver: callable<{ driverId: string }, { ok: boolean }>('deleteDriver'),
  adminCreateFranchise: callable<
    { name: string; ownerName: string; email: string; phone?: string; city?: string },
    { ok: boolean; franchiseId: string }
  >('adminCreateFranchise'),
  adminAssignFranchise: callable<
    { driverId: string; franchiseId: string | null },
    { ok: boolean }
  >('adminAssignFranchise'),
  banPassenger: callable<
    { passengerId: string; banned: boolean },
    { ok: boolean }
  >('banPassenger'),
  adminCreatePassenger: callable<
    { displayName: string; email?: string; phone?: string; gender?: string; password?: string },
    { ok: boolean; uid: string }
  >('adminCreatePassenger'),
  adminUpdatePassenger: callable<
    { passengerId: string; displayName?: string; email?: string; gender?: string; role?: string },
    { ok: boolean }
  >('adminUpdatePassenger'),
  adminDeletePassenger: callable<
    { passengerId: string },
    { ok: boolean }
  >('adminDeletePassenger'),
  resolveDispute: callable<
    { disputeId: string; resolution: string; refundAmount?: number },
    { ok: boolean }
  >('resolveDispute'),
  adminReviewCommissionSettlement: callable<
    { settlementId: string; approve: boolean; reason?: string },
    { ok: boolean; status: string }
  >('adminReviewCommissionSettlement'),

  /** Passenger CNIC verification — the identity gate in front of couriers. */
  adminReviewCnicVerification: callable<
    { uid: string; approve: boolean; reason?: string },
    { ok: boolean; status: 'verified' | 'rejected' }
  >('adminReviewCnicVerification'),

  // ── Travel Mate admin ─────────────────────────────────────────────────────
  approveTravelMateSubscription: callable<
    { subscriptionId: string },
    { status: string; uid: string; endAt: string; dailyAllowance: number }
  >('approveTravelMateSubscription'),
  rejectTravelMateSubscription: callable<
    { subscriptionId: string; reason?: string },
    { status: string }
  >('rejectTravelMateSubscription'),
  adminCreateTravelMatePlan: callable<
    { name: string; billingPeriod: 'weekly' | 'yearly'; pricePKR: number; dailyLikeAllowance: number; active?: boolean },
    { ok: boolean; planId: string }
  >('adminCreateTravelMatePlan'),
  adminUpdateTravelMatePlan: callable<
    { planId: string; name?: string; billingPeriod?: 'weekly' | 'yearly'; pricePKR?: number; dailyLikeAllowance?: number; active?: boolean },
    { ok: boolean }
  >('adminUpdateTravelMatePlan'),
  adminDeleteTravelMatePlan: callable<
    { planId: string },
    { ok: boolean }
  >('adminDeleteTravelMatePlan'),
  adminSuspendTravelMateProfile: callable<
    { targetUid: string; reason?: string },
    { ok: boolean }
  >('adminSuspendTravelMateProfile'),

  // ── Travel Mate community feed admin (full CRUD) ──────────────────────────
  adminUpdateTravelMatePost: callable<
    { postId: string; text: string },
    { updated: boolean }
  >('adminUpdateTravelMatePost'),
  // deleteTravelMatePost / deleteTravelMateComment honour the admin claim
  // server-side, so the dashboard calls the same CFs users do.
  deleteTravelMatePost: callable<{ postId: string }, { deleted: boolean }>('deleteTravelMatePost'),
  deleteTravelMateComment: callable<
    { postId: string; commentId: string },
    { deleted: boolean }
  >('deleteTravelMateComment'),
  adminUpsertTravelMateCommunity: callable<
    { communityId?: string; name: string; city: string; description?: string },
    { communityId: string; created: boolean }
  >('adminUpsertTravelMateCommunity'),
  adminDeleteTravelMateCommunity: callable<
    { communityId: string },
    { deleted: boolean; postsDetached: number }
  >('adminDeleteTravelMateCommunity'),

  // ── Earn with Velocity — the Partner Program ──────────────────────────────
  adminReviewPartnerApplication: callable<
    {
      uid: string;
      decision: 'approve' | 'reject' | 'resubmit';
      reason?: string;
      /** Approve onto a tier — lets an admin let a Pro applicant in as Free when
       * the registration fee never actually landed. */
      tier?: 'free' | 'pro';
    },
    { ok: boolean; status: string; code: string | null }
  >('adminReviewPartnerApplication'),
  adminReviewWithdrawal: callable<
    { requestId: string; decision: 'approve' | 'reject' | 'paid'; reason?: string },
    { ok: boolean }
  >('adminReviewWithdrawal'),
  adminSuspendPartner: callable<
    { partnerId: string; suspended: boolean; reason?: string },
    { ok: boolean }
  >('adminSuspendPartner'),
  adminUpdatePartner: callable<
    {
      partnerId: string;
      fullName?: string;
      city?: string;
      mobile?: string;
      tier?: 'free' | 'pro';
    },
    { ok: boolean }
  >('adminUpdatePartner'),
  adminDeletePartner: callable<
    { partnerId: string; reason?: string },
    { ok: boolean; unboundDrivers: number; unboundPassengers: number }
  >('adminDeletePartner'),
  adminMarkRideStatus: callable<
    { tripId: string; status: 'completed' | 'cancelled' | 'scam' | 'fraud'; reason?: string },
    { ok: boolean; status: string; rows: number }
  >('adminMarkRideStatus'),
  adminReassignReferral: callable<
    { uid: string; type: 'driver' | 'passenger'; fleetId?: string | null; reason?: string },
    { ok: boolean }
  >('adminReassignReferral'),

  // ── Advertise — "Find your Customers" business proximity ads ───────────────
  adminReviewBusinessAdApplication: callable<
    {
      uid: string;
      decision: 'approve' | 'reject' | 'resubmit';
      reason?: string;
      /** Approve onto a different radius/plan than asked for — e.g. the transfer
       * that landed only covers the cheaper band. */
      radiusKm?: number;
      months?: 3 | 6 | 12;
    },
    { ok: boolean; status: string }
  >('adminReviewBusinessAdApplication'),
  adminSetBusinessAdStatus: callable<
    { adId: string; status: 'active' | 'paused' | 'removed'; reason?: string },
    { ok: boolean; status: string }
  >('adminSetBusinessAdStatus'),
  adminSuspendAdvertiser: callable<
    { uid: string; suspended: boolean; reason?: string },
    { ok: boolean }
  >('adminSuspendAdvertiser'),
  adminListDriverSubmissions: callable<
    { status?: 'pending' | 'approved' | 'rejected'; limit?: number },
    { ok: boolean; submissions: Record<string, unknown>[] }
  >('adminListDriverSubmissions'),
  adminReviewDriverSubmission: callable<
    { submissionId: string; decision: 'approve' | 'reject'; reason?: string },
    { ok: boolean; status: string; driverUid?: string; fleetBound?: boolean }
  >('adminReviewDriverSubmission'),
  adminRotatePartnerPortal: callable<
    { uid: string; reason?: string },
    { ok: boolean; portalId: string }
  >('adminRotatePartnerPortal'),
  adminUpdateBusinessAdSettings: callable<
    {
      tiers?: { key: string; maxRadiusKm: number; monthlyFee: number; adSlots: number }[];
      currency?: string;
      notifyCooldownHours?: number;
      maxNotifPerUserPerDay?: number;
      payment?: Record<string, string | null>;
    },
    { ok: boolean }
  >('adminUpdateBusinessAdSettings'),
};

/* ── franchise portal ─────────────────────────────────────────────────────
 * Called from the Pro partner's own web portal, not from the admin console.
 * Each is guarded server-side by `requirePortalOwner`, which re-derives
 * ownership from the signed-in uid — the portalId in the payload is a claim,
 * never a credential.
 * ------------------------------------------------------------------------- */

export interface PortalSubmission {
  id: string;
  fullName: string;
  phone: string;
  vehicleType: string;
  vehicleLabel: string;
  plate: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  fleetBound: boolean;
  createdAt: { seconds: number } | null;
  reviewedAt: { seconds: number } | null;
}

export interface PortalPayload {
  ok: boolean;
  partner: {
    uid: string;
    fullName: string | null;
    city: string | null;
    mobile: string | null;
    tier: string;
    level: string;
    referralCode: string | null;
    portalId: string;
    totalDrivers: number;
    totalPassengers: number;
    completedRides: number;
    lifetimeEarnings: number;
  };
  wallet: { balance: number; pending: number; withdrawn: number; currency: string } | null;
  submissions: { pending: number; approved: number; rejected: number };
}

export interface PortalDriverInput {
  portalId: string;
  fullName: string;
  phone: string;
  email?: string;
  cnic: string;
  licenseNumber?: string;
  vehicleType: string;
  vehicleLabel: string;
  plate: string;
  vehicleYear?: number;
  vehicleColor?: string;
  notes?: string;
}

export const portalApi = {
  getPortal: callable<{ portalId: string }, PortalPayload>('getFranchisePortal'),
  listDrivers: callable<
    { portalId: string; status?: string; limit?: number },
    { ok: boolean; drivers: PortalSubmission[] }
  >('franchiseListDrivers'),
  submitDriver: callable<PortalDriverInput, { ok: boolean; submissionId: string; status: string }>(
    'franchiseSubmitDriver',
  ),
  withdrawSubmission: callable<{ portalId: string; submissionId: string }, { ok: boolean }>(
    'franchiseWithdrawSubmission',
  ),
};

// ── Dashboard analytics ─────────────────────────────────────────────────────

/** One Pakistan day of platform activity. Mirrors DailyStats on the backend. */
export interface DailyStats {
  date: string;
  tripsRequested: number;
  tripsCompleted: number;
  tripsCancelled: number;
  tripsPooled: number;
  revenue: number;
  commission: number;
  driverPayout: number;
  cashTrips: number;
  walletTrips: number;
  byRideType: Record<string, number>;
  intercity: number;
  couriers: number;
  freight: number;
  specialRides: number;
  scheduled: number;
  newPassengers: number;
  newDrivers: number;
}

export interface AnalyticsPayload {
  days: number;
  series: DailyStats[];
  totals: {
    revenue: number;
    commission: number;
    driverPayout: number;
    tripsCompleted: number;
    tripsRequested: number;
    tripsCancelled: number;
    newPassengers: number;
    newDrivers: number;
  };
  snapshot: {
    driversPending: number;
    driversApproved: number;
    driversSuspended: number;
    passengers: number;
    activeTrips: number;
    openDisputes: number;
    cnicPending: number;
    payoutsPending: number;
  };
  generatedAt: number;
}

export const analyticsApi = {
  get: callable<{ days?: number }, AnalyticsPayload>('adminGetAnalytics'),
};

// ── Cost of Velocity ────────────────────────────────────────────────────────

/** What one refresh run found, per vendor. Mirrors backend costs/index.ts. */
export interface CostRefreshOutcome {
  /** The month every fetched amount covers — `2026-07`. */
  window: string;
  fetchedAt: number;
  sources: Record<
    'googleCloud' | 'anthropic' | 'meta',
    { state: 'ok' | 'not-configured' | 'error'; detail?: string; lines?: number; unmapped?: string[] }
  >;
  lines: number;
}

export const costsApi = {
  /** Pull last month's spend from Google Cloud, Anthropic and Meta, now. */
  refresh: callable<Record<string, never>, CostRefreshOutcome>('adminRefreshPlatformCosts'),
};

// ── Social desk ─────────────────────────────────────────────────────────────

export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'youtube',
  'tiktok',
  'threads',
  'x',
  'linkedin',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_FORMATS = ['reel', 'video', 'carousel', 'post', 'story'] as const;
export type SocialFormat = (typeof SOCIAL_FORMATS)[number];

/** The jobs you can hire for. Mirrors ROLES in the backend's social/types.ts. */
export const SOCIAL_ROLES = [
  'research-assistant',
  'content-writer',
  'seo-expert',
  'google-seo-expert',
  'designer',
  'video-editor',
  'youtube-ads-expert',
  'social-manager',
] as const;
export type SocialRole = (typeof SOCIAL_ROLES)[number];

/** The stages of one piece, in the order they happen. */
export const SOCIAL_STAGES = [
  'research',
  'seo',
  'script',
  'search',
  'design',
  'video',
  'ads',
  'distribute',
] as const;
export type SocialStage = (typeof SOCIAL_STAGES)[number];

/** Which networks take which formats. Mirrors PLATFORM_FORMATS on the backend. */
export const PLATFORM_FORMATS: Record<SocialPlatform, SocialFormat[]> = {
  facebook: ['reel', 'video', 'carousel', 'post', 'story'],
  instagram: ['reel', 'carousel', 'post', 'story'],
  youtube: ['reel', 'video'],
  tiktok: ['reel', 'video'],
  threads: ['reel', 'post', 'carousel'],
  x: ['post'],
  linkedin: ['post'],
};

export function platformTakes(platform: SocialPlatform, format: SocialFormat): boolean {
  return PLATFORM_FORMATS[platform].includes(format);
}

/** Which stages a format actually runs. */
export const FORMAT_STAGES: Record<SocialFormat, SocialStage[]> = {
  reel: [...SOCIAL_STAGES],
  video: [...SOCIAL_STAGES],
  carousel: ['research', 'seo', 'script', 'search', 'design', 'distribute'],
  post: ['research', 'seo', 'script', 'search', 'design', 'distribute'],
  story: ['research', 'seo', 'script', 'search', 'design', 'distribute'],
};

/** The console-visible half of a connection (never the token itself). */
export interface SocialAccountDoc {
  platform: SocialPlatform;
  status: 'connected' | 'error' | 'disconnected';
  displayName?: string;
  handle?: string | null;
  externalId?: string;
  followers?: number | null;
  avatarUrl?: string | null;
  canPublishVideo?: boolean;
  tokenHint?: string | null;
  lastError?: string | null;
  connectedBy?: string | null;
}

export interface ConnectField {
  key: 'accessToken' | 'externalId' | 'clientId' | 'clientSecret';
  label: string;
  hint: string;
  secret: boolean;
}

export interface ConnectSchema {
  vaultReady: boolean;
  platforms: {
    platform: SocialPlatform;
    label: string;
    canPublishVideo: boolean;
    fields: ConnectField[];
  }[];
}

// ── the staff ───────────────────────────────────────────────────────────────

export interface SocialEmployee {
  id: string;
  name: string;
  role: SocialRole;
  title: string;
  status: 'active' | 'off_duty';
  instructions: string;
  colour: string;
  hiredAtMs: number;
  hiredBy: string | null;
  lastWorkedAtMs: number | null;
  piecesWorked: number;
}

export interface SocialRoleOption {
  role: SocialRole;
  label: string;
  blurb: string;
  stage: SocialStage;
  titles: string[];
}

export interface SocialTeamMemberRef {
  id: string;
  name: string;
  role: SocialRole;
  title: string;
}

export interface SocialWorkEntry {
  stage: SocialStage;
  employeeId: string | null;
  name: string;
  role: SocialRole | null;
  state: 'working' | 'done' | 'briefed' | 'skipped' | 'failed';
  note: string | null;
  error: string | null;
  startedAtMs: number | null;
  finishedAtMs: number | null;
}

export interface SocialCompetitor {
  name: string;
  url: string;
}

export interface SocialSettings {
  enabled: boolean;
  runHour: number;
  postsPerDay: number;
  platforms: SocialPlatform[];

  angles: string[];
  lastAngleIndex: number;
  formats: SocialFormat[];
  lastFormatIndex: number;

  /** Read by every employee, on every job. */
  crewInstructions: string;

  researchEnabled: boolean;
  competitors: SocialCompetitor[];

  /**
   * The Claude model the desk writes and decides with. There is no image or
   * video model: nothing is rendered by the backend — the designer and the
   * editor write briefs, and you make the files and attach them from the queue.
   */
  textModel: string;

  engagementEnabled: boolean;
  autoReply: boolean;

  lastRunAtMs: number | null;
  lastRunStatus: string | null;
  lastEngagementAtMs: number | null;
  lastEngagementStatus: string | null;
}

export interface SocialReadiness {
  writer: boolean;
  tokenVault: boolean;
}

export type SocialPostStatus =
  | 'planning'
  | 'researching'
  | 'drafting'
  | 'optimising'
  | 'designing'
  | 'rendering'
  | 'awaiting_approval'
  | 'changes_requested'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'partial'
  | 'failed'
  | 'rejected';

export interface SocialMediaAsset {
  kind: 'video' | 'image';
  provider: string;
  url: string | null;
  storagePath: string | null;
  aspect: string;
  slide: number;
  alt: string;
}

export interface SocialPlan {
  concept: string;
  audience: string;
  why: string;
  hookDirection: string;
  visualDirection: string;
  editDirection: string;
  distribution: string;
  /** Keyed by employee id. */
  notes: Record<string, string>;
}

export interface SocialResearch {
  atMs: number;
  trends: string[];
  competitorMoves: string[];
  opportunities: string[];
  hookPatterns: string[];
  avoid: string[];
  sources: { title: string; url: string }[];
  error: string | null;
}

export interface SocialSeoPack {
  searchIntent: string;
  keywords: string[];
  hashtags: string[];
  altTexts: string[];
  note: string;
}

export interface SocialSearchPack {
  youtube: { title: string; description: string; tags: string[] } | null;
  webAngle: string;
  note: string;
}

export interface SocialAdPlan {
  objective: string;
  campaignType: string;
  hookVariants: string[];
  targeting: { locations: string[]; ages: string; interests: string[] };
  budgetNote: string;
  cta: string;
  whatToTest: string;
  successLooksLike: string;
}

export type SocialRevisionScope = 'script' | 'design' | 'video' | 'caption' | 'seo' | 'ads';

export interface SocialRevision {
  atMs: number;
  by: string;
  feedback: string;
  scope: SocialRevisionScope[];
}

export interface SocialPostDoc {
  id: string;
  date: string;
  format?: SocialFormat;
  angle: string;
  status: SocialPostStatus;
  team?: SocialTeamMemberRef[];
  work?: Partial<Record<SocialStage, SocialWorkEntry>>;
  plan?: SocialPlan | null;
  script: {
    hook: string;
    hookVariants?: string[];
    frames?: { scene: string; overlay: string }[];
    voiceover: string;
    cta: string;
    rationale: string;
    viralHook?: string;
    /** Written before formats existed. */
    beats?: string[];
    onScreenText?: string[];
  } | null;
  caption: string;
  captions?: Partial<Record<SocialPlatform, string>>;
  hashtags: string[];
  facts: Record<string, number | string>;
  research?: SocialResearch | null;
  seo?: SocialSeoPack | null;
  search?: SocialSearchPack | null;
  ads?: SocialAdPlan | null;
  direction?: { prompt: string; overlay: string; alt: string }[] | null;
  cut?: { prompt: string; note: string } | null;
  media?: SocialMediaAsset[];
  /** Posts made before carousels existed carry one video here. */
  video?: { url: string | null; provider: string; aspect: string } | null;
  targets: SocialPlatform[];
  results: Partial<
    Record<SocialPlatform, { ok: boolean; id: string | null; url: string | null; error: string | null }>
  >;
  revisions?: SocialRevision[];
  error: string | null;
  approvedBy: string | null;
}

/** Everything on a piece that can be shown, in either shape. */
export function postAssets(post: SocialPostDoc): SocialMediaAsset[] {
  if (post.media?.length) return [...post.media].sort((a, b) => a.slide - b.slide);
  if (post.video?.url) {
    return [
      {
        kind: 'video',
        provider: post.video.provider,
        url: post.video.url,
        storagePath: null,
        aspect: post.video.aspect,
        slide: 1,
        alt: '',
      },
    ];
  }
  return [];
}

export interface SocialCommentDoc {
  id: string;
  platform: SocialPlatform;
  mediaId: string;
  postId: string | null;
  commentId: string;
  authorName: string;
  text: string;
  permalink: string | null;
  createdAtMs: number;
  status: 'new' | 'drafted' | 'replied' | 'ignored' | 'escalated';
  intent: 'praise' | 'question' | 'complaint' | 'safety' | 'spam' | 'other' | null;
  draftReply: string | null;
  draftedBy?: string | null;
  sentReply: string | null;
  sentAtMs: number | null;
  error: string | null;
}

export const socialApi = {
  connectSchema: callable<Record<string, never>, ConnectSchema>('adminGetSocialConnectSchema'),
  connect: callable<
    {
      platform: SocialPlatform;
      accessToken: string;
      externalId?: string;
      clientId?: string;
      clientSecret?: string;
      expiresInDays?: number;
    },
    { ok: boolean }
  >('adminConnectSocialAccount'),
  verify: callable<{ platform: SocialPlatform }, { ok: boolean }>('adminVerifySocialAccount'),
  disconnect: callable<{ platform: SocialPlatform }, { ok: boolean }>('adminDisconnectSocialAccount'),

  roles: callable<Record<string, never>, { roles: SocialRoleOption[] }>('adminGetSocialRoles'),
  hire: callable<
    { name: string; role: SocialRole; title?: string; instructions?: string },
    { ok: boolean; employee: SocialEmployee }
  >('adminHireSocialEmployee'),
  updateEmployee: callable<
    {
      id: string;
      name?: string;
      title?: string;
      instructions?: string;
      status?: 'active' | 'off_duty';
      role?: SocialRole;
    },
    { ok: boolean }
  >('adminUpdateSocialEmployee'),
  fire: callable<{ id: string }, { ok: boolean }>('adminFireSocialEmployee'),
  seedTeam: callable<Record<string, never>, { ok: boolean; hired: number }>('adminSeedSocialTeam'),

  getSettings: callable<
    Record<string, never>,
    { settings: SocialSettings; readiness: SocialReadiness; coverage: string[]; staffed: number }
  >('adminGetSocialSettings'),
  updateSettings: callable<Partial<SocialSettings>, { ok: boolean; settings: SocialSettings }>(
    'adminUpdateSocialSettings',
  ),

  /** Put the team on a piece. It always ends in the approval queue. */
  generate: callable<
    { date?: string; format?: SocialFormat; angle?: string; targets?: SocialPlatform[]; replace?: boolean },
    { ok: boolean; id: string; format: SocialFormat }
  >('adminGenerateSocialPost'),
  requestChanges: callable<
    { postId: string; feedback: string; scope: SocialRevisionScope[] },
    { ok: boolean; reran: string[] }
  >('adminRequestSocialChanges'),
  review: callable<
    {
      postId: string;
      approve: boolean;
      caption?: string;
      targets?: SocialPlatform[];
      publishNow?: boolean;
    },
    { ok: boolean; status?: string; published?: number; failed?: number }
  >('adminReviewSocialPost'),
  publish: callable<
    { postId: string; platforms?: SocialPlatform[] },
    { ok: boolean; published: number; failed: number }
  >('adminPublishSocialPost'),
  attachMedia: callable<
    { postId: string; storagePath: string; kind?: 'video' | 'image'; slide?: number; alt?: string },
    { ok: boolean }
  >('adminAttachSocialMedia'),
  deletePost: callable<{ postId: string }, { ok: boolean }>('adminDeleteSocialPost'),

  syncComments: callable<Record<string, never>, { ok: boolean; summary: string }>('adminSyncSocialComments'),
  replyComment: callable<{ platform: SocialPlatform; commentId: string; text: string }, { ok: boolean }>(
    'adminReplySocialComment',
  ),
  setCommentStatus: callable<
    { platform: SocialPlatform; commentId: string; status: 'new' | 'drafted' | 'ignored' | 'escalated' },
    { ok: boolean }
  >('adminSetCommentStatus'),
};
