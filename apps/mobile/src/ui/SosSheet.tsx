/**
 * The SOS sheet — what happens in the ten seconds after the button is pressed.
 *
 * Opening it IS the alarm. There is no "are you sure" in front of it: the sheet
 * appears already working, because a confirmation dialog in a panic is one more
 * thing to read with shaking hands, and the three things it starts are all
 * recoverable — our safety desk is told (we would rather investigate a false
 * alarm than miss a real one), a location fix is taken, and WhatsApp opens with
 * a message the user still has to press send on.
 *
 * Nothing here can be sent without the user. WhatsApp has no way to send on
 * somebody's behalf, and that is deliberate on our side too — see the header of
 * src/lib/sos.ts for why the message must leave from the rider's own number
 * rather than from Velocity's. So the sheet is a worklist: it opens the first
 * contact itself, and the rest are one press each, in order, with the ones
 * already done marked so a frightened person does not lose their place.
 *
 * ── THE ORDER OF THE BUTTONS IS THE DESIGN ─────────────────────────────────
 *
 * Police first, family second, us last. Velocity cannot stop an assault and a
 * brother twenty minutes away cannot either; 15 can. Putting our own desk at
 * the top of an emergency screen would be flattering and wrong.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';

import { Text } from './Text';
import { api } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';
import { tripWatchUrl } from '../share/links';
import { useAuth } from '../auth/AuthContext';
import { useEmergencyContacts } from '../hooks/emergencyContacts';
import {
  POLICE_HELPLINE,
  buildSosMessage,
  formatPhone,
  smsAllUrl,
  whatsAppChatUrls,
  type EmergencyContact,
} from '../lib/sos';
import type { Trip } from '../domain/types';

/**
 * How long the message waits for a live-tracking link before going without one.
 *
 * The link is the best thing in the message — it keeps telling the family where
 * the car is after the message is read — but it is a network round trip, and an
 * SOS that sits on a spinner because the signal is bad has failed at the only
 * job it has. Two and a half seconds, then send what we have.
 */
const WATCH_LINK_BUDGET_MS = 2500;

/** Statuses where a watch link can still be minted (mirrors trips/watch.ts). */
const LIVE_STATUSES = ['requested', 'matched', 'arriving', 'arrived', 'in_progress'];

export interface SosSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The live ride, when the SOS was raised from one. */
  trip: Trip | null;
  /** Last known position — warmed by the Safety Centre before the press. */
  coords: { lat: number; lng: number } | null;
  address: string | null;
}

