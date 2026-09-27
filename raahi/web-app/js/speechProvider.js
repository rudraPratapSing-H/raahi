// Pluggable speech backend. Default implementation is the browser's built-in
// Web Speech API for BOTH directions - zero network hop for synthesis, and
// recognition uses the browser's own pipeline as-is. A second implementation
// (e.g. an India-stack ASR/TTS/NMT service) could be swapped in later behind
// this same two-method interface for languages/devices where the built-in
// voices/recognizer are missing or poor - it should never be required on the
// safety-critical hazard-alert path, only ever an optional enhancement.

let cachedVoices = [];
if (typeof speechSynthesis !== 'undefined') {
  const refreshVoices = () => { cachedVoices = speechSynthesis.getVoices(); };
  refreshVoices();
  speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

function getVoices() {
  return cachedVoices;
}

function pickVoiceForLang(lang) {
  const voices = getVoices();
  if (!voices.length) return null;
  const exact = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase());
  if (exact) return exact;
  const prefix = lang.split('-')[0].toLowerCase();
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) || null;
}

function hasVoiceForLang(lang) {
  return !!pickVoiceForLang(lang);
}

const RecognitionCtor = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : undefined;

export const speechProvider = {
  isSynthesisSupported() {
    return typeof speechSynthesis !== 'undefined';
  },
  isRecognitionSupported() {
    return !!RecognitionCtor;
  },
  hasVoiceForLang,

  /**
   * synthesize(text, {lang, onend}) -> the SpeechSynthesisUtterance actually
   * queued (so callers can also call speechSynthesis.cancel() themselves if
   * they need to preempt - the utterance object is returned for that reason).
   */
  synthesize(text, { lang = 'en-US', onend, onerror } = {}) {
    if (!this.isSynthesisSupported()) return null;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    const voice = pickVoiceForLang(lang);
    if (voice) utterance.voice = voice;
    if (onend) utterance.onend = onend;
    if (onerror) utterance.onerror = onerror;
    speechSynthesis.speak(utterance);
    return utterance;
  },

  cancelAll() {
    if (this.isSynthesisSupported()) speechSynthesis.cancel();
  },

  /**
   * recognize(lang, handlers) -> a controller {stop()}.
   * handlers = { onResult(transcript, isFinal), onError(err), onEnd() }
   * Caller is responsible for restarting on `onEnd` if continuous listening
   * is desired - Chrome's recognizer stops after a pause by design.
   */
  recognize(lang, handlers) {
    if (!this.isRecognitionSupported()) {
      handlers.onError && handlers.onError(new Error('SpeechRecognition not supported'));
      return { stop() {} };
    }
    const recognizer = new RecognitionCtor();
    recognizer.lang = lang;
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;

    recognizer.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const transcript = result[0].transcript.trim();
      handlers.onResult && handlers.onResult(transcript, result.isFinal);
    };
    recognizer.onerror = (event) => {
      handlers.onError && handlers.onError(event.error);
    };
    recognizer.onend = () => {
      handlers.onEnd && handlers.onEnd();
    };

    try {
      recognizer.start();
    } catch (err) {
      handlers.onError && handlers.onError(err);
    }

    return { stop: () => recognizer.stop() };
  },
};
