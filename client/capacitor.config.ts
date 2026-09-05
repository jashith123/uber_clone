import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.swiftride.app',
  appName: 'SwiftRide',
  webDir: 'dist',
  android: {
    // The bundled UI runs at https://localhost inside the app; the API on the
    // PC is plain http during testing, so mixed content must be allowed.
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;
