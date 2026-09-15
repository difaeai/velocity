/**
 * Find your Customers — the pieces the advertiser screens share.
 *
 *   ResultsFunnel  Reached → Seen → Asked, the three numbers that say whether
 *                  the money worked, in the order they happen.
 *   SeenBySection  How many people actually opened an offer, the last 7 days of
 *                  it, which offer they opened, and an anonymous "someone just
 *                  looked" feed. Never who — only that someone did.
 *   QueriesSection The newest questions customers sent, with what still needs
 *                  an answer called out.
 *   QueryRow       One conversation in a list.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import type {
  BusinessAd,
  BusinessAdDashboard,
  BusinessAdQueryThread,
} from '../api/client';
import { colors } from '../config';
import { timeAgo } from '../lib/timeAgo';
import { themed } from '../theme';
import { Text } from './Text';

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `2026-09-15` → `Tue`. Parsed as a calendar date, not an instant. */
function weekday(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return WEEKDAY[new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay()] ?? '';
}

// ── Funnel ───────────────────────────────────────────────────────────────────

export function ResultsFunnel({ data }: { data: BusinessAdDashboard }) {
  const reach = data.totals.reach;
  const seen = data.totals.viewers ?? 0;
  const asked = data.totals.queries ?? 0;

  const steps = [
    { label: 'Reached', value: reach, hint: 'got your offer' },
    { label: 'Seen', value: seen, hint: `${pct(seen, reach)}% of reached` },
    { label: 'Asked', value: asked, hint: `${pct(asked, seen)}% of seen` },
  ];

  return (
    <View style={s.funnelCard}>
      <View style={s.funnelRow}>
        {steps.map((step, i) => (
          <View key={step.label} style={s.funnelStep}>
            <Text style={s.funnelLabel}>{step.label.toUpperCase()}</Text>
            <Text style={[s.funnelValue, i === 1 ? { color: colors.primary } : null]} numberOfLines={1} adjustsFontSizeToFit>
              {step.value.toLocaleString()}
            </Text>
            <Text style={s.funnelHint} numberOfLines={1}>{step.hint}</Text>
          </View>
        ))}
      </View>
      {/* Bars share one scale — reach — so the drop between steps is visible. */}
      <View style={{ gap: 5 }}>
        {steps.map((step) => (
          <View key={step.label} style={s.track}>
            <View
              style={[
                s.fill,
                { width: `${reach > 0 ? Math.max(step.value > 0 ? 3 : 0, pct(step.value, reach)) : 0}%` },
              ]}
            />
          </View>
        ))}
      </View>
      <Text style={s.funnelFoot}>
        {data.totals.notified.toLocaleString()} notifications sent · {data.totals.clicks.toLocaleString()} total opens
      </Text>
    </View>
  );
}

// ── Seen by ──────────────────────────────────────────────────────────────────

