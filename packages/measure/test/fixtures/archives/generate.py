"""Generates the archive fixtures with Python's zipfile and Info-ZIP's zip, deterministically.

APK, AAB and IPA files are ZIP archives; these fixtures have their real layouts (paths,
stored vs deflated entries) with placeholder contents, plus the real Hermes bytecode from
../hermes/index.android.hbc as the JS bundle. Run from this directory: python3 generate.py
"""
import os
import random
import subprocess
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
HBC = open(os.path.join(HERE, '..', 'hermes', 'index.android.hbc'), 'rb').read()
rng = random.Random(42)


def noise(size):
    return bytes(rng.getrandbits(8) for _ in range(size))


def text(size):
    words = [b'function', b'return', b'const', b'value', b'usertax', b'bundle', b'module']
    out = bytearray()
    while len(out) < size:
        out += rng.choice(words) + b' '
    return bytes(out[:size])


def write(name, entries):
    with zipfile.ZipFile(os.path.join(HERE, name), 'w') as archive:
        for path, data, method in entries:
            info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = method
            archive.writestr(info, data)


STORED, DEFLATED = zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED

write('app-release.apk', [
    ('AndroidManifest.xml', text(1200), DEFLATED),
    ('classes.dex', text(9000), DEFLATED),
    ('classes2.dex', text(4000), DEFLATED),
    ('resources.arsc', noise(3000), STORED),
    ('res/drawable-xxhdpi-v4/icon.png', noise(2500), STORED),
    ('res/layout/main.xml', text(300), DEFLATED),
    ('lib/arm64-v8a/libhermes.so', noise(12000), DEFLATED),
    ('lib/arm64-v8a/libreactnative.so', noise(8000), DEFLATED),
    ('assets/index.android.bundle', HBC, DEFLATED),
    ('assets/fonts/Inter.ttf', noise(2000), STORED),
    ('META-INF/CERT.SF', text(400), DEFLATED),
])

write('app-release.aab', [
    ('base/manifest/AndroidManifest.xml', text(1200), DEFLATED),
    ('base/dex/classes.dex', text(9000), DEFLATED),
    ('base/lib/arm64-v8a/libhermes.so', noise(12000), DEFLATED),
    ('base/res/drawable/icon.png', noise(2500), STORED),
    ('base/resources.pb', noise(1500), DEFLATED),
    ('base/assets/index.android.bundle', text(6000), DEFLATED),
    ('base/assets/images/logo.png', noise(1800), STORED),
    ('BUNDLE-METADATA/com.android.tools.build.libraries/dependencies.pb', noise(1200), DEFLATED),
    ('META-INF/MANIFEST.MF', text(200), DEFLATED),
])

write('Example.ipa', [
    ('Payload/Example.app/Example', noise(14000), DEFLATED),
    ('Payload/Example.app/Info.plist', text(900), DEFLATED),
    ('Payload/Example.app/main.jsbundle', HBC, DEFLATED),
    ('Payload/Example.app/Assets.car', noise(5000), DEFLATED),
    ('Payload/Example.app/Frameworks/hermes.framework/hermes', noise(11000), DEFLATED),
    ('Payload/Example.app/en.lproj/Localizable.strings', text(1500), DEFLATED),
    ('Payload/Example.app/assets/node_modules/@expo/logo.png', noise(1600), STORED),
    ('Payload/Example.app/_CodeSignature/CodeResources', text(1100), DEFLATED),
])

# ZIP64 records forced by Info-ZIP (zip -fz), and an archive with a comment, without extensions.
work = os.path.join(HERE, 'work')
os.makedirs(os.path.join(work, 'Payload', 'Big.app'), exist_ok=True)
with open(os.path.join(work, 'Payload', 'Big.app', 'Big'), 'wb') as f:
    f.write(noise(4000))
with open(os.path.join(work, 'Payload', 'Big.app', 'main.jsbundle'), 'wb') as f:
    f.write(HBC)
for name in ('zip64-ipa', 'commented'):
    path = os.path.join(HERE, name)
    if os.path.exists(path):
        os.remove(path)
subprocess.run(['zip', '-q', '-X', '-fz', '-r', os.path.join(HERE, 'zip64-ipa'), 'Payload'], cwd=work, check=True)
subprocess.run(['zip', '-q', '-X', '-r', os.path.join(HERE, 'commented'), 'Payload'], cwd=work, check=True)
subprocess.run(['zip', '-q', '-z', os.path.join(HERE, 'commented')], input=b'built by usertax tests\n.\n', check=True)
for name in ('zip64-ipa.zip', 'commented.zip'):
    os.replace(os.path.join(HERE, name), os.path.join(HERE, name[:-4]))
subprocess.run(['rm', '-rf', work], check=True)

with open(os.path.join(HERE, 'not-a-zip.apk'), 'wb') as f:
    f.write(b'this is not a zip archive\n')
