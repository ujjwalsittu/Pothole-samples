/** One-time UI flags (walkthrough + coach marks), persisted in AsyncStorage. */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const WALKTHROUGH_KEY = 'walkthrough_seen_v1';

export type CoachMarkKey = 'coach_dashboard_v1' | 'coach_annotator_v1' | 'coach_video_v1';

export async function hasSeenWalkthrough(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WALKTHROUGH_KEY)) === '1';
  } catch {
    return true; // fail open — never trap the user in onboarding
  }
}

export async function markWalkthroughSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(WALKTHROUGH_KEY, '1');
  } catch {
    // non-fatal
  }
}

export async function resetWalkthrough(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WALKTHROUGH_KEY);
  } catch {
    // non-fatal
  }
}

const COLLECTOR_CONGRATS_KEY = 'collector_congrats_v1';

/** One-time "you've been made a collector" banner. */
export async function hasSeenCollectorCongrats(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(COLLECTOR_CONGRATS_KEY)) === '1';
  } catch {
    return true;
  }
}

export async function markCollectorCongratsSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(COLLECTOR_CONGRATS_KEY, '1');
  } catch {
    // non-fatal
  }
}

export async function hasSeenCoachMark(key: CoachMarkKey): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === '1';
  } catch {
    return true;
  }
}

export async function markCoachMarkSeen(key: CoachMarkKey): Promise<void> {
  try {
    await AsyncStorage.setItem(key, '1');
  } catch {
    // non-fatal
  }
}
