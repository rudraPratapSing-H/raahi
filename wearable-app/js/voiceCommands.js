// Spoken command input. Continuous listening (auto-restarts on the
// recognizer's `end` event, since Chrome's SpeechRecognition stops after a
// pause) so control is hands-free - the 5 physical-button gestures remain a
// fully independent fallback if speech is ever mis-heard or the environment
// is too noisy. A small fixed grammar is matched locally first (no extra
// network cost beyond what the browser's own recognizer already does); the
// "find X" pattern is the one open-vocabulary case. Anything unmatched gets a
// short spoken hint - there is deliberately NO fallback to a generic LLM
// question-answering call here.

import { speechProvider } from './speechProvider.js';
import { dispatch } from './actions.js';

const FIND_RE = /^(?:find|locate|where is|where's|take me to|guide me to)\s+(?:the\s+)?(.+)/i;

const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed']);
const RESTART_DELAY_MS = 300;

let controller = null;
let enabled = false;
let listenCtx = null;
let lastErrorWasFatal = false;

function matchCommand(transcript) {
  const t = transcript.trim().toLowerCase();
  if (!t) return null;

  if (/^(repeat|say that again|repeat that)/.test(t)) return { name: 'repeatLast' };
  if (/^(mute|unmute|stop talking|quiet)/.test(t)) return { name: 'toggleMute' };
  if (/where am i|locate me/.test(t)) return { name: 'whereAmI' };
  if (/\bsos\b|emergency|help help/.test(t)) return { name: 'sos' };
  if (/recalibrate|reset floor/.test(t)) return { name: 'recalibrate' };
  if (/^(stop|cancel|never ?mind)/.test(t)) return { name: 'cancelFind' };

  const findMatch = t.match(FIND_RE);
  if (findMatch) return { name: 'find', extra: { target: findMatch[1].trim() } };

  if (/guide me|continue|take me there|^next$/.test(t)) return { name: 'guide' };

  return null;
}

function handleTranscript(transcript) {
  if (!listenCtx) return;
  const match = matchCommand(transcript);
  listenCtx.log.add(`Heard: "${transcript}"`);
  if (match) {
    dispatch(match.name, listenCtx, match.extra);
  } else {
    listenCtx.voice.enqueue(listenCtx.i18n.t('voice.commandHint'), { priority: listenCtx.voice.PRIORITY.INFO });
  }
}

function startRecognizer() {
  if (!listenCtx || controller) return;
  lastErrorWasFatal = false;
  controller = speechProvider.recognize(listenCtx.i18n.getSpeechLang(), {
    onResult: (transcript, isFinal) => {
      if (isFinal) handleTranscript(transcript);
    },
    onError: (err) => {
      console.warn('voiceCommands recognition error', err);
      if (FATAL_ERRORS.has(err)) {
        // Permission denial (or a policy block) won't fix itself by retrying -
        // restarting instantly in a loop just spams the OS/browser with
        // permission requests. Turn listening off and let the user
        // re-enable it (via the checkbox) once they've actually granted it.
        lastErrorWasFatal = true;
        enabled = false;
        listenCtx.log.add('Voice control disabled: microphone permission denied');
      }
    },
    onEnd: () => {
      controller = null;
      if (enabled && !lastErrorWasFatal) {
        // Small delay rather than an instant recursive restart, so even an
        // error type not in FATAL_ERRORS can't turn into a tight sync loop.
        setTimeout(() => {
          if (enabled) startRecognizer();
        }, RESTART_DELAY_MS);
      }
    },
  });
}

function stopRecognizer() {
  if (controller) {
    controller.stop();
    controller = null;
  }
}

export function isSupported() {
  return speechProvider.isRecognitionSupported();
}

export function isListening() {
  return enabled;
}

export function start(ctx) {
  listenCtx = ctx;
  if (!isSupported()) return false;
  enabled = true;
  startRecognizer();
  return true;
}

export function stop() {
  enabled = false;
  stopRecognizer();
}
