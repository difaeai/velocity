import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { useDriverProfile } from '../hooks/driver';
import { uploadDriverDoc, type UploadResult } from '../lib/uploadDoc';
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
  const profile = useDriverProfile(user?.uid);
  const [data, setData] = useState<OnboardingData>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-fill the forms from the previously submitted application (pending or
  // rejected) so a rejection only costs the driver the rejected sections —
  // everything else keeps its ✓. Stored download URLs stand in for the local
  // image URIs; submit() recognises them and skips re-uploading those files.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !profile || !profile.licenseDocUrl) return;
    hydrated.current = true;
    const p = profile;
    const [firstName = '', ...restName] = (p.fullName ?? '').trim().split(/\s+/);
    const [color = '', ...makeParts] = (p.vehicleLabel ?? '').trim().split(/\s+/);
    setData((d) => ({
      ...d,
      photo: d.photo ?? p.photoDocUrl ?? null,
      firstName: d.firstName || firstName,
      lastName: d.lastName || restName.join(' '),
      dob: d.dob || (p.dob ?? ''),
      email: d.email || (p.email ?? ''),
      licensePhoto: d.licensePhoto ?? p.licenseDocUrl ?? null,
      licenseExpiry: d.licenseExpiry || (p.licenseExpiry ?? ''),
      cnicFront: d.cnicFront ?? p.cnicDocUrl ?? null,
      cnicBack: d.cnicBack ?? p.cnicBackDocUrl ?? null,
      cnicNumber: d.cnicNumber || (p.cnic ?? ''),
      cnicExpiry: d.cnicExpiry || (p.cnicExpiry ?? ''),
      vehicleType: d.vehicleType ?? ((p.vehicleType as RideType | undefined) ?? null),
      vehicleMake: d.vehicleMake || (makeParts.length ? makeParts.join(' ') : color),
      color: d.color || (makeParts.length ? color : ''),
      plate: d.plate || (p.plate ?? ''),
      vehicleDoc: d.vehicleDoc ?? p.vehicleDocUrl ?? null,
      vehicleDocExpiry: d.vehicleDocExpiry || (p.vehicleDocExpiry ?? ''),
      vehiclePhoto: d.vehiclePhoto ?? p.vehiclePhotoDocUrl ?? null,
      vehiclePhotos: d.vehiclePhotos.length ? d.vehiclePhotos : (p.extraVehiclePhotoDocUrls ?? []),
    }));
  }, [profile]);

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

      // A URI that still equals the stored download URL is the file the driver
      // already submitted — reuse its storage path instead of re-uploading.
      const uploadOrKeep = (kind: string, uri: string, path?: string, url?: string): Promise<UploadResult> =>
        url && path && uri === url ? Promise.resolve({ path, url }) : uploadDriverDoc(uid, kind, uri);

      const p = profile;
      const [licenseResult, cnicResult, cnicBackResult, vehicleDocResult, photoResult, vehiclePhotoResult] =
        await Promise.all([
          uploadOrKeep('license',       data.licensePhoto!,  p?.licenseDocPath,      p?.licenseDocUrl),
          uploadOrKeep('cnic-front',    data.cnicFront!,     p?.cnicDocPath,         p?.cnicDocUrl),
          uploadOrKeep('cnic-back',     data.cnicBack!,      p?.cnicBackDocPath,     p?.cnicBackDocUrl),
          uploadOrKeep('vehicle',       data.vehicleDoc!,    p?.vehicleDocPath,      p?.vehicleDocUrl),
          uploadOrKeep('photo',         data.photo!,         p?.photoDocPath,        p?.photoDocUrl),
          uploadOrKeep('vehicle-photo', data.vehiclePhoto!,  p?.vehiclePhotoDocPath, p?.vehiclePhotoDocUrl),
        ]);

      const extraResults = await Promise.all(
        data.vehiclePhotos.map((uri, i) => {
          const idx = p?.extraVehiclePhotoDocUrls?.indexOf(uri) ?? -1;
          const keptPath = idx >= 0 ? p?.extraVehiclePhotoDocPaths?.[idx] : undefined;
          return keptPath
            ? Promise.resolve({ path: keptPath, url: uri })
            : uploadDriverDoc(uid, `vehicle-photo-${i + 1}`, uri);
        }),
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
    [data, submitting, error, profile],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingState {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within an OnboardingProvider');
  return ctx;
}
