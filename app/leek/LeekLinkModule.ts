import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

export type LeekLink = 'usb' | 'ble';

export type LinkStage =
  | 'idle'
  | 'connecting'
  | 'pair'
  | 'unlock'
  | 'connected'
  | 'share'
  | 'building'
  | 'checking'
  | 'uploading'
  | 'review'
  | 'applying'
  | 'proving'
  | 'address';

export type LinkStatus = {
  stage: LinkStage;
  code?: string;
  sent?: number;
  total?: number;
  update?: string;
};

export type LinkAccount = {
  seed_fingerprint: string;
  index: number;
  ufvk: string;
  ua: string;
  birthday: number;
};

type LeekLinkAPI = {
  connect(kind: LeekLink): Promise<string>;
  getAccount(chainhint: string): Promise<string>;
  sign(): Promise<string>;
  showAddress(address: string, chainhint: string): Promise<string>;
  status(): Promise<string>;
  cancel(): Promise<string>;
};

const LeekLinkNative = NativeModules.LeekLinkModule as LeekLinkAPI;

/** Opens the link and pairs; resolves once the board is unlocked. */
export const linkConnect = async (
  kind: LeekLink,
): Promise<{ update: string }> =>
  JSON.parse(await LeekLinkNative.connect(kind));

export const linkAccount = async (chain: string): Promise<LinkAccount> =>
  JSON.parse(await LeekLinkNative.getAccount(chain));

/** Signs on the connected board and proves; `broadcast` sends the result. */
export const linkSign = () => LeekLinkNative.sign();

/** What the board answered about an address it showed. */
export type AddressCheck = 'verified' | 'rejected' | 'not_ours' | 'unsupported';

const ADDRESS_CHECKS: AddressCheck[] = [
  'verified',
  'rejected',
  'not_ours',
  'unsupported',
];

/** Shows the address on the connected board and resolves the user's answer there. */
export const linkShowAddress = async (
  address: string,
  chain: string,
): Promise<AddressCheck> => {
  const answer = await LeekLinkNative.showAddress(address, chain);
  const check = ADDRESS_CHECKS.find(known => known === answer);
  if (!check) {
    throw new Error(`unknown address check ${answer}`);
  }
  return check;
};

export const linkStatus = async (): Promise<LinkStatus> =>
  JSON.parse(await LeekLinkNative.status());

export const linkCancel = () => LeekLinkNative.cancel();

/** Asks for the runtime permissions the link needs and resolves whether all were granted. */
export const linkPermissions = async (kind: LeekLink): Promise<boolean> => {
  if (kind === 'usb' || Platform.OS !== 'android') {
    return true;
  }
  const wanted =
    Platform.Version >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const answers = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every(
    permission => answers[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
};
