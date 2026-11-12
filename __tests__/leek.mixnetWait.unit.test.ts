import { MixnetWaitClock, waitForMixnet } from '@app/leek/mixnetWait';

jest.mock('@app/RPCModule', () =>
  require('../__mocks__/rpcModuleProxy').rpcModuleProxyMock(),
);

const clock = (answers: boolean[]): MixnetWaitClock & { slept: number } => {
  let time = 0;
  const fake = {
    slept: 0,
    ready: async () => answers.shift() ?? false,
    sleep: async (ms: number) => {
      time += ms;
      fake.slept += 1;
    },
    now: () => time,
  };
  return fake;
};

describe('waitForMixnet', () => {
  it('Tests that the wait ends ready when the mixnet becomes ready before the budget runs out.', async () => {
    const fake = clock([false, false, true]);
    await expect(waitForMixnet(() => false, fake, 10_000)).resolves.toBe(
      'ready',
    );
    expect(fake.slept).toBe(2);
  });

  it('Tests that the wait times out when the mixnet stays bootstrapping past the budget. One poll runs per second.', async () => {
    const fake = clock([]);
    await expect(waitForMixnet(() => false, fake, 5_000)).resolves.toBe(
      'timeout',
    );
    expect(fake.slept).toBe(5);
  });

  it('Tests that the wait ends cancelled when the user cancels during a poll.', async () => {
    let cancelled = false;
    const fake = clock([]);
    fake.ready = async () => {
      cancelled = true;
      return false;
    };
    await expect(waitForMixnet(() => cancelled, fake, 10_000)).resolves.toBe(
      'cancelled',
    );
    expect(fake.slept).toBe(0);
  });
});
