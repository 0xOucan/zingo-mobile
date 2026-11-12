import { NativeModules } from 'react-native';

/** What one scanned text did to the message being assembled. */
export type QrPartState =
  'accepted' | 'redundant' | 'ignored' | 'rejected' | 'refused' | 'complete';

export type QrProgress = {
  state: QrPartState;
  received: number;
  total: number;
  percent: number;
  error: string;
};

export type LeekAccount = {
  ufvk: string;
  index: number;
  name: string;
  birthday: number;
};

export type LeekAccountRecord = {
  seed_fingerprint: string;
  accounts: LeekAccount[];
};

export type QrFrameInfo = {
  seq_len: number;
  longest_frame: number;
};

type LeekQrAPI = {
  scanStart(kind: 'account' | 'zsig', chainhint: string): Promise<string>;
  scanFeed(text: string): Promise<string>;
  scannedAccount(): Promise<string>;
  signStart(fragmentLen: number): Promise<string>;
  signFragment(fragmentLen: number): Promise<string>;
  signFrames(start: number, count: number): Promise<string>;
  signProve(): Promise<string>;
  broadcast(): Promise<string>;
  signAbandon(): Promise<string>;
  holdScreen(level: number): Promise<boolean>;
  releaseScreen(): Promise<boolean>;
};

const LeekQr = NativeModules.LeekQrModule as LeekQrAPI;

export const scanStart = (kind: 'account' | 'zsig', chain: string) =>
  LeekQr.scanStart(kind, chain);

export const scanFeed = async (text: string): Promise<QrProgress> =>
  JSON.parse(await LeekQr.scanFeed(text));

export const scannedAccount = async (): Promise<LeekAccountRecord> =>
  JSON.parse(await LeekQr.scannedAccount());

export const signStart = async (fragmentLen: number): Promise<QrFrameInfo> =>
  JSON.parse(await LeekQr.signStart(fragmentLen));

export const signFragment = async (fragmentLen: number): Promise<QrFrameInfo> =>
  JSON.parse(await LeekQr.signFragment(fragmentLen));

export const signFrames = async (
  start: number,
  count: number,
): Promise<string[]> => JSON.parse(await LeekQr.signFrames(start, count));

/** Applies the board's signatures and proves; `broadcast` sends the result. */
export const signProve = () => LeekQr.signProve();

/** Stores the signed transaction once the mixnet is ready and sends it; resolves `{ txids }` JSON. */
export const broadcast = () => LeekQr.broadcast();

/** Ends the signing session; resolves whether a stored, unsent transaction is left. */
export const signAbandon = async (): Promise<boolean> =>
  (await LeekQr.signAbandon()) === 'prepared';

/** Keeps the screen on at a brightness from 0 to 1, or at the system brightness. */
export const holdScreen = (level: number | 'system') =>
  LeekQr.holdScreen(level === 'system' ? -1 : level);

export const releaseScreen = () => LeekQr.releaseScreen();