export function SeenBySection({ data, ads }: { data: BusinessAdDashboard; ads: BusinessAd[] }) {
  const seen = data.totals.viewers ?? 0;
  const reach = data.totals.reach;
  const series = data.series ?? [];
  const max = Math.max(1, ...series.map((r) => r.viewers ?? 0));
  const weekTotal = series.reduce((n, r) => n + (r.viewers ?? 0), 0);
  const recent = data.recentViews ?? [];
  const byOffer = [...ads].sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));

  return (
    <View style={s.card}>
      <View style={s.seenHead}>
        <View style={s.eyeBadge}>
          <Text style={s.eyeTxt}>👁</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.seenBig}>
            {seen.toLocaleString()} <Text style={s.seenUnit}>{seen === 1 ? 'person' : 'people'}</Text>
          </Text>
          <Text style={s.muted}>
            opened your offer{reach > 0 ? ` · ${pct(seen, reach)}% of the ${reach.toLocaleString()} reached` : ''}
          </Text>
        </View>
      </View>

      <View style={s.divider} />

      <View style={s.rowBetween}>
        <Text style={s.subhead}>Last 7 days</Text>
        <Text style={s.mutedStrong}>{weekTotal.toLocaleString()} new</Text>
      </View>
      <View style={s.bars}>
        {series.map((row) => {
          const v = row.viewers ?? 0;
          return (
            <View key={row.day} style={s.barCol}>
              <Text style={s.barNum}>{v > 0 ? v : ''}</Text>
              <View style={s.barTrack}>
                <View style={[s.barFill, { height: `${v > 0 ? Math.max(6, (v / max) * 100) : 0}%` }]} />
              </View>
              <Text style={s.barDay}>{weekday(row.day)}</Text>
            </View>
          );
        })}
      </View>

      {byOffer.length > 1 ? (
        <>
          <View style={s.divider} />
          <Text style={s.subhead}>By offer</Text>
          {byOffer.map((ad) => (
            <View key={ad.adId} style={{ gap: 4 }}>
              <View style={s.rowBetween}>
                <Text style={s.offerName} numberOfLines={1}>{ad.title}</Text>
                <Text style={s.mutedStrong}>{(ad.viewers ?? 0).toLocaleString()}</Text>
              </View>
              <View style={s.track}>
                <View style={[s.fill, { width: `${pct(ad.viewers ?? 0, Math.max(1, seen))}%` }]} />
              </View>
            </View>
          ))}
        </>
      ) : null}

      <View style={s.divider} />
      <Text style={s.subhead}>Recently seen</Text>
      {recent.length === 0 ? (
        <Text style={s.muted}>
          Nobody has opened an offer yet. The moment someone does, it shows up here.
        </Text>
      ) : (
        recent.slice(0, 5).map((v, i) => (
          <View key={`${v.adId}-${v.atMs}-${i}`} style={s.feedRow}>
            <View style={s.feedDot} />
            <Text style={s.feedTxt} numberOfLines={1}>
              Someone opened <Text style={s.feedOffer}>{v.adTitle}</Text>
            </Text>
            <Text style={s.feedTime}>{timeAgo(v.atMs / 1000)}</Text>
          </View>
        ))
      )}
      <Text style={s.privacy}>
        Counted once per person, when they open the offer. Velocity Rides never shows you who.
      </Text>
    </View>
  );
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function QueriesSection({
  threads,
  loading,
  onOpen,
}: {
  threads: BusinessAdQueryThread[];
  loading: boolean;
  onOpen: (t: BusinessAdQueryThread) => void;
}) {
  const waiting = threads.filter((t) => t.status === 'waiting').length;

  if (loading) {
    return (
      <View style={s.card}>
        <Text style={s.muted}>Loading questions…</Text>
      </View>
    );
  }

  if (threads.length === 0) {
    return (
      <View style={[s.card, s.emptyQueries]}>
        <Text style={s.emptyEmoji}>💬</Text>
        <Text style={s.emptyTitle}>No queries yet</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>
          Everyone who opens your offer can ask you about it. Their questions land
          here and on your phone — answer while they are still nearby.
        </Text>
      </View>
    );
  }

  return (
    <View style={[s.card, { padding: 0, gap: 0 }]}>
      {waiting > 0 ? (
        <View style={s.waitingBanner}>
          <View style={s.waitingDot} />
          <Text style={s.waitingTxt}>
            {waiting} {waiting === 1 ? 'customer is' : 'customers are'} waiting for your answer
          </Text>
        </View>
      ) : null}
      {threads.slice(0, 3).map((t, i, arr) => (
        <QueryRow key={t.queryId} thread={t} last={i === arr.length - 1} onPress={() => onOpen(t)} />
      ))}
    </View>
  );
}

