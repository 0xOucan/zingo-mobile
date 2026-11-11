/* eslint-disable react-native/no-inline-styles */
import React, { useContext, useEffect, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { space8, space12, space16, space20, useTheme } from '@app/theme';
import { ContextAppLoaded } from '@app/context';
import { AppDrawerParamList } from '@app/types';
import {
  QR_PRESETS,
  QrPreset,
  readPreset,
  settleBoardSignature,
  writePreset,
} from '@app/leek/boardWallet';
import {
  QrFrameInfo,
  QrProgress,
  scanFeed,
  scanStart,
  signAbandon,
  signFinish,
  signFragment,
  signFrames,
  signStart,
} from '@app/leek/LeekQrModule';
import Text from '@ui/primitives/Text';
import Button from '@ui/primitives/Button';
import SegmentedSwitch from '@ui/widgets/SegmentedSwitch';
import { UrFrames } from './components/UrFrames';
import { UrCamera } from './components/UrCamera';

type LeekSignProps = NativeStackScreenProps<AppDrawerParamList, 'LeekSign'>;

type Phase =
  | { kind: 'building' }
  | { kind: 'show'; frames: string[] }
  | { kind: 'scan'; progress?: QrProgress }
  | { kind: 'finishing' }
  | { kind: 'failed'; message: string };

const MAX_FRAMES = 255;
const MIN_FRAMES = 20;

const framesFor = (info: QrFrameInfo) =>
  signFrames(0, Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, info.seq_len * 4)));

/** Shows the stored proposal to a LeekWallet board as an animated `ur:leek-pczt`, then reads its `ur:leek-zsig` reply and broadcasts. */
export function LeekSign({ navigation }: LeekSignProps) {
  const { translate, server } = useContext(ContextAppLoaded);
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [phase, setPhase] = useState<Phase>({ kind: 'building' });
  const [preset, setPreset] = useState<QrPreset>(QR_PRESETS[0]);
  const settled = useRef(false);
  const finishing = useRef(false);

  const fail = (message: string) => {
    if (!settled.current) {
      settled.current = true;
      settleBoardSignature({ kind: 'error', message });
    }
    setPhase({ kind: 'failed', message });
  };

  useEffect(() => {
    let live = true;
    (async () => {
      const saved = await readPreset();
      setPreset(saved);
      const frames = await framesFor(await signStart(saved.fragmentLen));
      if (live) {
        setPhase({ kind: 'show', frames });
      }
    })().catch((error: Error) => fail(error.message));
    return () => {
      live = false;
      if (!finishing.current) {
        signAbandon().catch(() => undefined);
      }
      if (!settled.current) {
        settled.current = true;
        settleBoardSignature({ kind: 'error', message: 'cancelled' });
      }
    };
  }, []);

  const choose = async (key: QrPreset['key']) => {
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
      const txids = await signFinish();
      settled.current = true;
      settleBoardSignature({ kind: 'sent', txids });
      navigation.goBack();
    }
  };

  const cancel = async () => {
    await signAbandon().catch(() => undefined);
    if (!settled.current) {
      settled.current = true;
      settleBoardSignature({ kind: 'error', message: 'cancelled' });
    }
    navigation.goBack();
  };

  const showing = phase.kind === 'show';

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
            <SegmentedSwitch
              testID="leek.sign.preset"
              options={QR_PRESETS.map(p => ({
                key: p.key,
                label: translate(`leek.preset-${p.key}`) as string,
                testID: `leek.sign.preset.${p.key}`,
              }))}
              value={preset.key}
              onChange={key => {
                choose(key).catch((error: Error) => fail(error.message));
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
        {phase.kind !== 'finishing' && (
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
