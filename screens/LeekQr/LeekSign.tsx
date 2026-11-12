/* eslint-disable react-native/no-inline-styles */
import React, { useContext, useEffect, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { space8, space12, space16, space20, useTheme } from '@app/theme';
import { ContextAppLoaded } from '@app/context';
import { AppDrawerParamList } from '@app/types';
import {
  BoardSignature,
  QR_PRESETS,
  QrPreset,
  SIGN_METHODS,
  SignMethod,
  readMethod,
  readPreset,
  settleBoardSignature,
  writeMethod,
  writePreset,
} from '@app/leek/boardWallet';
import {
  QrFrameInfo,
  QrProgress,
  brightScreen,
  scanFeed,
  scanStart,
  signAbandon,
  signFinish,
  signFragment,
  signFrames,
  signStart,
} from '@app/leek/LeekQrModule';
import {
  LeekLink,
  linkCancel,
  linkConnect,
  linkPermissions,
  linkSign,
} from '@app/leek/LeekLinkModule';
import Text from '@ui/primitives/Text';
import Button from '@ui/primitives/Button';
import SegmentedSwitch from '@ui/widgets/SegmentedSwitch';
import { UrFrames } from './components/UrFrames';
import { UrCamera } from './components/UrCamera';
import { LinkProgress, useLinkStatus } from './components/LinkProgress';

type LeekSignProps = NativeStackScreenProps<AppDrawerParamList, 'LeekSign'>;

type Phase =
  | { kind: 'building' }
  | { kind: 'show'; frames: string[] }
  | { kind: 'scan'; progress?: QrProgress }
  | { kind: 'finishing' }
  | { kind: 'linkReady'; message?: string }
  | { kind: 'linking' }
  | { kind: 'failed'; message: string };

const MAX_FRAMES = 255;
const MIN_FRAMES = 20;

const framesFor = (info: QrFrameInfo) =>
  signFrames(0, Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, info.seq_len * 4)));

