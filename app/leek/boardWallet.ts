import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Route } from '@app/AppState';
import { navigateWallet } from '@app/navigation/navigate';

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

let boardWallet = false;
const subscribers = new Set<() => void>();

/** Marks the open wallet as one whose spends a LeekWallet board signs. */
export const setBoardWallet = (board: boolean): void => {
  boardWallet = board;
  subscribers.forEach(notify => notify());
};

export const isBoardWallet = (): boolean => boardWallet;

export const useBoardWallet = (): boolean =>
  useSyncExternalStore(
    notify => {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    },
    () => boardWallet,
  );

export type BoardSignature =
  { kind: 'sent'; txids: string } | { kind: 'error'; message: string };

let pending: ((signature: BoardSignature) => void) | undefined;

/** Opens the board signing screen for the stored proposal and resolves the `{ txids }` JSON it broadcast. */
export const requestBoardSignature = (): Promise<string> =>
  new Promise((resolve, reject) => {
    pending = signature =>
      signature.kind === 'sent'
        ? resolve(signature.txids)
        : reject(new Error(signature.message));
    navigateWallet({ screen: Route.LeekSign });
  });

/** Ends the request the signing screen serves. */
export const settleBoardSignature = (signature: BoardSignature): void => {
  const settle = pending;
  pending = undefined;
  settle?.(signature);
};
