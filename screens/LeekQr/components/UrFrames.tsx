import React, { useEffect, useMemo, useState } from 'react';
import Svg, { Path } from 'react-native-svg';
import { create } from 'qrcode';

import { themeTokens } from '@app/theme';

const QUIET = 2;
const INK = themeTokens.fgQrInk;
const PAPER = themeTokens.bgQrPaper;

const modulesPath = (
  text: string,
  version: number,
): { d: string; units: number } => {
  const { modules } = create(text, { errorCorrectionLevel: 'L', version });
  let d = '';
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) {
        d += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
      }
    }
  }
  return { d, units: modules.size + QUIET * 2 };
};

type UrFramesProps = {
  frames: string[];
  frameMs: number;
  size: number;
};

/** Shows each frame of an animated UR in turn, every frame at the longest one's QR version, with a two-module quiet zone. */
export function UrFrames({ frames, frameMs, size }: UrFramesProps) {
  const [index, setIndex] = useState(0);
  const paths = useMemo(() => {
    if (frames.length === 0) {
      return [];
    }
    const longest = frames.reduce((a, b) => (b.length > a.length ? b : a), '');
    const { version } = create(longest, { errorCorrectionLevel: 'L' });
    return frames.map(frame => modulesPath(frame, version));
  }, [frames]);

  useEffect(() => {
    const timer = setInterval(() => setIndex(i => i + 1), frameMs);
    return () => clearInterval(timer);
  }, [frameMs]);

  const code = paths[index % paths.length];
  if (!code) {
    return undefined;
  }
  return (
    <Svg
      testID="leek.qr.frames"
      width={size}
      height={size}
      viewBox={`0 0 ${code.units} ${code.units}`}
    >
      <Path
        d={`M0 0h${code.units}v${code.units}h-${code.units}z`}
        fill={PAPER}
      />
      <Path d={code.d} fill={INK} />
    </Svg>
  );
}
