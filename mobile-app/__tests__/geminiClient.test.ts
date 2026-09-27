// geminiClient.ts reads its key list from process.env at module load time
// (required for Metro to statically inline EXPO_PUBLIC_ vars), so each test
// here sets env vars then freshly `require()`s the module via
// jest.resetModules() to get a module instance that actually observes them.

const originalEnv = { ...process.env };

function freshClient() {
  jest.resetModules();
  return require('../src/core/gemini/geminiClient');
}

function mockFetchOk(jsonBody: unknown) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: async () => jsonBody,
    text: async () => '',
  });
}

function keyFromCall(callIndex: number): string {
  const url = (globalThis.fetch as jest.Mock).mock.calls[callIndex][0] as string;
  return new URL(url).searchParams.get('key')!;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  delete process.env.EXPO_PUBLIC_GEMINI_API_KEY2;
  delete process.env.EXPO_PUBLIC_GEMINI_API_KEY3;
});

afterAll(() => {
  process.env = originalEnv;
});

describe('Gemini key rotation', () => {
  it('falls back to using the single key for every call when no extras are set', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'only-key';
    globalThis.fetch = mockFetchOk({ candidates: [{ content: { parts: [{ text: '2' }] } }] });
    const { scoreHazard } = freshClient();

    await scoreHazard('a couch ahead');
    await scoreHazard('a couch ahead');
    await scoreHazard('a couch ahead');

    expect(keyFromCall(0)).toBe('only-key');
    expect(keyFromCall(1)).toBe('only-key');
    expect(keyFromCall(2)).toBe('only-key');
  });

  it('round-robins across every configured key', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'key-a';
    process.env.EXPO_PUBLIC_GEMINI_API_KEY2 = 'key-b';
    process.env.EXPO_PUBLIC_GEMINI_API_KEY3 = 'key-c';
    globalThis.fetch = mockFetchOk({ candidates: [{ content: { parts: [{ text: '1' }] } }] });
    const { scoreHazard } = freshClient();

    await scoreHazard('x');
    await scoreHazard('x');
    await scoreHazard('x');
    await scoreHazard('x'); // wraps back around to key-a

    expect([keyFromCall(0), keyFromCall(1), keyFromCall(2)]).toEqual(['key-a', 'key-b', 'key-c']);
    expect(keyFromCall(3)).toBe('key-a');
  });

  it('skips unset middle keys (KEY2 blank, KEY3 set) rather than rotating in an empty slot', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'key-a';
    process.env.EXPO_PUBLIC_GEMINI_API_KEY3 = 'key-c';
    globalThis.fetch = mockFetchOk({ candidates: [{ content: { parts: [{ text: '1' }] } }] });
    const { scoreHazard } = freshClient();

    await scoreHazard('x');
    await scoreHazard('x');
    await scoreHazard('x');

    expect([keyFromCall(0), keyFromCall(1), keyFromCall(2)]).toEqual(['key-a', 'key-c', 'key-a']);
  });

  it('throws a clear error when no key is configured at all', async () => {
    globalThis.fetch = mockFetchOk({});
    const { scoreHazard } = freshClient();
    // scoreHazard itself catches errors and returns a safe default (severity
    // 1) rather than throwing - so the missing-key error is only observable
    // via a function that doesn't swallow it, like embedImage.
    const { embedImage } = freshClient();
    await expect(embedImage('base64')).rejects.toThrow(/Gemini API key not configured/);
  });
});
