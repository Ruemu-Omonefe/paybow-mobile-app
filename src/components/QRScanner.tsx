import React, { useRef } from 'react';
import { Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button } from './ui';
import { caption, colors, h2 } from '../theme';

/** Camera QR scanner. Scanned data is UNTRUSTED input – callers must parse + validate it. */
export function QRScanner({ title, onScan, onCancel }: { title: string; onScan: (data: string) => void; onCancel: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  if (!permission) return <View style={{ flex: 1 }} />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <Text style={h2}>Camera access needed</Text>
        <Text style={[caption, { textAlign: 'center' }]}>Paybow uses the camera only to scan payment QR codes.</Text>
        <Button title="Allow camera" onPress={requestPermission} />
        <Button title="Cancel" kind="outline" onPress={onCancel} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return; // one scan per session
          handled.current = true;
          onScan(data);
        }}
      />
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 250, height: 250, borderRadius: 24, borderWidth: 4, borderColor: colors.accent }} />
      </View>
      <View style={{ position: 'absolute', top: 16, left: 0, right: 0, alignItems: 'center' }}>
        <Text style={{ color: colors.white, fontWeight: '700', backgroundColor: 'rgba(53,35,25,0.8)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 }}>{title}</Text>
      </View>
      <View style={{ position: 'absolute', bottom: 24, left: 24, right: 24 }}>
        <Button title="Cancel" kind="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}
