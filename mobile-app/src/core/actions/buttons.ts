// Hardware button gesture -> action name. Unchanged mapping from the
// web-app's buttons.js (1=Short, 2=Long, 3=Double, 4=Triple/SOS, 5=Very
// long) - all 5 physical gestures keep their meaning regardless of app mode;
// "find"/"guide" are voice-first and reachable only via speech (or the
// on-screen fallback input), never by repurposing a gesture.

import { dispatch } from './actions';
import type { Ctx } from '../state/types';

export const BUTTON_ACTIONS: Record<number, string> = {
  1: 'repeatLast',
  2: 'toggleMute',
  3: 'whereAmI',
  4: 'sos',
  5: 'recalibrate',
};

export function actionForGesture(gestureId: number): string | null {
  return BUTTON_ACTIONS[gestureId] ?? null;
}

export function dispatchGesture(gestureId: number, ctx: Ctx) {
  const name = actionForGesture(gestureId);
  if (!name) return;
  return dispatch(name, ctx);
}
