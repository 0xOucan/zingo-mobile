/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { TranslateType } from '@app/AppState';
import { space12 } from '@app/theme';
import { LeekLink, LinkStatus, linkStatus } from '@app/leek/LeekLinkModule';
import Text from '@ui/primitives/Text';

const POLL_MS = 250;

/** The native link's current step, read every 250 ms while `active`. */
export const useLinkStatus = (active: boolean): LinkStatus => {
  const [status, setStatus] = useState<LinkStatus>({ stage: 'idle' });
  useEffect(() => {
    if (!active) {
      return;
    }
    let live = true;
    const read = () =>
      linkStatus()
        .then(next => {
          if (live) {
            setStatus(next);
          }
        })
        .catch(() => undefined);
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active]);
  return status;
};

type LinkProgressProps = {
  link: LeekLink;
  status: LinkStatus;
  translate: (key: string) => TranslateType;
};

/** What the user does on the board at the link's current step, with the pairing code to compare. */
export function LinkProgress({ link, status, translate }: LinkProgressProps) {
  const t = (key: string) => translate(key) as string;
  const line = (() => {
    switch (status.stage) {
      case 'idle':
      case 'connecting':
        return t(`leek.link-connecting-${link}`);
      case 'pair':
        return t('leek.link-pair');
      case 'unlock':
        return t('leek.link-unlock');
      case 'connected':
        return t('leek.link-connected');
      case 'share':
        return t('leek.link-share');
      case 'building':
        return t('leek.sign-building');
      case 'checking':
        return t('leek.link-checking');
      case 'uploading':
        return t('leek.link-uploading')
          .replace('{sent}', String(status.sent ?? 0))
          .replace('{total}', String(status.total ?? 0));
      case 'review':
        return t('leek.link-review');
      case 'applying':
        return t('leek.link-applying');
      case 'proving':
        return t('leek.sign-finishing');
      case 'address':
        return t('leek.link-address');
    }
  })();
  return (
    <View style={{ alignSelf: 'stretch', alignItems: 'center', gap: space12 }}>
      {status.stage === 'pair' && status.code && (
        <Text variant="balance" testID="leek.link.code">
          {`${status.code.slice(0, 3)} ${status.code.slice(3)}`}
        </Text>
      )}
      <Text
        variant="body"
        testID="leek.link.stage"
        style={{ textAlign: 'center' }}
      >
        {line}
      </Text>
      {!!status.update && (
        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {status.update}
        </Text>
      )}
    </View>
  );
}