/** Signs the stored proposal on a LeekWallet board over animated QR codes, USB or Bluetooth, then broadcasts. */
export function LeekSign({ navigation }: LeekSignProps) {
  const { translate, server } = useContext(ContextAppLoaded);
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [phase, setPhase] = useState<Phase>({ kind: 'building' });
  const [preset, setPreset] = useState<QrPreset>(QR_PRESETS[0]);
  const [method, setMethod] = useState<SignMethod>('qr');
  const settled = useRef(false);
  const finishing = useRef(false);
  const qrBuilt = useRef(false);
  const holding = useRef(false);
  const status = useLinkStatus(phase.kind === 'linking');
  const deny = useRef('');
  deny.current = translate('leek.link-permission') as string;

  holding.current =
    phase.kind === 'finishing' ||
    (phase.kind === 'linking' &&
      (status.stage === 'proving' || status.stage === 'sending'));

  const settle = (signature: BoardSignature) => {
    if (!settled.current) {
      settled.current = true;
      settleBoardSignature(signature);
    }
  };

  const fail = (message: string) => {
    settle({ kind: 'error', message });
    setPhase({ kind: 'failed', message });
  };

  const sent = (txids: string) => {
    settle({ kind: 'sent', txids });
    holding.current = false;
    navigation.goBack();
  };

  const showQr = async (next: QrPreset) => {
    setPhase({ kind: 'building' });
    const info = qrBuilt.current
      ? await signFragment(next.fragmentLen)
      : await signStart(next.fragmentLen);
    qrBuilt.current = true;
    setPhase({ kind: 'show', frames: await framesFor(info) });
  };

  useEffect(() => {
    (async () => {
      const [saved, chosen] = await Promise.all([readPreset(), readMethod()]);
      setPreset(saved);
      setMethod(chosen);
      if (chosen === 'qr') {
        await showQr(saved);
      } else {
        setPhase({ kind: 'linkReady' });
      }
    })().catch((error: Error) => fail(error.message));
    return () => {
      linkCancel().catch(() => undefined);
      if (!finishing.current) {
        signAbandon().catch(() => undefined);
      }
      settle({ kind: 'error', message: 'cancelled' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', event => {
        if (holding.current) {
          event.preventDefault();
        }
      }),
    [navigation],
  );

  const showing = phase.kind === 'show';

  useEffect(() => {
    if (!showing) {
      return;
    }
    brightScreen(true).catch(() => undefined);
    return () => {
      brightScreen(false).catch(() => undefined);
    };
  }, [showing]);

  const chooseMethod = async (next: SignMethod) => {
    setMethod(next);
    await writeMethod(next);
    if (next === 'qr') {
      await showQr(preset);
    } else {
      setPhase({ kind: 'linkReady' });
    }
  };

  const choosePreset = async (key: QrPreset['key']) => {
    const next = QR_PRESETS.find(p => p.key === key) ?? QR_PRESETS[0];
    setPreset(next);
    await writePreset(next);
    if (phase.kind === 'show') {
      setPhase({
        kind: 'show',
        frames: await framesFor(await signFragment(next.fragmentLen)),
      });
    }
  };

  const signOver = async (link: LeekLink) => {
    if (!(await linkPermissions(link))) {
      setPhase({ kind: 'linkReady', message: deny.current });
      return;
    }
    setPhase({ kind: 'linking' });
    const connected = await linkConnect(link).then(
      () => true,
      (error: Error) => {
        setPhase({ kind: 'linkReady', message: error.message });
        return false;
      },
    );
    if (connected) {
      sent(await linkSign());
    }
  };

  const startScan = async () => {
    await scanStart('zsig', server.chainName);
    setPhase({ kind: 'scan' });
  };

  const onText = async (text: string) => {
    if (phase.kind !== 'scan') {
      return;
    }
    const progress = await scanFeed(text);
    if (progress.state === 'refused') {
      setPhase({ kind: 'scan' });
    } else if (progress.state === 'accepted') {
      setPhase({ kind: 'scan', progress });
    } else if (progress.state === 'complete' && !finishing.current) {
      finishing.current = true;
      setPhase({ kind: 'finishing' });
      sent(await signFinish());
    }
  };

  const cancel = async () => {
    await linkCancel().catch(() => undefined);
    await signAbandon().catch(() => undefined);
    settle({ kind: 'error', message: 'cancelled' });
    navigation.goBack();
  };

  const switchable = showing || phase.kind === 'linkReady';
  const link = method === 'qr' ? undefined : method;

  return (
    <View
      testID="leek.sign"
      style={{
        flex: 1,
        backgroundColor: showing ? colors.fgQrInk : colors.bgCanvas,
      }}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space12,
          paddingVertical: space20,
          gap: space16,
          alignItems: 'center',
        }}
      >
        {switchable && (
          <SegmentedSwitch
            testID="leek.sign.method"
            options={SIGN_METHODS.map(m => ({
              key: m,
              label: translate(`leek.method-${m}`) as string,
              testID: `leek.sign.method.${m}`,
            }))}
            value={method}
            onChange={next => {
              chooseMethod(next).catch((error: Error) => fail(error.message));
            }}
            style={{ alignSelf: 'stretch' }}
          />
        )}
        {phase.kind === 'building' && (
          <Text variant="body">
            {translate('leek.sign-building') as string}
          </Text>
        )}
        {showing && (
          <>
            <UrFrames
              frames={phase.frames}
              frameMs={preset.frameMs}
              size={width - space12 * 2}
            />
            <Text
              variant="body"
              style={{ color: colors.bgQrPaper, textAlign: 'center' }}
            >
              {translate('leek.sign-show-hint') as string}
            </Text>
            <Text
              variant="caption"
              testID="leek.sign.tip"
              style={{ color: colors.bgQrPaper, textAlign: 'center' }}
            >
              {translate('leek.sign-oled-tip') as string}
            </Text>
            <SegmentedSwitch
              testID="leek.sign.preset"
              options={QR_PRESETS.map(p => ({
                key: p.key,
                label: translate(`leek.preset-${p.key}`) as string,
                testID: `leek.sign.preset.${p.key}`,
              }))}
              value={preset.key}
              onChange={key => {
                choosePreset(key).catch((error: Error) => fail(error.message));
              }}
              style={{ alignSelf: 'stretch' }}
            />
            <Button
              variant="primary"
              testID="leek.sign.scan"
              title={translate('leek.sign-scan') as string}
              onPress={() => {
                startScan().catch((error: Error) => fail(error.message));
              }}
              style={{ alignSelf: 'stretch' }}
            />
          </>
        )}
        {phase.kind === 'scan' && (
          <>
            <Text variant="body" style={{ textAlign: 'center' }}>
              {translate('leek.sign-scan-hint') as string}
            </Text>
            <UrCamera
              active
              size={width - space20 * 2}
              onText={text => {
                onText(text).catch((error: Error) => fail(error.message));
              }}
            />
            <Text variant="bodyStrong" testID="leek.sign.progress">
              {phase.progress
                ? `${phase.progress.received} / ${phase.progress.total} (${phase.progress.percent}%)`
                : (translate('leek.scan-waiting') as string)}
            </Text>
          </>
        )}
        {phase.kind === 'linkReady' && link && (
          <>
            <Text variant="body" style={{ textAlign: 'center' }}>
              {translate(`leek.link-hint-${link}`) as string}
            </Text>
            {phase.message && (
              <Text
                variant="body"
                testID="leek.sign.link-error"
                style={{ color: colors.fgDanger, textAlign: 'center' }}
              >
                {phase.message}
              </Text>
            )}
            <Button
              variant="primary"
              testID="leek.sign.connect"
              title={translate('leek.link-sign') as string}
              onPress={() => {
                signOver(link).catch((error: Error) => fail(error.message));
              }}
              style={{ alignSelf: 'stretch' }}
            />
          </>
        )}
        {phase.kind === 'linking' && link && (
          <LinkProgress link={link} status={status} translate={translate} />
        )}
        {phase.kind === 'finishing' && (
          <Text variant="body" style={{ textAlign: 'center' }}>
            {translate('leek.sign-finishing') as string}
          </Text>
        )}
        {phase.kind === 'failed' && (
          <Text
            variant="body"
            testID="leek.sign.error"
            style={{ color: colors.fgDanger, textAlign: 'center' }}
          >
            {phase.message}
          </Text>
        )}
        {phase.kind !== 'finishing' && !holding.current && (
          <View style={{ alignSelf: 'stretch', marginTop: space8 }}>
            <Button
              variant="quiet"
              testID="leek.sign.cancel"
              title={
                translate(
                  phase.kind === 'failed' ? 'leek.sign-close' : 'cancel',
                ) as string
              }
              onPress={() => {
                cancel().catch(() => navigation.goBack());
              }}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
