import { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  TextInput as RNTextInput,
  Image,
} from 'react-native';
import { Text, TextInput } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../../../src/auth/AuthContext';
import { api } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { pickChatPhoto, uploadImageAttachment } from '../../../src/chat/attachments';

interface Photo {
  url: string;
  uploadedAt: number;
}

export default function ComposeSpecialRidesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Car details
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [licensePlate, setLicensePlate] = useState('');
  const [color, setColor] = useState('');
  const [seatsCount, setSeatsCount] = useState('4');
  const [transmissionType, setTransmissionType] = useState<'manual' | 'automatic'>('automatic');
  const [mileage, setMileage] = useState('');

  // Location & Pricing
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [pricePerDay, setPricePerDay] = useState('');
  const [instructions, setInstructions] = useState('');

  // Contact
  const [ownerName, setOwnerName] = useState(user?.displayName ?? '');
  const [ownerPhone, setOwnerPhone] = useState('');

  // Photos
  const [photos, setPhotos] = useState<Photo[]>([]);

  async function addPhoto() {
    if (!user?.uid) return;
    setUploadingPhoto(true);
    try {
      const picked = await pickChatPhoto();
      if (!picked) return;

      const attachment = await uploadImageAttachment(user.uid, picked);
      setPhotos([...photos, { url: attachment.url, uploadedAt: Date.now() }]);
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  }

  function removePhoto(index: number) {
    setPhotos(photos.filter((_, i) => i !== index));
  }

  async function submit() {
    if (!make.trim()) {
      Alert.alert('Missing', 'Enter car make');
      return;
    }
    if (!model.trim()) {
      Alert.alert('Missing', 'Enter car model');
      return;
    }
    if (!licensePlate.trim()) {
      Alert.alert('Missing', 'Enter license plate');
      return;
    }
    if (!pricePerDay || parseInt(pricePerDay) < 500 || parseInt(pricePerDay) > 10000) {
      Alert.alert('Invalid', 'Price must be between 500 and 10,000 PKR');
      return;
    }
    if (!city.trim()) {
      Alert.alert('Missing', 'Enter city');
      return;
    }
    if (!ownerPhone.trim()) {
      Alert.alert('Missing', 'Enter contact phone');
      return;
    }
    if (photos.length === 0) {
      Alert.alert('No Photos', 'Please add at least one photo of your car to help customers.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.submitSpecialRidesApplication({
        carDetails: {
          make: make.trim(),
          model: model.trim(),
          year: parseInt(year),
          licensePlate: licensePlate.trim(),
          color: color.trim(),
          seatsCount: parseInt(seatsCount),
          transmissionType,
          mileage: parseInt(mileage) || 0,
          features: [],
        },
        location: {
          lat: 0,
          lng: 0,
          address: address.trim(),
          city: city.trim(),
        },
        pricePerDay: parseInt(pricePerDay),
        photos,
        documentUrls: {
          insuranceProof: '', // TODO: integrate document upload
          vehicleRegistration: '',
        },
        ownerName: ownerName.trim(),
        ownerPhone: ownerPhone.trim(),
        instructions: instructions.trim() || undefined,
      });

      if (res.ok) {
        Alert.alert('Success ✅', 'Your car listing has been submitted for review. Check back soon!');
        router.replace('/passenger/special-rides');
      }
    } catch (e: unknown) {
      Alert.alert('Error', (e as { message?: string }).message ?? 'Failed to submit');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backButton}>←</Text>
        </Pressable>
        <Text style={styles.title}>Post Your Car</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Vehicle Details</Text>
        <TextInput
          placeholder="Make (e.g., Toyota)"
          value={make}
          onChangeText={setMake}
          editable={!loading}
          style={styles.input}
        />
        <TextInput
          placeholder="Model (e.g., Corolla)"
          value={model}
          onChangeText={setModel}
          editable={!loading}
          style={styles.input}
        />
        <View style={styles.row}>
          <TextInput
            placeholder="Year"
            value={year}
            onChangeText={setYear}
            editable={!loading}
            style={[styles.input, { flex: 1 }]}
            keyboardType="number-pad"
          />
          <TextInput
            placeholder="Seats"
            value={seatsCount}
            onChangeText={setSeatsCount}
            editable={!loading}
            style={[styles.input, { flex: 1, marginLeft: 8 }]}
            keyboardType="number-pad"
          />
        </View>
        <TextInput
          placeholder="License Plate"
          value={licensePlate}
          onChangeText={setLicensePlate}
          editable={!loading}
          style={styles.input}
        />
        <TextInput
          placeholder="Color"
          value={color}
          onChangeText={setColor}
          editable={!loading}
          style={styles.input}
        />
        <TextInput
          placeholder="Mileage (km)"
          value={mileage}
          onChangeText={setMileage}
          editable={!loading}
          keyboardType="number-pad"
          style={styles.input}
        />

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Transmission</Text>
        <View style={styles.row}>
          <Pressable
            style={[
              styles.toggleButton,
              transmissionType === 'manual' && styles.toggleButtonActive,
            ]}
            onPress={() => setTransmissionType('manual')}
            disabled={loading}
          >
            <Text
              style={[
                styles.toggleText,
                transmissionType === 'manual' && styles.toggleTextActive,
              ]}
            >
              Manual
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.toggleButton,
              transmissionType === 'automatic' && styles.toggleButtonActive,
              { marginLeft: 8 },
            ]}
            onPress={() => setTransmissionType('automatic')}
            disabled={loading}
          >
            <Text
              style={[
                styles.toggleText,
                transmissionType === 'automatic' && styles.toggleTextActive,
              ]}
            >
              Automatic
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Location & Pricing</Text>
        <TextInput
          placeholder="City"
          value={city}
          onChangeText={setCity}
          editable={!loading}
          style={styles.input}
        />
        <TextInput
          placeholder="Address/Area"
          value={address}
          onChangeText={setAddress}
          editable={!loading}
          style={styles.input}
        />
        <TextInput
          placeholder="Price per day (₨)"
          value={pricePerDay}
          onChangeText={setPricePerDay}
          editable={!loading}
          keyboardType="number-pad"
          style={styles.input}
        />

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Your Details</Text>
        <TextInput
          placeholder="Full name"
          value={ownerName}
          onChangeText={setOwnerName}
          editable={!loading}
          style={styles.input}
        />
        <TextInput
          placeholder="Contact phone"
          value={ownerPhone}
          onChangeText={setOwnerPhone}
          editable={!loading}
          keyboardType="phone-pad"
          style={styles.input}
        />

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Car Photos</Text>
        <Pressable
          style={[styles.addPhotoButton, uploadingPhoto && styles.addPhotoButtonDisabled]}
          onPress={addPhoto}
          disabled={loading || uploadingPhoto}
        >
          {uploadingPhoto ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Text style={styles.addPhotoButtonText}>📷 Add Photo {photos.length > 0 ? `(${photos.length})` : ''}</Text>
          )}
        </Pressable>

        {photos.length > 0 && (
          <View style={styles.photosGrid}>
            {photos.map((photo, index) => (
              <View key={index} style={styles.photoContainer}>
                <Image source={{ uri: photo.url }} style={styles.photoImage} />
                <Pressable
                  style={styles.removePhotoButton}
                  onPress={() => removePhoto(index)}
                  disabled={loading || uploadingPhoto}
                >
                  <Text style={styles.removePhotoButtonText}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Instructions (Optional)</Text>
        <RNTextInput
          placeholder="Pickup location, house rules, special instructions..."
          value={instructions}
          onChangeText={setInstructions}
          editable={!loading}
          multiline
          numberOfLines={4}
          style={[styles.input, styles.multilineInput]}
        />

        <Pressable
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={submit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.submitButtonText}>Submit for Review</Text>
          )}
        </Pressable>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backButton: {
      fontSize: 24,
      color: colors.primary,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    content: {
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 12,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 10,
      color: colors.text,
    },
    multilineInput: {
      textAlignVertical: 'top',
      paddingTop: 12,
      minHeight: 100,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 10,
    },
    toggleButton: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      alignItems: 'center',
    },
    toggleButtonActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    toggleText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.muted,
    },
    toggleTextActive: {
      color: '#fff',
    },
    submitButton: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: colors.primary,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 20,
    },
    submitButtonDisabled: {
      opacity: 0.5,
    },
    submitButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
    },
    addPhotoButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 8,
      alignItems: 'center',
      marginBottom: 12,
      borderStyle: 'dashed',
    },
    addPhotoButtonDisabled: {
      opacity: 0.5,
    },
    addPhotoButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
    },
    photosGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    photoContainer: {
      position: 'relative',
      width: '48%',
      aspectRatio: 1,
    },
    photoImage: {
      width: '100%',
      height: '100%',
      borderRadius: 8,
    },
    removePhotoButton: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 28,
      height: 28,
      backgroundColor: '#000',
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: 0.8,
    },
    removePhotoButtonText: {
      fontSize: 16,
      color: '#fff',
      fontWeight: '700',
    },
  })
);
