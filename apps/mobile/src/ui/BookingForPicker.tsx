/**
 * "Which gender is this ride for?" — the seat's occupant, named as a gender and
 * sent as a relationship.
 *
 * ── Why the question changed shape ──────────────────────────────────────────
 * It used to be two chips: "Me" / "Someone else". Accurate, and nobody knew
 * what it was for. "Someone else" does not tell a rider that the answer decides
 * which shared cars they are offered and who ends up sitting beside the
 * passenger; it reads as a billing detail. So the question now asks the thing
 * it actually means — the gender of the person who will be in the seat — and
 * answers itself with the booker's own gender, which is the right answer
 * almost every time. A rider booking for themselves taps nothing.
 *
 * ── What goes on the wire, and why it is not a gender ───────────────────────
 * THE CLIENT STILL NEVER SENDS A GENDER. `createTrip` takes `bookedFor`
 * ('self' | 'other') and the server derives the seat's gender from the caller's
 * own verified profile — a field the client fills is a field the client can lie
 * about, and claiming 'female' to be seated in a women's ride is the precise
 * abuse these rules exist to prevent. See backend/functions/src/lib/seatGender.ts.
 *
 * In a two-gender question those are the same answer written two ways: picking
 * your own gender IS 'self', and picking the other one IS 'other'. So this is a
 * presentation change on top of an unchanged, unspoofable wire format — the
 * rider reads a gender, the server receives a relationship.
 *
 * ── When we do not know the booker's gender ─────────────────────────────────
 * Then the mapping has no anchor: there is no "the other one" to point at. The
 * same control falls back to naming the relationship directly and says why,
 * with a way to fix it. An 'unspecified' seat is already the conservative case
 * everywhere downstream.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Text } from './Text';
import { themed } from '../theme';
import type { BookedFor } from '../api/client';

const LIME = '#ccff00';

interface Option {
  value: BookedFor;
  label: string;
  detail: string;
}

/**
 * The two answers, written in the booker's terms.
 *
 * `gender` is the booker's own profile gender, and it decides which option
 * carries which relationship — that mapping is the whole trick, so it lives in
 * one function rather than being inlined at each call site.
 */
function optionsFor(gender: string): { options: Option[]; knowsGender: boolean } {
  if (gender === 'male') {
    return {
      knowsGender: true,
      options: [
        { value: 'self',  label: '♂ A man',   detail: 'That is you — the usual answer' },
        { value: 'other', label: '♀ A woman', detail: 'Booking for a woman: wife, sister, mother, daughter' },
      ],
    };
  }
  if (gender === 'female') {
    return {
      knowsGender: true,
      options: [
        { value: 'self',  label: '♀ A woman', detail: 'That is you — the usual answer' },
        { value: 'other', label: '♂ A man',   detail: 'Booking for a man: husband, brother, father, son' },
      ],
    };
  }
  // No gender on the profile (or "Other"): nothing to take the opposite of.
  return {
    knowsGender: false,
    options: [
      { value: 'self',  label: 'Me',           detail: 'You are the one travelling' },
      { value: 'other', label: 'Someone else', detail: 'Another person is taking this seat' },
    ],
  };
}

export function BookingForPicker({
  value,
  onChange,
  gender,
}: {
  value: BookedFor;
  onChange: (v: BookedFor) => void;
  /** The booker's own profile gender: 'male' | 'female' | anything else. */
  gender: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { options, knowsGender } = optionsFor(gender);
  const selected = options.find((o) => o.value === value) ?? options[0]!;

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.field, pressed && { opacity: 0.85 }]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`This ride is for ${selected.label}. Tap to change.`}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldValue} numberOfLines={1}>{selected.label}</Text>
          <Text style={styles.fieldHint} numberOfLines={1}>
            {value === 'self' ? 'Booking for yourself' : 'Booking for someone else'}
          </Text>
        </View>
        <Text style={styles.caret}>▾</Text>
      </Pressable>

      {/* The consequence, stated before the ride is booked rather than after.
          A seat booked for somebody else is never seated instantly in a
          single-gender car — it is vetted, and anyone already aboard can
          refuse it. Riders should know that is coming. */}
      {value === 'other' ? (
        <Text style={styles.note}>
          We will match this ride for them, not for you. The riders already in a car are told
          the seat was booked for someone else, and they can decline it.
        </Text>
      ) : null}

      {!knowsGender ? (
        <Pressable onPress={() => router.push('/passenger/profile')}>
          <Text style={styles.genderHint}>
            Add your gender on your profile and this becomes a straight male/female choice →
          </Text>
        </Pressable>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>
              {knowsGender ? 'Which gender is this ride for?' : 'Who is this ride for?'}
            </Text>
            <Text style={styles.sheetBody}>
              It decides which shared cars this seat can go in, and who can sit beside the
              passenger.
            </Text>

            {options.map((opt) => {
              const on = opt.value === value;
              return (
                <Pressable
                  key={opt.value}
                  style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { opacity: 0.85 }]}
                  onPress={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <View style={[styles.radio, on && styles.radioOn]}>
                    {on ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{opt.label}</Text>
                    <Text style={styles.rowDetail}>{opt.detail}</Text>
                  </View>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  fieldValue: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  fieldHint: { color: '#8f9694', fontSize: 11, fontWeight: '600', marginTop: 1 },
  caret: { color: LIME, fontSize: 15, fontWeight: '900' },

  note: { color: '#8f9694', fontSize: 11, fontWeight: '600', lineHeight: 15, marginTop: 6 },
  genderHint: { color: LIME, fontSize: 11, fontWeight: '700', lineHeight: 15, marginTop: 6 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#151917',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 34,
    gap: 9,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginBottom: 6,
  },
  sheetTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  sheetBody: { color: '#9aa2a0', fontSize: 12.5, fontWeight: '600', lineHeight: 17, marginBottom: 4 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  rowOn: { borderColor: LIME, backgroundColor: 'rgba(204,255,0,0.12)' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: LIME },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: LIME },
  rowLabel: { color: '#9aa2a0', fontSize: 15, fontWeight: '900' },
  rowLabelOn: { color: '#ffffff' },
  rowDetail: { color: '#7d8482', fontSize: 11.5, fontWeight: '600', marginTop: 2, lineHeight: 15 },
}));
