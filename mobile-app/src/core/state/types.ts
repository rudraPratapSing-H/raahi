// Shared types for the ctx object threaded through actions/buttons/finder/
// voiceCommands - the same "one context object" pattern the web-app used,
// just with `log`/`state` backed by React state instead of DOM manipulation.

import type { PathStep } from '../finder/localGraph';

export interface AppState {
  muted: boolean;
  destinationNodeId: string | null;
  blockedEdges: Array<[string, string]>;
  activeRoute: { steps: PathStep[]; index: number; targetLabel: string } | null;
  activeFind: { target: string; lastDirection: string; lastDistance: string | null } | null;
}

export function createAppState(): AppState {
  return {
    muted: false,
    destinationNodeId: null,
    blockedEdges: [],
    activeRoute: null,
    activeFind: null,
  };
}

export interface LogEntry {
  id: string;
  text: string;
  crit: boolean;
  at: number;
}

export interface LogApi {
  add: (text: string) => void;
  addButtonEvent: (gestureId: number) => void;
  addSOS: (text: string) => void;
}

// `import type` here is erased at compile time (TypeScript strips it before
// Metro ever sees a runtime import), so there's no runtime circular-import
// risk even though these modules are type-linked to this file - only
// actions.ts/finder.ts/buttons.ts/voiceCommands.ts import the *value* `Ctx`
// shape from here; the modules below never import Ctx themselves.
import type * as voiceQueue from '../voice/voiceQueue';
import type * as reflexBle from '../ble/reflexBle';
import type * as camera from '../camera/camera';
import type * as backend from '../backend/backend';
import type * as i18n from '../i18n/i18n';

export interface Ctx {
  voice: typeof voiceQueue;
  ble: typeof reflexBle;
  camera: typeof camera;
  backend: typeof backend;
  i18n: typeof i18n;
  log: LogApi;
  state: AppState;
  onSOS?: () => void;
}
