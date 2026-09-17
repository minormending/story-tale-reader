# Releasing

## GitHub Pages (automatic)

Every push to `main` builds and deploys the web app to
<https://minormending.github.io/story-tale-reader/>. Nothing to do.

## Android APK

Tag a release and the `Android APK` workflow builds and attaches the APK:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

You can also run the workflow manually from the Actions tab to get an APK artefact
without cutting a release.

### Signing — do this once

Without signing secrets the workflow still produces a working **debug-signed** APK,
which installs fine but cannot upgrade an app installed from a differently-signed
build. For anything you expect people to keep and update, create a release keystore:

```bash
keytool -genkeypair -v \
  -keystore story-tale-reader.keystore \
  -alias story-tale-reader \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then add four repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_B64` | `base64 -i story-tale-reader.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_ALIAS` | `story-tale-reader` |
| `ANDROID_KEY_PASSWORD` | the key password |

> **Back the keystore file up somewhere outside this repository.** Android refuses to
> upgrade an installed app that was signed with a different key. Losing the keystore
> means every user has to uninstall and reinstall, losing their library.

The keystore file itself is never committed — `*.keystore` and `*.jks` are gitignored,
and the workflow decodes the secret into a temporary directory on the runner.

## Version numbers

`versionName` comes from the tag (`v0.2.0` → `0.2.0`) and `versionCode` from the
workflow run number, so it always increases. Both are read from the environment by
`android/app/build.gradle`; nothing needs editing by hand.

## Icons

App icons are generated from `public/icon.svg`:

```bash
npm run icons
```

This rasterises the SVG and regenerates every Android density. Commit the result.
