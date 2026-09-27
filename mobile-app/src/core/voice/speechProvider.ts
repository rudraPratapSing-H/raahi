// Device speech backend: expo-speech for TTS (on-device, no network hop -
// same "minimal latency" property the web-app's Web Speech API gave), and
// expo-speech-recognition for STT (wraps the OS's own recognizer, same
// mental model as the browser's SpeechRecognition the web-app used). Keeping
// the same two-method shape as the web-app's speechProvider.js means
// voiceQueue.ts and voiceCommands.ts barely change from their web version.

import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, type ExpoSpeechRecognitionErrorEvent } from 'expo-speech-recognition';

export interface SynthesizeHandlers {
  onend?: () => void;
  onerror?: () => void;
}

export interface RecognizeHandlers {
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export const speechProvider = {
  isRecognitionSupported(): boolean {
    return true; // expo-speech-recognition supports both iOS and Android
  },

  async requestRecognitionPermission(): Promise<boolean> {
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      return !!result.granted;
    } catch (err) {
      console.warn('requestRecognitionPermission failed', err);
      return false;
    }
  },

  synthesize(text: string, { lang = 'en-US', onend, onerror }: { lang?: string } & SynthesizeHandlers = {}) {
    Speech.speak(text, {
      language: lang,
      onDone: onend,
      onStopped: onend, // fires when cancelAll() preempts this utterance - must also settle the queue
      onError: onerror,
    });
  },

  cancelAll() {
    Speech.stop();
  },

  /**
   * recognize(lang, handlers) -> a controller {stop()}. Caller restarts on
   * `onEnd` if continuous listening is desired (the OS recognizer stops after
   * a pause by design, same as the browser's did).
   */
  recognize(lang: string, handlers: RecognizeHandlers) {
    const resultSub = ExpoSpeechRecognitionModule.addListener('result', (event) => {
      const transcript = event.results?.[0]?.transcript ?? '';
      handlers.onResult?.(transcript, !!event.isFinal);
    });
    const errorSub = ExpoSpeechRecognitionModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
      handlers.onError?.(event.error);
    });
    const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
      handlers.onEnd?.();
    });

    try {
      ExpoSpeechRecognitionModule.start({ lang, interimResults: false, continuous: true });
    } catch (err) {
      handlers.onError?.(String(err));
    }

    return {
      stop() {
        resultSub.remove();
        errorSub.remove();
        endSub.remove();
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch (err) {
          // already stopped - fine
        }
      },
    };
  },
};
