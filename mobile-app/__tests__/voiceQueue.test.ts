// Mock the speech backend so tests control exactly when an utterance
// "finishes" (via the captured onend/onerror callbacks) instead of depending
// on real TTS timing - this is what actually exercises the preemption logic.
const mockSynthesize = jest.fn();
const mockCancelAll = jest.fn();

jest.mock('../src/core/voice/speechProvider', () => ({
  speechProvider: {
    synthesize: (...args: any[]) => mockSynthesize(...args),
    cancelAll: (...args: any[]) => mockCancelAll(...args),
  },
}));

jest.mock('../src/core/haptics/haptics', () => ({
  fireHapticForPriority: jest.fn(),
}));

import { enqueue, setMuted, isSpeaking, repeatLast, clearQueue, PRIORITY } from '../src/core/voice/voiceQueue';

function currentUtteranceHandlers() {
  const lastCall = mockSynthesize.mock.calls[mockSynthesize.mock.calls.length - 1];
  return lastCall[1] as { onend?: () => void; onerror?: () => void };
}

function finishCurrentUtterance() {
  currentUtteranceHandlers().onend?.();
}

beforeEach(() => {
  // voiceQueue's module-level `current` doesn't get reset by clearQueue() -
  // finish whatever might still be "speaking" from the previous test BEFORE
  // clearing the mock's call history (finishing it reads that history).
  if (isSpeaking()) finishCurrentUtterance();
  mockSynthesize.mockClear();
  mockCancelAll.mockClear();
  clearQueue();
  setMuted(false);
});

describe('voice priority queue', () => {
  it('speaks immediately when nothing is in progress', () => {
    enqueue('hello', { priority: PRIORITY.INFO });
    expect(mockSynthesize).toHaveBeenCalledTimes(1);
    expect(mockSynthesize.mock.calls[0][0]).toBe('hello');
    expect(isSpeaking()).toBe(true);
  });

  it('queues a same-or-lower priority message instead of interrupting', () => {
    enqueue('first', { priority: PRIORITY.INFO });
    enqueue('second', { priority: PRIORITY.INFO });
    expect(mockSynthesize).toHaveBeenCalledTimes(1); // second is queued, not spoken yet
    finishCurrentUtterance();
    expect(mockSynthesize).toHaveBeenCalledTimes(2);
    expect(mockSynthesize.mock.calls[1][0]).toBe('second');
  });

  it('a higher-priority message preempts (cancels + speaks immediately)', () => {
    enqueue('low priority', { priority: PRIORITY.INFO });
    enqueue('danger ahead', { priority: PRIORITY.DANGER });
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
    expect(mockSynthesize).toHaveBeenCalledTimes(2);
    expect(mockSynthesize.mock.calls[1][0]).toBe('danger ahead');
  });

  it('a stale onend from a preempted utterance does not double-advance the queue', () => {
    enqueue('first', { priority: PRIORITY.INFO }); // speaks immediately, gen=1
    const staleHandlers = currentUtteranceHandlers();
    enqueue('urgent', { priority: PRIORITY.DANGER }); // preempts -> gen=2, speaks "urgent"
    enqueue('queued', { priority: PRIORITY.INFO }); // queues behind "urgent"

    // The original ("first") utterance's onend fires late, after it was
    // already cancelled - this must be ignored, not treated as "urgent" ending.
    staleHandlers.onend?.();
    expect(mockSynthesize).toHaveBeenCalledTimes(2); // "queued" must NOT have started yet

    finishCurrentUtterance(); // now really finish "urgent"
    expect(mockSynthesize).toHaveBeenCalledTimes(3);
    expect(mockSynthesize.mock.calls[2][0]).toBe('queued');
  });

  it('drops a duplicate same-key announcement within the throttle window', () => {
    enqueue('front clear', { priority: PRIORITY.SAFE, key: 'zone:front' });
    finishCurrentUtterance();
    enqueue('front clear', { priority: PRIORITY.SAFE, key: 'zone:front' });
    expect(mockSynthesize).toHaveBeenCalledTimes(1); // second call throttled
  });

  it('mute blocks below-DANGER priority but never DANGER/FLOOR_DROP/SOS', () => {
    setMuted(true);
    enqueue('caution note', { priority: PRIORITY.CAUTION });
    expect(mockSynthesize).toHaveBeenCalledTimes(0);
    enqueue('danger note', { priority: PRIORITY.DANGER });
    expect(mockSynthesize).toHaveBeenCalledTimes(1);
  });

  it('repeatLast re-enqueues the most recently spoken text at INFO priority', () => {
    enqueue('remember me', { priority: PRIORITY.INFO });
    finishCurrentUtterance();
    repeatLast();
    expect(mockSynthesize).toHaveBeenCalledTimes(2);
    expect(mockSynthesize.mock.calls[1][0]).toBe('remember me');
  });
});
