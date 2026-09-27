// Haptic feedback as a redundant channel alongside DANGER/FLOOR_DROP/SOS
// voice alerts - useful in loud environments, or simply as reinforcement.
// New capability, no web-app equivalent (browsers can't drive real haptics).

import * as Haptics from 'expo-haptics';
import { PRIORITY } from '../voice/voiceQueue';

export function fireHapticForPriority(priority: number) {
  if (priority >= PRIORITY.SOS) {
    // distinct triple-pulse pattern for SOS so it's not confused with a plain hazard
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}), 250);
    setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}), 500);
    return;
  }
  if (priority >= PRIORITY.DANGER) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }
}
