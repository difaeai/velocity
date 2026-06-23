import React, { createContext, useContext, useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { uploadDriverDoc } from '../lib/uploadDoc';
import { api } from '../api/client';
import type { RideType } from '../domain/types';

export type SectionKey = 'basic' | 'license' | 'cnic' | 'selfie' | 'vehicle';

export interface OnboardingData {
  photo: string | null;
  firstName: string;
  lastName: string;
  dob: string;
  email: string;
  licensePhoto: string | null;
  cnicFront: string | null;
  cnicBack: string | null;
  cnicNumber: string;
  selfie: string | null;
  vehicleType: RideType | null;
  vehicleMake: string;
  color: string;
  plate: string;
  vehicleDoc: string | null;
  vehiclePhoto: string | null;
}

const EMPTY: OnboardingData = {
  photo: null,
  firstName: '',
  lastName: '',
  dob: '',
  email: '',
  licensePhoto: null,
  cnicFront: null,
  cnicBack: null,
  cnicNumber: '',
  selfie: null,
  vehicleType: null,
  vehicleMake: '',
  color: '',
  plate: '',
  vehicleDoc: null,
  vehiclePhoto: null,
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
    selfie: !!data.selfie,
    vehicle:
      !!data.vehicleType &&
      data.vehicleMake.trim().length > 0 &&
      data.color.trim().length > 0 &&
      data.plate.trim().length > 2 &&
      !!data.vehicleDoc,
  };
  const allComplete = Object.values(complete).every(Boolean);

  async function submit(): Promise<boolean> {
    if (!user || !allComplete) return false;
    setSubmitting(true);
    setError(null);
    try {
      const uid = user.uid;
      const [licenseDocPath, cnicDocPath, cnicBackDocPath, vehicleDocPath, photoDocPath, selfieDocPath] =
        await Promise.all([
          uploadDriverDoc(uid, 'license', data.licensePhoto!),
          uploadDriverDoc(uid, 'cnic-front', data.cnicFront!),
          uploadDriverDoc(uid, 'cnic-back', data.cnicBack!),
          uploadDriverDoc(uid, 'vehicle', data.vehicleDoc!),
          uploadDriverDoc(uid, 'photo', data.photo!),
          uploadDriverDoc(uid, 'selfie', data.selfie!),
        ]);
      const vehiclePhotoDocPath = data.vehiclePhoto
        ? await uploadDriverDoc(uid, 'vehicle-photo', data.vehiclePhoto)
        : undefined;
      await api.submitDriverOnboarding({
        fullName: `${data.firstName} ${data.lastName}`.trim(),
        cnic: data.cnicNumber,
        vehicleType: data.vehicleType!,
        vehicleLabel: `${data.color} ${data.vehicleMake}`.trim(),
        plate: data.plate.trim().toUpperCase(),
        licenseDocPath,
        cnicDocPath,
        vehicleDocPath,
        cnicBackDocPath,
        photoDocPath,
        selfieDocPath,
        vehiclePhotoDocPath,
        email: data.email || undefined,
        dob: data.dob || undefined,
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
