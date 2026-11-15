import { useSyncExternalStore } from 'react'
import { getSyncState, subscribeSync, type SyncState } from './controller'
export { ApiError, OfflineError } from './api'

export { cloudEnabled, cloudConfig, SIGN_IN_CODE_LENGTH } from './config'
export {
  deleteAccount,
  loadRemoteStatus,
  resolveChoice,
  setSyncAllowed,
  signOut,
  startSync,
  syncNow,
  thisDeviceId,
  apiCall,
  getSyncState,
  subscribeSync,
  type SyncPhase,
  type SyncState,
} from './controller'
export { sendSignInCode, signInWithGoogle, verifySignInCode, type CloudUser } from './auth'
export { describeDevices } from './device'
export { backupStatus, formatWhen } from './format'

/** Live sign-in and sync state. */
export function useSync(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState)
}
