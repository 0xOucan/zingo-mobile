/* eslint-disable react-native/no-inline-styles */
import React, { useContext, useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { space12, space16, space20, useTheme } from '@app/theme';
import { ContextAppLoaded } from '@app/context';
import { AppDrawerParamList } from '@app/types';
import {
  SIGN_METHODS,
  SignMethod,
  readMethod,
  writeMethod,
} from '@app/leek/boardWallet';
import {
  AddressCheck,
  LeekLink,
  linkCancel,
  linkConnect,
  linkPermissions,
  linkShowAddress,
} from '@app/leek/LeekLinkModule';
import Text from '@ui/primitives/Text';
import Button from '@ui/primitives/Button';
import SegmentedSwitch from '@ui/widgets/SegmentedSwitch';
import TitleBar from '@ui/widgets/TitleBar';
import { ChevronLeft } from '@ui/primitives/Icons/Chevron';
import { UrFrames } from './components/UrFrames';
import { LinkProgress, useLinkStatus } from './components/LinkProgress';
import { brightnessLabel, useQrBrightness } from './components/QrBrightness';

type LeekVerifyProps = NativeStackScreenProps<AppDrawerParamList, 'LeekVerify'>;

type Check =
  | { kind: 'ready'; message?: string }
  | { kind: 'linking' }
  | { kind: 'answered'; check: AddressCheck };

const CHECK_KEYS: Record<AddressCheck, string> = {
  verified: 'leek.verify-verified',
  rejected: 'leek.verify-rejected',
  not_ours: 'leek.verify-not-ours',
  unsupported: 'leek.verify-unsupported',
};

/** Shows a receive address on the LeekWallet board over USB or Bluetooth, or as a QR code for the board's Check address. */
export function LeekVerify({ navigation, route }: LeekVerifyProps) {
  const { address } = route.params;
  const { translate, server } = useContext(ContextAppLoaded);
  const t = (key: string) => translate(key) as string;
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [method, setMethod] = useState<SignMethod>('qr');
  const [check, setCheck] = useState<Check>({ kind: 'ready' });
  const status = useLinkStatus(check.kind === 'linking');
  const qr = method === 'qr';
  const brightness = useQrBrightness(qr);

  useEffect(() => {
    readMethod()
      .then(setMethod)
      .catch(() => undefined);
    return () => {
      linkCancel().catch(() => undefined);
    };
  }, []);

  const choose = (next: SignMethod) => {
    setMethod(next);
    setCheck({ kind: 'ready' });
    writeMethod(next).catch(() => undefined);
  };

  const verifyOver = async (link: LeekLink) => {
    if (!(await linkPermissions(link))) {
      setCheck({ kind: 'ready', message: t('leek.link-permission') });
      return;
    }
    setCheck({ kind: 'linking' });
    try {
      await linkConnect(link);
      setCheck({
        kind: 'answered',
        check: await linkShowAddress(address, server.chainName),
      });
    } catch (error) {
      setCheck({ kind: 'ready', message: (error as Error).message });
    }
  };

  const back = () => {
    linkCancel().catch(() => undefined);
    navigation.goBack();
  };

  const link = qr ? undefined : method;

  return (
    <View
      testID="leek.verify"
      style={{
        flex: 1,
        backgroundColor: qr ? colors.fgQrInk : colors.bgCanvas,
      }}
    >
      <TitleBar
        title={t('leek.verify-title')}
        left={{
          icon: ChevronLeft,
          onPress: back,
          accessibilityLabel: t('import.back-acc'),
          testID: 'leek.verify.back',
          accent: true,
        }}
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space12,
          paddingVertical: space20,
          gap: space16,
          alignItems: 'center',
        }}
      >
        {check.kind !== 'linking' && (
          <SegmentedSwitch
            testID="leek.verify.method"
            options={SIGN_METHODS.map(m => ({
              key: m,
              label: t(`leek.method-${m}`),
              testID: `leek.verify.method.${m}`,
            }))}
            value={method}
            onChange={choose}
            style={{ alignSelf: 'stretch' }}
          />
        )}
        {qr && (
          <>
            <UrFrames
              frames={[address]}
              frameMs={1000}
              size={width - space12 * 2}
            />
            <Text
              variant="body"
              testID="leek.verify.qr-hint"
              style={{ color: colors.bgQrPaper, textAlign: 'center' }}
            >
              {t('leek.verify-qr-hint')}
            </Text>
            <Text
              variant="caption"
              style={{ color: colors.bgQrPaper, textAlign: 'center' }}
            >
              {t('leek.experimental')}
            </Text>
            <Button
              variant="secondary"
              testID="leek.verify.brightness"
              title={brightnessLabel(brightness.level, translate)}
              onPress={brightness.cycle}
              style={{ alignSelf: 'stretch' }}
            />
          </>
        )}
        <Text
          variant="bodySmall"
          testID="leek.verify.address"
          style={{
            color: qr ? colors.bgQrPaper : undefined,
            textAlign: 'center',
          }}
        >
          {address}
        </Text>
        {link && check.kind === 'ready' && (
          <>
            <Text variant="body" style={{ textAlign: 'center' }}>
              {t(`leek.link-hint-${link}`)}
            </Text>
            {!!check.message && (
              <Text
                variant="body"
                testID="leek.verify.error"
                style={{ color: colors.fgDanger, textAlign: 'center' }}
              >
                {check.message}
              </Text>
            )}
            <Button
              variant="primary"
              testID="leek.verify.connect"
              title={t('leek.link-verify')}
              onPress={() => {
                verifyOver(link).catch(() => undefined);
              }}
              style={{ alignSelf: 'stretch' }}
            />
          </>
        )}
        {link && check.kind === 'linking' && (
          <LinkProgress link={link} status={status} translate={translate} />
        )}
        {link && check.kind === 'answered' && (
          <>
            <Text
              variant="bodyStrong"
              testID="leek.verify.answer"
              style={{
                color:
                  check.check === 'verified'
                    ? colors.fgAccent
                    : colors.fgDanger,
                textAlign: 'center',
              }}
            >
              {t(CHECK_KEYS[check.check])}
            </Text>
            <Button
              variant="secondary"
              testID="leek.verify.again"
              title={t('leek.link-again')}
              onPress={() => {
                verifyOver(link).catch(() => undefined);
              }}
              style={{ alignSelf: 'stretch' }}
            />
          </>
        )}
        <View style={{ alignSelf: 'stretch' }}>
          <Button
            variant="quiet"
            testID="leek.verify.close"
            title={t('leek.sign-close')}
            onPress={back}
          />
        </View>
      </ScrollView>
    </View>
  );
}
