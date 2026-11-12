import AsyncStorage from '@react-native-async-storage/async-storage';

/** A fragment size and frame interval for the animated code the board scans. */
export type QrPreset = {
  key: 'big' | 'medium' | 'laptop';
  fragmentLen: number;
  frameMs: number;
};

export const QR_PRESETS: QrPreset[] = [
  { key: 'big', fragmentLen: 25, frameMs: 350 },
  { key: 'medium', fragmentLen: 40, frameMs: 350 },
  { key: 'laptop', fragmentLen: 50, frameMs: 500 },
];

const PRESET_KEY = 'leek.qr.preset';

export const readPreset = async (): Promise<QrPreset> => {
  const key = await AsyncStorage.getItem(PRESET_KEY);
  return QR_PRESETS.find(preset => preset.key === key) ?? QR_PRESETS[0];
};

export const writePreset = (preset: QrPreset) =>
  AsyncStorage.setItem(PRESET_KEY, preset.key);

export type SignMethod = 'qr' | 'usb' | 'ble';

export const SIGN_METHODS: SignMethod[] = ['qr', 'usb', 'ble'];

const METHOD_KEY = 'leek.sign.method';

export const readMethod = async (): Promise<SignMethod> => {
  const key = await AsyncStorage.getItem(METHOD_KEY);
  return SIGN_METHODS.find(method => method === key) ?? 'qr';
};

export const writeMethod = (method: SignMethod) =>
  AsyncStorage.setItem(METHOD_KEY, method);

/** The QR page's screen brightness: the system's, or a fixed percentage. */
export type QrBrightness = 'system' | 60 | 80 | 100;

export const QR_BRIGHTNESS: QrBrightness[] = ['system', 60, 80, 100];

const BRIGHTNESS_KEY = 'leek.qr.brightness';

export const nextBrightness = (current: QrBrightness): QrBrightness =>
  QR_BRIGHTNESS[(QR_BRIGHTNESS.indexOf(current) + 1) % QR_BRIGHTNESS.length];

export const readBrightness = async (): Promise<QrBrightness> => {
  const key = await AsyncStorage.getItem(BRIGHTNESS_KEY);
  return QR_BRIGHTNESS.find(level => String(level) === key) ?? 'system';
};

export const writeBrightness = (level: QrBrightness) =>
  AsyncStorage.setItem(BRIGHTNESS_KEY, String(level));

export {
  isBoardWallet,
  setBoardWallet,
  settleBoardSignature,
  useBoardWallet,
} from './boardFlag';
export type { BoardSignature } from './boardFlag';
