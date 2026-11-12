import { RPCMixnetIndicatorEnum } from '@app/walletBackend/enums/RPCMixnetIndicatorEnum';
import { getMixnetStatus } from '@app/walletBackend/utils/mixnetUtils';

export type MixnetWait = 'ready' | 'timeout' | 'cancelled';

/** zingolib's `TRANSMIT_READINESS_BUDGET`. */
export const MIXNET_WAIT_MS = 90_000;

const POLL_MS = 1_000;

export type MixnetWaitClock = {
  ready: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

/** True while the wallet's mixnet is ready and holds a SOCKS5 address to send through. */
export const mixnetReady = async (): Promise<boolean> => {
  const status = await getMixnetStatus();
  return (
    status.kind === 'status' &&
    status.indicator === RPCMixnetIndicatorEnum.ready &&
    status.socks5Addr !== null
  );
};

const LIVE: MixnetWaitClock = {
  ready: mixnetReady,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** Polls the mixnet every second until it is ready, `cancelled()` turns true or `budget` ms pass. */
export async function waitForMixnet(
  cancelled: () => boolean,
  clock: MixnetWaitClock = LIVE,
  budget: number = MIXNET_WAIT_MS,
): Promise<MixnetWait> {
  const deadline = clock.now() + budget;
  for (;;) {
    if (cancelled()) {
      return 'cancelled';
    }
    if (await clock.ready()) {
      return 'ready';
    }
    if (cancelled()) {
      return 'cancelled';
    }
    if (clock.now() >= deadline) {
      return 'timeout';
    }
    await clock.sleep(POLL_MS);
  }
}
