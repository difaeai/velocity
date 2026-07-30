/**
 * Find your Customers — the offer composer.
 *
 * Two jobs, one screen, keyed off `?adId=`: publish a new offer, or edit one
 * that is already running. Editing exists because an offer with a wrong price in
 * it is worse than no offer, and the alternative — delete and republish — would
 * throw away the numbers the advertiser is paying to accumulate.
 *
 * A new offer is prefilled from the draft that came in with the application.
 * They already typed all of this once to get approved; asking for it again from
 * an empty form would read as the approval having gone nowhere.
 *
 * The preview at the top is the real point of the screen. It is drawn to look
 * like the notification, because that is the only form in which anyone will ever
 * see this offer, and a business owner should be able to judge their own
 * headline against the thing it will actually appear in.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { useBusinessAdDashboard } from '../../../src/hooks/businessAds';
import { uploadBusinessAdImage } from '../../../src/lib/uploadDoc';
import { themed } from '../../../src/theme';
import { Text, TextInput } from '../../../src/ui/Text';
import { PrimaryButton } from '../../../src/ui/components';
import { pickPhoto } from '../../../src/ui/onboarding';
import { Skeleton } from '../../../src/ui/partner';

export default function BusinessAdCompose() {
  const router = useRouter();
  const { user } = useAuth();
  const { adId } = useLocalSearchParams<{ adId?: string }>();
  const { data, loading } = useBusinessAdDashboard();

  const [businessName, setBusinessName] = useState('');
  const [title, setTitle] = useState('');
  const [offerDetails, setOfferDetails] = useState('');
  /** The picture already on the ad (a URL) — replaced only if they pick a new one. */
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [newImageUri, setNewImageUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed once. Re-seeding on every dashboard refresh would wipe whatever they
  // are in the middle of typing.
  useEffect(() => {
    if (seeded || !data) return;
    const editing = adId ? data.ads.find((a) => a.adId === adId) : undefined;
    const source = editing ?? data.advertiser?.draft ?? null;
    if (source) {
      setBusinessName(source.businessName ?? '');
      setTitle(source.title ?? '');
      setOfferDetails(source.offerDetails ?? '');
      setExistingImageUrl(source.imageUrl ?? null);
    } else if (data.advertiser) {
      setBusinessName(data.advertiser.businessName ?? '');
    }
    setSeeded(true);
  }, [data, adId, seeded]);

  const shownImage = newImageUri ?? existingImageUrl;
  const valid =
    businessName.trim().length >= 2 &&
    title.trim().length >= 3 &&
    offerDetails.trim().length >= 5 &&
    !!shownImage;

  async function save() {
    if (!user || !valid) return;
    setSaving(true);
    try {
      let imageUrl = existingImageUrl;
      if (newImageUri) {
        imageUrl = (await uploadBusinessAdImage(user.uid, newImageUri)).url;
      }
      if (!imageUrl) throw new Error('Add a picture for your offer.');

      const creative = {
        title: title.trim(),
        businessName: businessName.trim(),
        offerDetails: offerDetails.trim(),
        imageUrl,
      };

      if (adId) {
        await api.updateBusinessAd({ adId, creative });
      } else {
        await api.createBusinessAd({ creative });
      }

      router.replace('/passenger/business-ads');
      Alert.alert(
        adId ? 'Offer updated' : 'Offer published 🎉',
        adId
          ? 'Your changes are live — the next notification carries them.'
          : 'People inside your radius will start getting it on their phones.',
      );
    } catch (e) {
      Alert.alert('Could not save', (e as { message?: string }).message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  const radiusKm = data?.advertiser?.radiusKm;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{adId ? 'Edit offer' : 'Publish your offer'}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading && !data ? (
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={160} />
          <Skeleton height={90} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* What the notification will look like on someone's phone. */}
          <Text style={styles.sectionLabel}>HOW PEOPLE WILL SEE IT</Text>
          <View style={styles.notifCard}>
            <View style={styles.notifTop}>
              <View style={styles.notifAppIcon}>
                <Text style={styles.notifAppIconTxt}>V</Text>
              </View>
              <Text style={styles.notifApp}>Velocity · now</Text>
            </View>
            <Text style={styles.notifTitle} numberOfLines={1}>
              {(businessName.trim() || 'Your business') + ': ' + (title.trim() || 'Your offer title')}
            </Text>
            <Text style={styles.notifBody} numberOfLines={3}>
              {offerDetails.trim() || 'Your offer details appear here.'}
            </Text>
            {shownImage ? (
              <Image source={{ uri: shownImage }} style={styles.notifImage} />
            ) : (
              <View style={[styles.notifImage, styles.notifImageEmpty]}>
                <Text style={styles.notifImageEmptyTxt}>Your picture</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionLabel}>OFFER PICTURE</Text>
          <Pressable style={styles.photoPicker} onPress={() => pickPhoto(setNewImageUri)}>
            {shownImage ? (
              <>
                <Image source={{ uri: shownImage }} style={styles.photo} />
                <View style={styles.photoOverlay}>
                  <Text style={styles.photoOverlayTxt}>Tap to change</Text>
                </View>
              </>
            ) : (
              <View style={styles.photoEmpty}>
                <Text style={styles.photoEmptyIcon}>🖼️</Text>
                <Text style={styles.photoEmptyTxt}>Add a picture</Text>
              </View>
            )}
          </Pressable>

          <Text style={styles.sectionLabel}>OFFER</Text>
          <View style={styles.inputCard}>
            <TextInput
              style={styles.field}
              placeholder="Business name"
              placeholderTextColor={colors.muted}
              value={businessName}
              onChangeText={setBusinessName}
              maxLength={80}
            />
            <View style={styles.divider} />
            <TextInput
              style={styles.field}
              placeholder="Offer title — e.g. Buy 1 get 1 free"
              placeholderTextColor={colors.muted}
              value={title}
              onChangeText={setTitle}
              maxLength={80}
            />
          </View>

          <TextInput
            style={styles.textarea}
            placeholder="Offer details — what's included, and until when"
            placeholderTextColor={colors.muted}
            value={offerDetails}
            onChangeText={setOfferDetails}
            multiline
            maxLength={600}
          />
          <Text style={styles.counter}>{offerDetails.length}/600</Text>

          {radiusKm ? (
            <Text style={styles.reachNote}>
              Goes to Velocity users within {radiusKm} km of your business.
            </Text>
          ) : null}

          <PrimaryButton
            label={saving ? 'Saving…' : adId ? 'Save changes' : 'Publish offer'}
            loading={saving}
            disabled={!valid || saving}
            onPress={save}
          />
          {!valid ? (
            <Text style={styles.blockerHint}>
              Needed: a picture, your business name, an offer title and the details.
            </Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { fontSize: 22, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  body: { padding: 16, paddingBottom: 44, gap: 10 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.6,
    marginTop: 6,
  },

  notifCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 6,
  },
  notifTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notifAppIcon: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifAppIconTxt: { fontSize: 11, fontWeight: '900', color: '#000' },
  notifApp: { fontSize: 10, fontWeight: '700', color: colors.muted },
  notifTitle: { fontSize: 14, fontWeight: '900', color: colors.text },
  notifBody: { fontSize: 12, fontWeight: '600', color: colors.muted, lineHeight: 17 },
  notifImage: { width: '100%', height: 130, borderRadius: 10, marginTop: 4 },
  notifImageEmpty: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifImageEmptyTxt: { fontSize: 11, fontWeight: '700', color: colors.muted },

  photoPicker: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: 170 },
  photoOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  photoOverlayTxt: { fontSize: 11, fontWeight: '800', color: '#fff' },
  photoEmpty: { height: 140, alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoEmptyIcon: { fontSize: 26 },
  photoEmptyTxt: { fontSize: 13, fontWeight: '800', color: colors.text },

  inputCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  field: { height: 48, paddingHorizontal: 16, fontSize: 14, fontWeight: '600', color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 16 },
  textarea: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    height: 100,
    textAlignVertical: 'top',
  },
  counter: { fontSize: 10, fontWeight: '700', color: colors.muted, textAlign: 'right' },
  reachNote: { fontSize: 11, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  blockerHint: { fontSize: 11, color: colors.muted, fontWeight: '600', textAlign: 'center' },
}));
