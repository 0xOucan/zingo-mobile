import { useSyncExternalStore } from 'react';

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

let openSigner: (() => void) | undefined;

/** Names how the wallet opens the board signing screen. */
export const setSignerOpener = (open: (() => void) | undefined): void => {
  openSigner = open;
};

/** Opens the board signing screen for the stored proposal and resolves the `{ txids }` JSON it broadcast. */
export const requestBoardSignature = (): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!openSigner) {
      reject(new Error('the board signing screen is not available'));
      return;
    }
    pending = signature =>
      signature.kind === 'sent'
        ? resolve(signature.txids)
        : reject(new Error(signature.message));
    openSigner();
  });

/** Ends the request the signing screen serves. */
export const settleBoardSignature = (signature: BoardSignature): void => {
  const settle = pending;
  pending = undefined;
  settle?.(signature);
};