export function QueryRow({
  thread,
  last,
  onPress,
  side = 'business',
}: {
  thread: BusinessAdQueryThread;
  last?: boolean;
  onPress: () => void;
  /** Whose inbox this row sits in. The customer sees the business, not themselves. */
  side?: 'business' | 'customer';
}) {
  const asBusiness = side === 'business';
  const unread = (asBusiness ? thread.ownerUnread : thread.askerUnread) > 0;
  const name = asBusiness ? thread.askerName : thread.businessName;
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const mineLast = thread.lastFrom === (asBusiness ? 'business' : 'customer');
  const blocked = thread.blockedByAdmin || thread.blockedByBusiness || thread.blockedByCustomer;
  // The pill is the thing to act on: the business owes an answer, or the
  // customer has one waiting to be read.
  const pill = blocked ? 'CLOSED' : asBusiness ? (thread.status === 'waiting' ? 'REPLY' : null) : unread ? 'NEW' : null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.qRow, !last && s.qRowBorder, pressed && { opacity: 0.7 }]}
    >
      <View style={[s.avatar, unread && s.avatarUnread]}>
        <Text style={[s.avatarTxt, unread && { color: colors.btnText }]}>{initial}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={s.rowBetween}>
          <Text style={[s.qName, unread && { fontWeight: '900' }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={s.feedTime}>
            {thread.lastMessageAtMs ? timeAgo(thread.lastMessageAtMs / 1000) : ''}
          </Text>
        </View>
        <Text style={s.qOffer} numberOfLines={1}>about “{thread.adTitle}”</Text>
        <View style={s.rowBetween}>
          <Text style={[s.qMsg, unread && { color: colors.text }]} numberOfLines={1}>
            {mineLast ? 'You: ' : ''}
            {thread.lastMessage}
          </Text>
          {pill ? (
            <View style={[s.pill, pill === 'CLOSED' && s.pillMuted]}>
              <Text style={[s.pillTxt, pill === 'CLOSED' && { color: colors.muted }]}>{pill}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const s = themed(() => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
    overflow: 'hidden',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },
  subhead: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase' },
  muted: { fontSize: 12, color: colors.muted, fontWeight: '600', lineHeight: 18 },
  mutedStrong: { fontSize: 12, color: colors.text, fontWeight: '800' },

  funnelCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  funnelRow: { flexDirection: 'row', gap: 8 },
  funnelStep: { flex: 1, gap: 1 },
  funnelLabel: { fontSize: 10, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },
  funnelValue: { fontSize: 26, fontWeight: '900', color: colors.text },
  funnelHint: { fontSize: 10, fontWeight: '700', color: colors.muted },
  funnelFoot: { fontSize: 11, fontWeight: '700', color: colors.muted },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.glassChip, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },

  seenHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eyeBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeTxt: { fontSize: 22 },
  seenBig: { fontSize: 28, fontWeight: '900', color: colors.text },
  seenUnit: { fontSize: 15, fontWeight: '800', color: colors.muted },

  bars: { flexDirection: 'row', gap: 6, height: 96, alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  barNum: { fontSize: 9, fontWeight: '800', color: colors.muted, height: 12 },
  barTrack: {
    flex: 1,
    width: '100%',
    borderRadius: 6,
    backgroundColor: colors.glassChip,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 6, backgroundColor: colors.primary },
  barDay: { fontSize: 9, fontWeight: '700', color: colors.muted },

  offerName: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.text },

  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  feedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  feedTxt: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.muted },
  feedOffer: { color: colors.text, fontWeight: '800' },
  feedTime: { fontSize: 10, fontWeight: '700', color: colors.muted },
  privacy: { fontSize: 10, fontWeight: '600', color: colors.muted, lineHeight: 15, marginTop: 2 },

  emptyQueries: { alignItems: 'center', paddingVertical: 22 },
  emptyEmoji: { fontSize: 30 },
  emptyTitle: { fontSize: 15, fontWeight: '900', color: colors.text },

  waitingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.glassLime,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassLimeBorder,
  },
  waitingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  waitingTxt: { fontSize: 12, fontWeight: '800', color: colors.text },

  qRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  qRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.glassChip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarUnread: { backgroundColor: colors.btnBg },
  avatarTxt: { fontSize: 15, fontWeight: '900', color: colors.text },
  qName: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.text },
  qOffer: { fontSize: 11, fontWeight: '700', color: colors.primary },
  qMsg: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.muted },
  pill: {
    borderRadius: 6,
    backgroundColor: colors.btnBg,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  pillTxt: { fontSize: 9, fontWeight: '900', color: colors.btnText, letterSpacing: 0.6 },
  pillMuted: { backgroundColor: colors.glassChip },
}));
