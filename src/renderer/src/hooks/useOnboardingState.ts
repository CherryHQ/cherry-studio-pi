import { useCallback, useState } from 'react'

import { scheduleStorageV2LocalStorageMirror } from '../services/StorageV2LocalStorageSnapshot'

const ONBOARDING_COMPLETED_KEY = 'onboarding-completed'

export function useOnboardingState() {
  const [onboardingCompleted, setOnboardingCompleted] = useState(
    () => localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true'
  )

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    scheduleStorageV2LocalStorageMirror()
    setOnboardingCompleted(true)
  }, [])

  return {
    onboardingCompleted,
    completeOnboarding
  }
}
