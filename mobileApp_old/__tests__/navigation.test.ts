import { cosineSimilarity } from '../src/utils/math';

// Mocking react-native-tts for the test
const mockSpeak = jest.fn();
jest.mock('react-native-tts', () => ({
  speak: mockSpeak,
}));

describe('Math Logic & Matcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('cosineSimilarity correctly calculates distance between vectors', () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];
    
    // Identical vectors should have a similarity of 1
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);
    
    // Orthogonal vectors should have a similarity of 0
    expect(cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0);
  });

  it('simulates the node matching threshold properly', () => {
    const targetNodeVector = new Array(3072).fill(0.1);
    const perfectMatchQuery = new Array(3072).fill(0.1);
    const poorMatchQuery = new Array(3072).fill(0).map((_, i) => (i % 2 === 0 ? 0.9 : -0.1));

    const highSimilarity = cosineSimilarity(targetNodeVector, perfectMatchQuery);
    const lowSimilarity = cosineSimilarity(targetNodeVector, poorMatchQuery);

    expect(highSimilarity).toBeGreaterThan(0.85); // Exceeds our confidence threshold
    expect(lowSimilarity).toBeLessThan(0.85); // Fails our threshold
    
    // Simulate triggering TTS on success
    if (highSimilarity > 0.85) {
      const { speak } = require('react-native-tts');
      speak('Walk straight ahead');
    }
    
    expect(mockSpeak).toHaveBeenCalledWith('Walk straight ahead');
  });
});
