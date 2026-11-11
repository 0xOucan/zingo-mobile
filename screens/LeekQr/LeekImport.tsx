/* eslint-disable react-native/no-inline-styles */
import React, { useContext, useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';

import { space12, space16, space20, space24, useTheme } from '@app/theme';
import { ContextAppLoading } from '@app/context';
import {
  LeekAccount,
  LeekAccountRecord,
  QrProgress,
  scanFeed,
  scanStart,
  scannedAccount,
} from '@app/leek/LeekQrModule';
import Text from '@ui/primitives/Text';
import Button from '@ui/primitives/Button';
import TextField from '@ui/primitives/TextField';
import TitleBar from '@ui/widgets/TitleBar';
import { ChevronLeft } from '@ui/primitives/Icons/Chevron';
import { UrCamera } from './components/UrCamera';

type LeekImportProps = {
  busy: boolean;
  onImport: (
    account: LeekAccount,
    seedFingerprint: string,
    birthday: number,
  ) => void;
  onBack: () => void;
};

type Scan =
  | { kind: 'scanning'; progress?: QrProgress }
  | { kind: 'read'; record: LeekAccountRecord }
  | { kind: 'error'; message: string };

/** Reads the board's View key QR (`ur:leek-zcash-accounts`) and imports its first account as a board-signed wallet. */
export function LeekImport({ busy, onImport, onBack }: LeekImportProps) {
  const { translate, server } = useContext(ContextAppLoading);
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [scan, setScan] = useState<Scan>({ kind: 'scanning' });
  const [attempt, setAttempt] = useState(0);
  const [birthday, setBirthday] = useState('');

  useEffect(() => {
    scanStart('account', server.chainName).catch((error: Error) =>
      setScan({ kind: 'error', message: error.message }),
    );
  }, [server.chainName, attempt]);

  const onText = async (text: string) => {
    if (scan.kind !== 'scanning') {
      return;
    }
    const progress = await scanFeed(text);
    if (progress.state === 'complete') {
      const record = await scannedAccount();
      const first = record.accounts[0];
      setBirthday(first?.birthday ? String(first.birthday) : '');
      setScan({ kind: 'read', record });
    } else if (progress.state === 'refused') {
      setScan({ kind: 'error', message: progress.error });
    } else if (progress.state === 'accepted') {
      setScan({ kind: 'scanning', progress });
    }
  };

  const account = scan.kind === 'read' ? scan.record.accounts[0] : undefined;
  const height = Number(birthday);
  const restart = () => {
    setScan({ kind: 'scanning' });
    setAttempt(a => a + 1);
  };

  return (
    <View style={{ flex: 1 }}>
      <TitleBar
        title={translate('leek.import-title') as string}
        left={{
          icon: ChevronLeft,
          onPress: onBack,
          accessibilityLabel: translate('import.back-acc') as string,
          testID: 'leek.import.back',
          accent: true,
          disabled: busy,
        }}
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space20,
          paddingBottom: space24,
          gap: space16,
          alignItems: 'center',
        }}
      >
        {scan.kind === 'scanning' && (
          <>
            <Text variant="body" style={{ textAlign: 'center' }}>
              {translate('leek.import-hint') as string}
            </Text>
            <UrCamera
              active={scan.kind === 'scanning'}
              size={width - space20 * 2}
              onText={text =>
                onText(text).catch((error: Error) =>
                  setScan({ kind: 'error', message: error.message }),
                )
              }
            />
            <Text variant="bodyStrong" testID="leek.import.progress">
              {scan.progress
                ? `${scan.progress.received} / ${scan.progress.total} (${scan.progress.percent}%)`
                : (translate('leek.scan-waiting') as string)}
            </Text>
          </>
        )}
        {scan.kind === 'error' && (
          <>
            <Text
              variant="body"
              style={{ color: colors.fgDanger, textAlign: 'center' }}
            >
              {scan.message}
            </Text>
            <Button
              variant="secondary"
              testID="leek.import.retry"
              title={translate('leek.scan-again') as string}
              onPress={restart}
            />
          </>
        )}
        {scan.kind === 'read' && !account && (
          <Text variant="body">{translate('leek.import-empty') as string}</Text>
        )}
        {scan.kind === 'read' && account && (
          <View style={{ alignSelf: 'stretch', gap: space12 }}>
            <Text variant="bodyStrong">
              {(translate('leek.import-account') as string).replace(
                '{index}',
                String(account.index),
              )}
              {account.name ? ` · ${account.name}` : ''}
            </Text>
            <Text variant="caption" tone="muted" testID="leek.import.ufvk">
              {`${account.ufvk.slice(0, 24)}…${account.ufvk.slice(-12)}`}
            </Text>
            <Text variant="caption" tone="muted">
              {(translate('leek.import-fingerprint') as string).replace(
                '{fp}',
                scan.record.seed_fingerprint.slice(0, 16),
              )}
            </Text>
            <TextField
              label={translate('import.birthday') as string}
              testID="leek.import.birthday"
              placeholder={translate('import.birthday-placeholder') as string}
              value={birthday}
              onChangeText={(text: string) =>
                setBirthday(text.replace(/\D/g, ''))
              }
              keyboardType="number-pad"
            />
            <Button
              variant="primary"
              testID="leek.import.ok"
              title={translate('leek.import-ok') as string}
              disabled={!(height > 0)}
              busy={busy}
              onPress={() =>
                onImport(account, scan.record.seed_fingerprint, height)
              }
            />
            <Button
              variant="text"
              testID="leek.import.rescan"
              title={translate('leek.scan-again') as string}
              disabled={busy}
              onPress={restart}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
