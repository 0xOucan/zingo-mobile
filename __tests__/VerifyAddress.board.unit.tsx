import 'react-native';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  ContextAppLoadedProvider,
  defaultAppContextLoaded,
} from '@app/context';
import { ChainNameEnum, remoteServer } from '@app/AppState';
import RPCModule from '@app/RPCModule';
import VerifyAddress from '@screens/Receive/components/VerifyAddress';

jest.mock('@app/RPCModule', () =>
  require('../__mocks__/rpcModuleProxy').rpcModuleProxyMock(),
);

const pasted =
  'zs17xwek7t788enw3zc88d5e54s4tz006uv5yclzet8c3z6j423ymfu98c5u0thd6zp4e6p2jumnna';

const context = {
  ...defaultAppContextLoaded,
  translate: (key: string) => key,
  addLastSnackbar: jest.fn(),
  server: remoteServer('https://fixture.invalid', ChainNameEnum.mainChainName),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(RPCModule.parseAddressInfo).mockResolvedValue(
    JSON.stringify({
      status: 'success',
      chain_name: 'main',
      address_kind: 'sapling',
    }),
  );
});

test('Tests that Verify on LeekWallet hands over the pasted address when one is pasted.', async () => {
  const onBoard = jest.fn();
  const view = render(
    <ContextAppLoadedProvider value={context}>
      <VerifyAddress onBoard={onBoard} />
    </ContextAppLoadedProvider>,
  );
  await act(async () => {
    fireEvent.changeText(view.getByTestId('send.addressplaceholder'), pasted);
  });
  await waitFor(() => expect(view.getByText('verify')).toBeEnabled());
  fireEvent.press(view.getByTestId('receive.verify-board'));
  expect(onBoard).toHaveBeenCalledWith(pasted);
});

test('Tests that Verify on LeekWallet hands over no address when none is pasted. Receive then checks the address on its card.', () => {
  const onBoard = jest.fn();
  const view = render(
    <ContextAppLoadedProvider value={context}>
      <VerifyAddress onBoard={onBoard} />
    </ContextAppLoadedProvider>,
  );
  fireEvent.press(view.getByTestId('receive.verify-board'));
  expect(onBoard).toHaveBeenCalledWith('');
});

test('Tests that the sheet shows no board button when the wallet has no LeekWallet.', () => {
  const view = render(
    <ContextAppLoadedProvider value={context}>
      <VerifyAddress />
    </ContextAppLoadedProvider>,
  );
  expect(view.queryByTestId('receive.verify-board')).toBeNull();
});
