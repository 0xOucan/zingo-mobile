import { useEffect, useState } from 'react';

import { TranslateType } from '@app/AppState';
import {
  QrBrightness,
  nextBrightness,
  readBrightness,
  writeBrightness,
} from '@app/leek/boardWallet';
import { holdScreen, releaseScreen } from '@app/leek/LeekQrModule';

/** Keeps the screen on at the remembered QR brightness while `active`, with the step that cycles it. */
export const useQrBrightness = (
  active: boolean,
): { level: QrBrightness; cycle: () => void } => {
  const [level, setLevel] = useState<QrBrightness>('system');

  useEffect(() => {
    readBrightness()
      .then(setLevel)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (active) {
      holdScreen(level === 'system' ? level : level / 100).catch(
        () => undefined,
      );
    }
  }, [active, level]);

  useEffect(() => {
    if (!active) {
      return;
    }
    return () => {
      releaseScreen().catch(() => undefined);
    };
  }, [active]);

  const cycle = () => {
    const next = nextBrightness(level);
    setLevel(next);
    writeBrightness(next).catch(() => undefined);
  };

  return { level, cycle };
};

/** The brightness control's label, as "Brightness: 60 %". */
export const brightnessLabel = (
  level: QrBrightness,
  translate: (key: string) => TranslateType,
): string =>
  (translate('leek.brightness') as string).replace(
    '{level}',
    level === 'system'
      ? (translate('leek.brightness-system') as string)
      : `${level} %`,
  );
