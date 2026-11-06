'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAiTryOnReferences } from '@/hooks/api/use-ai-try-on';
import type { TryOnForm } from './useTryOnForm';

/** 按需启用查询，并在权威列表更新后清除下架素材。 */
export function useTryOnLibraries(form: TryOnForm) {
  const {
    mode,
    personSource,
    personAssetId,
    garmentAssetId,
    poseAssetId,
    styleAssetId,
    setPersonAssetId,
    setGarmentAssetId,
    setPoseAssetId,
    setStyleAssetId,
  } = form;
  const [requestedLibraries, setRequestedLibraries] = useState({
    person: false,
    garment: false,
    pose: false,
  });
  const [librarySelectionRemoved, setLibrarySelectionRemoved] = useState(false);
  const requestLibrary = useCallback(
    (kind: keyof typeof requestedLibraries) => {
      setRequestedLibraries(current =>
        current[kind] ? current : { ...current, [kind]: true }
      );
    },
    []
  );
  useEffect(() => {
    if (personSource === 'library' || personAssetId) requestLibrary('person');
    if (mode === 'inspiration' || garmentAssetId || styleAssetId)
      requestLibrary('garment');
    if (poseAssetId) requestLibrary('pose');
  }, [
    mode,
    personSource,
    personAssetId,
    garmentAssetId,
    styleAssetId,
    poseAssetId,
    requestLibrary,
  ]);

  const person = useAiTryOnReferences('person', {
    enabled: requestedLibraries.person,
  });
  const garment = useAiTryOnReferences('garment', {
    enabled: requestedLibraries.garment,
  });
  const pose = useAiTryOnReferences('pose', {
    enabled: requestedLibraries.pose,
  });
  const missingPerson = Boolean(
    personAssetId &&
    person.data &&
    !person.data.some(item => item.id === personAssetId)
  );
  const missingGarment = Boolean(
    garmentAssetId &&
    garment.data &&
    !garment.data.some(item => item.id === garmentAssetId)
  );
  const missingPose = Boolean(
    poseAssetId && pose.data && !pose.data.some(item => item.id === poseAssetId)
  );
  const missingStyle = Boolean(
    styleAssetId &&
    garment.data &&
    !garment.data.some(item => item.id === styleAssetId)
  );

  useEffect(() => {
    if (missingPerson) setPersonAssetId(null);
    if (missingGarment) setGarmentAssetId(null);
    if (missingPose) setPoseAssetId(null);
    if (missingStyle) setStyleAssetId(null);
    if (missingPerson || missingGarment || missingPose || missingStyle)
      setLibrarySelectionRemoved(true);
  }, [
    missingPerson,
    missingGarment,
    missingPose,
    missingStyle,
    setPersonAssetId,
    setGarmentAssetId,
    setPoseAssetId,
    setStyleAssetId,
  ]);

  return {
    libraries: { person, garment, pose },
    requestedLibraries,
    requestLibrary,
    librarySelectionRemoved,
    dismissLibraryNotice: () => setLibrarySelectionRemoved(false),
    hasUnavailableSelection:
      missingPerson || missingGarment || missingPose || missingStyle,
  };
}
