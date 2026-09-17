import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.kramdath.storytalereader',
  appName: 'Story Tale Reader',
  webDir: 'dist',
  android: {
    // Books are stored in OPFS and served by a service worker, both of which need a
    // secure context. https://localhost gives the WebView one.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
