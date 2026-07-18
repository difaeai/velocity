import React, { createContext, useContext, useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { uploadDriverDoc } from '../lib/uploadDoc';
import { api } from '../api/client';
import type { RideType } from '../domain/types';

export type SectionKey = 'basic' | 'license' | 'cnic' | 'vehicle';

export interface OnboardingData {
  photo: string | null;
  firstName: string;
  lastName: string;
  dob: string;
  email: string;
  licensePhoto: string | null;
  licenseExpiry: string;
  cnicFront: string | null;
  cnicBack: string | null;
  cnicNumber: string;
  cnicExpiry: string;
  vehicleType: RideType | null;
  vehicleMake: string;
  color: string;
  plate: string;
  vehicleDoc: string | null;
  vehicleDocExpiry: string;
  /** Required: front of the vehicle with the number plate clearly visible. */
  vehiclePhoto: string | null;
  /** Optional extra angles of the vehicle. */
  vehiclePhotos: string[];
}

const EMPTY: OnboardingData = {
  photo: null,
  firstName: '',
  lastName: '',
  dob: '',
  email: '',
  licensePhoto: null,
  licenseExpiry: '',
  cnicFront: null,
  cnicBack: null,
  cnicNumber: '',
  cnicExpiry: '',
  vehicleType: null,
  vehicleMake: '',
  color: '',
  plate: '',
  vehicleDoc: null,
  vehicleDocExpiry: '',
  vehiclePhoto: null,
  vehiclePhotos: [],
};

const CNIC_RE = /^\d{5}-\d{7}-\d$/;

interface OnboardingState {
  data: OnboardingData;
  set: (patch: Partial<OnboardingData>) => void;
  complete: Record<SectionKey, boolean>;
  allComplete: boolean;
  submitting: boolean;
  error: string | null;
  submit: () => Promise<boolean>;
}

const OnboardingContext = createContext<OnboardingState | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { user, refreshRole } = useAuth();
  const [data, setData] = useState<OnboardingData>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete: Record<SectionKey, boolean> = {
    basic: !!data.photo && data.firstName.trim().length > 0 && data.lastName.trim().length > 0,
    license: !!data.licensePhoto,
    cnic: !!data.cnicFront && !!data.cnicBack && CNIC_RE.test(data.cnicNumber),
    vehicle:
      !!data.vehicleType &&
      data.vehicleMake.trim().length > 0 &&
      data.color.trim().length > 0 &&
      data.plate.trim().length > 2 &&
      !!data.vehicleDoc &&
      !!data.vehiclePhoto,
  };
  const allComplete = Object.values(complete).every(Boolean);

  async function submit(): Promise<boolean> {
    if (!user || !allComplete) return false;
    setSubmitting(true);
    setError(null);
    try {
      const uid = user.uid;
      const [licenseResult, cnicResult, cnicBackResult, vehicleDocResult, photoResult, vehiclePhotoResult] =
        await Promise.all([
          uploadDriverDoc(uid, 'license',       data.licensePhoto!),
          uploadDriverDoc(uid, 'cnic-front',    data.cnicFront!),
          uploadDriverDoc(uid, 'cnic-back',     data.cnicBack!),
          uploadDriverDoc(uid, 'vehicle',       data.vehicleDoc!),
          uploadDriverDoc(uid, 'photo',         data.photo!),
          uploadDriverDoc(uid, 'vehicle-photo', data.vehiclePhoto!),
        ]);

      const extraResults = await Promise.all(
        data.vehiclePhotos.map((uri, i) => uploadDriverDoc(uid, `vehicle-photo-${i + 1}`, uri)),
      );

      await api.submitDriverOnboarding({
        fullName:           `${data.firstName} ${data.lastName}`.trim(),
        cnic:               data.cnicNumber,
        vehicleType:        data.vehicleType!,
        vehicleLabel:       `${data.color} ${data.vehicleMake}`.trim(),
        plate:              data.plate.trim().toUpperCase(),
        licenseDocPath:     licenseResult.path,
        licenseDocUrl:      licenseResult.url,
        cnicDocPath:        cnicResult.path,
        cnicDocUrl:         cnicResult.url,
        cnicBackDocPath:    cnicBackResult.path,
        cnicBackDocUrl:     cnicBackResult.url,
        vehicleDocPath:     vehicleDocResult.path,
        vehicleDocUrl:      vehicleDocResult.url,
        photoDocPath:       photoResult.path,
        photoDocUrl:        photoResult.url,
        vehiclePhotoDocPath: vehiclePhotoResult.path,
        vehiclePhotoDocUrl:  vehiclePhotoResult.url,
        extraVehiclePhotoDocPaths: extraResults.length ? extraResults.map((r) => r.path) : undefined,
        extraVehiclePhotoDocUrls:  extraResults.length ? extraResults.map((r) => r.url) : undefined,
        email:              data.email          || undefined,
        dob:                data.dob            || undefined,
        licenseExpiry:      data.licenseExpiry  || undefined,
        cnicExpiry:         data.cnicExpiry     || undefined,
        vehicleDocExpiry:   data.vehicleDocExpiry || undefined,
      });
      await refreshRole();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  const value = useMemo<OnboardingState>(
    () => ({
      data,
      set: (patch) => setData((d) => ({ ...d, ...patch })),
      complete,
      allComplete,
      submitting,
      error,
      submit,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, submitting, error],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingState {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within an OnboardingProvider');
  return ctx;
}
