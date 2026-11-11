/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Camera,
  Code,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';

import { radiusMd, useTheme } from '@app/theme';

type UrCameraProps = {
  active: boolean;
  size: number;
  onText: (text: string) => void;
};

/** A square camera view that hands every new QR text it decodes to `onText`, frame after frame. */
export function UrCamera({ active, size, onText }: UrCameraProps) {
  const { colors } = useTheme();
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const last = useRef('');
  const latest = useRef(onText);
  latest.current = onText;

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes: Code[]) => {
      codes.forEach(code => {
        const text = code.value?.trim();
        if (text && text !== last.current) {
          last.current = text;
          latest.current(text);
        }
      });
    },
  });

  return (
    <View
      testID="leek.camera"
      style={{
        width: size,
        height: size,
        borderRadius: radiusMd,
        overflow: 'hidden',
        backgroundColor: colors.bgSurface,
      }}
    >
      {hasPermission && device && (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={active}
          codeScanner={codeScanner}
          androidPreviewViewType="texture-view"
        />
      )}
    </View>
  );
}