export function SosSheet({ visible, onClose, trip, coords, address }: SosSheetProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { contacts, loading: contactsLoading } = useEmergencyContacts(user?.uid);

  const [message, setMessage] = useState<string | null>(null);
  const [deskAlerted, setDeskAlerted] = useState<'pending' | 'done' | 'failed' | 'n/a'>('pending');
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  /** One alarm per opening of the sheet, however many times React re-renders. */
  const firedFor = useRef<string | null>(null);
  /** And one automatic WhatsApp, however many snapshots land while it is open. */
  const autoOpened = useRef(false);

  /**
   * Everything the alarm reads, as of the last render.
   *
   * THIS REF IS WHY THE SHEET DOES NOT HANG. The alarm is one long async run —
   * tell the desk, mint a tracking link, build the message — and all four of
   * its inputs change on their own while it is running: a GPS fix lands, the
   * driver's position writes to the trip document every few seconds, the
   * contacts snapshot arrives. If any of them were effect dependencies, React
   * would tear the run down mid-flight, the `cancelled` guard would swallow
   * the result, and the re-run would stop at the "already fired" guard — a
   * sheet stuck on "Getting your location…" forever, during an emergency.
   *
   * So the alarm depends only on *whether it should fire*, and reads the facts
   * through here. It also means the desk is told what we actually knew at the
   * moment of the press, which is the honest thing to put in the alert.
   */
  const latest = useRef({ trip, coords, address, contacts, contactsLoading, user });
  useEffect(() => {
    latest.current = { trip, coords, address, contacts, contactsLoading, user };
  });

  const openChat = useCallback(async (contact: EmergencyContact, text: string) => {
    const { app, web } = whatsAppChatUrls(contact.phone, text);
    try {
      await Linking.openURL(app);
      setOpened((prev) => ({ ...prev, [contact.id]: true }));
    } catch {
      try {
        await Linking.openURL(web);
        setOpened((prev) => ({ ...prev, [contact.id]: true }));
      } catch {
        Alert.alert(
          'WhatsApp would not open',
          `Call ${contact.name} on ${formatPhone(contact.phone)}, or use "Send to everyone by SMS".`,
        );
      }
    }
  }, []);

  const tripId = trip?.id ?? null;

  useEffect(() => {
    if (!visible) {
      firedFor.current = null;
      autoOpened.current = false;
      return;
    }
    // Keyed on the ride so re-opening the sheet on a different trip re-arms it.
    const key = tripId ?? 'no-trip';
    if (firedFor.current === key) return;
    firedFor.current = key;

    // Read once, at the moment of the press. See the comment on `latest`.
    const seen = latest.current;
    const ride = seen.trip;
    const live = !!ride && LIVE_STATUSES.includes(ride.status);

    setMessage(null);
    setOpened({});
    setWatchUrl(null);
    setDeskAlerted(live ? 'pending' : 'n/a');

    let cancelled = false;

    void (async () => {
      // Our desk, in parallel with everything else. It needs a live ride to
      // attach to — off a ride there is nothing for the desk to open, and the
      // sheet says so rather than pretending somebody was told.
      if (ride && live) {
        // Whether anybody outside Velocity knows is the first thing a desk
        // operator needs: an SOS from someone with no emergency contacts is an
        // isolated person, and that changes how hard we chase it.
        const n = seen.contacts.length;
        const who = seen.contactsLoading
          ? 'Their emergency contacts are being messaged from their own WhatsApp.'
          : n === 0
            ? 'They have NO emergency contacts — nobody outside Velocity has been told.'
            : `They are messaging ${n} emergency contact${n === 1 ? '' : 's'} from their own WhatsApp.`;
        void api
          .raiseSafetyEvent({
            tripId: ride.id,
            kind: 'sos',
            note: `SOS pressed in the Safety Centre. ${who}`,
            ...(seen.coords ? { location: seen.coords } : {}),
          })
          .then(() => !cancelled && setDeskAlerted('done'))
          .catch(() => !cancelled && setDeskAlerted('failed'));
      }

      // The live-tracking link, on a timer it is allowed to lose.
      let link: string | null = null;
      if (ride && live) {
        link = await Promise.race([
          api
            .createTripWatchLink({ tripId: ride.id })
            .then((r) => tripWatchUrl(r.token))
            .catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), WATCH_LINK_BUDGET_MS)),
        ]);
      }
      if (cancelled) return;
      setWatchUrl(link);

      // The freshest facts, not the ones from the press: a GPS fix that landed
      // during those couple of seconds belongs in the message.
      const now = latest.current;
      setMessage(
        buildSosMessage({
          sender: { name: now.user?.displayName, phone: now.user?.phoneNumber },
          when: new Date(),
          location: now.coords ? { ...now.coords, address: now.address } : null,
          watchUrl: link,
          trip: ride
            ? {
                id: ride.id,
                status: ride.status,
                pickup: ride.pickup?.address ?? null,
                dropoff: ride.dropoff?.address ?? null,
                driverName: ride.driverInfo?.displayName ?? null,
                driverPhone: ride.driverPhone ?? null,
                vehicle: ride.driverInfo?.vehicleLabel ?? null,
                plate: ride.driverInfo?.plate ?? null,
              }
            : null,
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, tripId]);

  /**
   * Open the first contact's WhatsApp ourselves, once.
   *
   * Separate from the alarm above because it depends on something the alarm
   * refuses to wait for: the contact list arriving from Firestore. Telling our
   * desk must not queue behind a read, but the first WhatsApp has nowhere to go
   * until the list is there — and on a cold screen that read can land after the
   * press. `autoOpened` makes sure this happens exactly once per SOS, so a
   * second snapshot does not throw the user back into WhatsApp.
   */
  useEffect(() => {
    if (!visible || !message || contactsLoading || autoOpened.current) return;
    const first = contacts[0];
    if (!first) return;
    autoOpened.current = true;
    // Leaving for another app IS the external system this effect synchronises
    // with; the state it sets afterwards is the row's "opened" tick, and it is
    // set after the await, not during this render pass.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opens WhatsApp, then marks the row
    void openChat(first, message);
  }, [visible, message, contacts, contactsLoading, openChat]);

  /** Dial 15. No confirmation — see the Safety Centre header. */
  function callPolice() {
    Linking.openURL(`tel:${POLICE_HELPLINE}`).catch(() =>
      Alert.alert('Could not start the call', `Dial ${POLICE_HELPLINE} from your phone app.`),
    );
    if (trip) {
      void api
        .raiseSafetyEvent({
          tripId: trip.id,
          kind: 'police_called',
          note: 'The rider dialled 15 from the SOS sheet.',
        })
        .catch(() => {
          /* The call is what matters. */
        });
    }
  }

  function smsEveryone() {
    if (!message || contacts.length === 0) return;
    const url = smsAllUrl(
      contacts.map((c) => c.phone),
      message,
      Platform.OS,
    );
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not open Messages', 'Use the WhatsApp buttons instead.'),
    );
  }

  async function copyMessage() {
    if (!message) return;
    await Clipboard.setStringAsync(message);
    Alert.alert('Copied', 'Paste it anywhere — any chat, any group.');
  }

  const working = message === null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.titleRow}>
            <Text style={styles.title}>🆘 SOS</Text>
            {working ? <ActivityIndicator color={colors.danger} /> : null}
          </View>
          <Text style={styles.subtitle}>
            {working
              ? 'Getting your location and your ride details…'
              : 'Your message is ready. Press send in WhatsApp for each person.'}
          </Text>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* ── 1. The police. First, always. ── */}
            <Pressable
              style={styles.policeBtn}
              onPress={callPolice}
              accessibilityRole="button"
              accessibilityLabel={`Call police, ${POLICE_HELPLINE}`}
            >
              <Text style={styles.policeIcon}>🚨</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.policeTitle}>Call police {POLICE_HELPLINE}</Text>
                <Text style={styles.policeSub}>Dials straight away. We are told too.</Text>
              </View>
            </Pressable>

            {/* ── 2. The family. ── */}
            <Text style={styles.sectionTitle}>Your emergency contacts</Text>

            {contactsLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 14 }} />
            ) : contacts.length === 0 ? (
              <View style={styles.noContacts}>
                <Text style={styles.noContactsTxt}>
                  You have not added anyone yet, so there is nobody to alert. The police button
                  above still works.
                </Text>
                <Pressable
                  style={styles.addBtn}
                  accessibilityRole="button"
                  onPress={() => {
                    onClose();
                    router.push('/safety-contacts');
                  }}
                >
                  <Text style={styles.addBtnTxt}>Add emergency contacts</Text>
                </Pressable>
              </View>
            ) : (
              contacts.map((c, i) => {
                const done = !!opened[c.id];
                return (
                  <Pressable
                    key={c.id}
                    style={[styles.contactRow, done && styles.contactRowDone]}
                    disabled={working}
                    onPress={() => message && void openChat(c, message)}
                    accessibilityRole="button"
                    accessibilityLabel={`WhatsApp ${c.name} your location${done ? ', already opened' : ''}`}
                  >
                    <Text style={styles.contactIdx}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{c.name}</Text>
                      <Text style={styles.contactPhone}>{formatPhone(c.phone)}</Text>
                    </View>
                    <Text style={[styles.contactAction, done && styles.contactActionDone]}>
                      {done ? 'Opened · again' : 'WhatsApp'}
                    </Text>
                  </Pressable>
                );
              })
            )}

            {contacts.length > 0 ? (
              <>
                <Pressable
                  style={styles.secondaryBtn}
                  disabled={working}
                  onPress={smsEveryone}
                  accessibilityRole="button"
                  accessibilityLabel="Send to everyone by SMS, works without internet"
                >
                  <Text style={styles.secondaryTxt}>
                    ✉️ Send to everyone by SMS (works without internet)
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryBtn}
                  disabled={working}
                  onPress={() => void copyMessage()}
                  accessibilityRole="button"
                  accessibilityLabel="Copy the message"
                >
                  <Text style={styles.secondaryTxt}>📋 Copy the message</Text>
                </Pressable>
              </>
            ) : null}

            {/* ── 3. What has already happened without the user doing anything. ── */}
            <Text style={styles.sectionTitle}>Already done for you</Text>
            <View style={styles.statusCard}>
              <StatusLine
                ok={deskAlerted === 'done'}
                pending={deskAlerted === 'pending'}
                text={
                  deskAlerted === 'done'
                    ? 'Velocity safety desk alerted — they can see your ride'
                    : deskAlerted === 'pending'
                      ? 'Alerting the Velocity safety desk…'
                      : deskAlerted === 'failed'
                        ? 'Could not reach the Velocity desk — call us after the police'
                        : 'No live ride, so there is nothing for our desk to open'
                }
              />
              <StatusLine
                ok={!!coords}
                pending={false}
                text={
                  coords
                    ? `Location captured${address ? ` — ${address}` : ''}`
                    : 'No GPS fix yet — the message says so instead of guessing'
                }
              />
              <StatusLine
                ok={!!watchUrl}
                pending={working && !!trip}
                text={
                  watchUrl
                    ? 'Live tracking link attached to the message'
                    : trip
                      ? 'No live link — the message still carries the car and the plate'
                      : 'Not on a ride, so there is no trip to track'
                }
              />
            </View>

            {message ? (
              <View style={styles.preview}>
                <Text style={styles.previewTitle}>What they will receive</Text>
                <Text style={styles.previewBody}>{message}</Text>
              </View>
            ) : null}
          </ScrollView>

          <Pressable style={styles.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.closeTxt}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function StatusLine({ ok, pending, text }: { ok: boolean; pending: boolean; text: string }) {
  return (
    <View style={styles.statusLine}>
      <Text style={[styles.statusMark, ok && styles.statusMarkOk]}>
        {ok ? '✓' : pending ? '…' : '•'}
      </Text>
      <Text style={styles.statusTxt}>{text}</Text>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
    sheet: {
      maxHeight: '92%',
      backgroundColor: colors.background,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderTopWidth: 3,
      borderColor: colors.danger,
      paddingTop: 8,
    },
    grabber: {
      alignSelf: 'center',
      width: 42,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: 8,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 18,
    },
    title: { fontSize: 22, fontWeight: '900', color: colors.danger },
    subtitle: {
      fontSize: 12.5,
      color: colors.muted,
      lineHeight: 18,
      paddingHorizontal: 18,
      marginTop: 2,
    },
    body: { padding: 16, paddingBottom: 8, gap: 9 },

    policeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.danger,
      borderRadius: 16,
      padding: 15,
    },
    policeIcon: { fontSize: 26 },
    policeTitle: { fontSize: 17, fontWeight: '900', color: '#ffffff' },
    policeSub: { fontSize: 12, color: 'rgba(255,255,255,0.88)', marginTop: 1 },

    sectionTitle: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.muted,
      letterSpacing: 0.9,
      textTransform: 'uppercase',
      marginTop: 10,
    },

    noContacts: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 14,
      gap: 10,
    },
    noContactsTxt: { fontSize: 12.5, color: colors.muted, lineHeight: 19 },
    addBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 11,
      alignItems: 'center',
    },
    addBtnTxt: { fontSize: 13.5, fontWeight: '900', color: colors.btnText },

    contactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.card,
      borderWidth: 1.5,
      borderColor: '#25D366',
      borderRadius: 14,
      padding: 13,
    },
    contactRowDone: { borderColor: colors.border, opacity: 0.72 },
    contactIdx: { fontSize: 13, fontWeight: '900', color: colors.muted, width: 14 },
    contactName: { fontSize: 14.5, fontWeight: '800', color: colors.text },
    contactPhone: { fontSize: 12, color: colors.muted, marginTop: 1 },
    contactAction: { fontSize: 12.5, fontWeight: '900', color: '#25D366' },
    contactActionDone: { color: colors.muted },

    secondaryBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      backgroundColor: colors.card,
    },
    secondaryTxt: { fontSize: 12.5, fontWeight: '800', color: colors.text },

    statusCard: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 13,
      gap: 7,
    },
    statusLine: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
    statusMark: { fontSize: 13, fontWeight: '900', color: colors.muted, width: 13 },
    statusMarkOk: { color: colors.primary },
    statusTxt: { flex: 1, fontSize: 12.5, color: colors.muted, lineHeight: 18 },

    preview: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 13,
      marginTop: 4,
    },
    previewTitle: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.muted,
      letterSpacing: 0.9,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    previewBody: { fontSize: 12, color: colors.text, lineHeight: 18 },

    closeBtn: {
      alignItems: 'center',
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    closeTxt: { fontSize: 14, fontWeight: '800', color: colors.muted },
  }),
);
