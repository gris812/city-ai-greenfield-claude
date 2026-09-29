/**
 * Pair this phone as an operator device: scan the web console's QR (expo-camera barcode
 * scanner) or type the code → POST /v1/admin/pairing/redeem → device token in the keystore.
 * Also reached from the deep link telvey://pair?code=…&api=… (app/pair.tsx).
 */
import { parsePairingPayload } from '@city/client';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { adminStore } from '../../src/admin/store';
import { Banner, Button, Card, IconButton, Screen, T } from '../../src/components/ui';
import { useT } from '../../src/store/hooks';
import { radius, size, space, typeStyle, useTheme } from '../../src/theme/theme';

export default function Pair() {
  const params = useLocalSearchParams<{ code?: string; api?: string; scan?: string }>();
  const t = useT();
  const { c } = useTheme();
  const [perm, requestPerm] = useCameraPermissions();
  const [scanning, setScanning] = useState(params.scan === '1');
  const [code, setCode] = useState((params.code ?? '').toUpperCase());
  const [qrApi, setQrApi] = useState<string | null>(params.api ?? null);
  const [deviceName, setDeviceName] = useState(Device.deviceName ?? Device.modelName ?? 'Phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  const submit = async (c0 = code, api = qrApi) => {
    setBusy(true);
    setError(null);
    const r = await adminStore().pair(c0, deviceName, api);
    setBusy(false);
    if (r.ok) {
      router.replace('/admin');
      return;
    }
    setError(r.reason === 'api_mismatch' ? t.pairWrongApi : r.reason === 'no_api' || r.reason === 'unreachable' ? t.apiNotConnectedAdmin : t.pairInvalid);
    handled.current = false;
  };

  const inputStyle = [typeStyle('title-2'), { minHeight: size.touchMin + 8, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space['3'], color: c.text, backgroundColor: c.surface2, letterSpacing: 2 }];

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
        <IconButton icon="chevron-back" label={t.back} onPress={() => router.back()} />
        <T v="title-1" accessibilityRole="header" style={{ flex: 1 }}>
          {t.adminConnectTitle}
        </T>
      </View>
      <T v="body" color={c.text2}>
        {t.adminConnectBody}
      </T>
      {error ? <Banner text={error} tone="error" icon="alert-circle" /> : null}

      {scanning ? (
        perm?.granted ? (
          <View style={{ height: 300, borderRadius: radius.lg, overflow: 'hidden' }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(r) => {
                if (handled.current) return;
                const p = parsePairingPayload(r.data);
                if (!p) return;
                handled.current = true;
                setScanning(false);
                setCode(p.code);
                setQrApi(p.api);
                void submit(p.code, p.api);
              }}
              accessibilityLabel={t.scanQr}
            />
          </View>
        ) : (
          <Card>
            {perm && !perm.canAskAgain ? <Banner text={t.cameraDenied} tone="warn" icon="camera-outline" /> : null}
            <Button icon="camera-outline" label={t.allow} onPress={() => void requestPerm()} />
            <Button kind="ghost" label={t.enterCode} onPress={() => setScanning(false)} />
          </Card>
        )
      ) : (
        <Button kind="secondary" icon="qr-code-outline" label={t.scanQr} onPress={() => setScanning(true)} />
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: space['3'] }}>
        <T v="overline" color={c.text3}>
          {t.enterCode}
        </T>
        <TextInput
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          placeholder="ABCD1234"
          placeholderTextColor={c.text3}
          accessibilityLabel={t.enterCode}
          style={inputStyle}
        />
        <T v="overline" color={c.text3}>
          {t.deviceName}
        </T>
        <TextInput value={deviceName} onChangeText={setDeviceName} maxLength={80} accessibilityLabel={t.deviceName} style={[typeStyle('body'), { minHeight: size.touchMin, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space['3'], color: c.text, backgroundColor: c.surface2 }]} />
        <Button label={busy ? t.pairing : t.pair} icon="link-outline" busy={busy} disabled={code.length < 6} onPress={() => void submit()} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
