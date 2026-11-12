import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  nextBrightness,
  readBrightness,
  writeBrightness,
} from '@app/leek/boardWallet';

const stored = new Map<string, string>();

beforeEach(() => {
  stored.clear();
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(async key => stored.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, item) => {
    stored.set(key, item);
  });
});

describe('QR page brightness', () => {
  it('Tests that the control cycles system, 60 %, 80 % and 100 % when pressed four times.', () => {
    const seen = [nextBrightness('system')];
    seen.push(nextBrightness(seen[0]));
    seen.push(nextBrightness(seen[1]));
    seen.push(nextBrightness(seen[2]));
    expect(seen).toEqual([60, 80, 100, 'system']);
  });

  it('Tests that the saved level comes back when the page opens again. An unknown value reads as system.', async () => {
    await writeBrightness(80);
    await expect(readBrightness()).resolves.toBe(80);
    await AsyncStorage.setItem('leek.qr.brightness', 'dim');
    await expect(readBrightness()).resolves.toBe('system');
  });
});
