const fs = require('fs');
const path = require('path');

const packageJson = require('./package.json');
const PHASE = packageJson.config.phase;
const VERSION = packageJson.version;
const PHASE_DISPLAY = `Phase ${VERSION.split('.').slice(0, 2).join('.')}`;

const DIST_DIR = path.join(__dirname, 'dist');
const SRC_DIR = path.join(__dirname, 'src');
const OUTPUT_FILE = path.join(DIST_DIR, `application_${PHASE}.html`);

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR);

const readFile = (filename) => fs.readFileSync(path.join(SRC_DIR, filename), 'utf8');
const copyFile = (filename) => {
    const srcPath = path.join(SRC_DIR, filename);
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(DIST_DIR, filename));
    }
};

console.log(`Building App A (${PHASE_DISPLAY})...`);

try {
    let html = readFile('index.html.template');

    const css = readFile('style.css');

    // piexif.js を src/ 直下から読み込む。
    // CDNではなくローカルファイルとして結合することで、
    // オフライン環境でもEXIF書き込みが確実に動作する。
    const piexifJs = readFile('piexif.js');

    const jsMap    = readFile('1_script_map.js');
    const jsSketch = readFile('1_script_sketch.js');
    const jsPhoto  = readFile('2_script_photo.js');
    const jsMain   = readFile('3_script_main.js');

    // piexif.js を先頭に結合することで後続スクリプトから piexif オブジェクトを参照できる
    const fullJs = `${piexifJs}\n\n${jsMap}\n\n${jsSketch}\n\n${jsPhoto}\n\n${jsMain}`;

    const headerHtml  = readFile('header.html');
    const manageHtml  = readFile('manage.html');
    const appHtml     = readFile('introduction.html');
    let   devHtml     = readFile('dev.html');
    const specHtml    = readFile('spec.html');
    const installHtml = readFile('install_guide.html');

    // dev.html内のプレースホルダーにspec・installを展開する
    devHtml = devHtml.replace(/<!-- INSERT: SPEC_CONTENT -->/g,    specHtml);
    devHtml = devHtml.replace(/<!-- INSERT: INSTALL_CONTENT -->/g,  installHtml);

    let logoData = readFile('rogo-AAA.txt').trim();
    logoData = logoData.replace(/^\uFEFF/, '').replace(/\s/g, '');

    // 【修正】すべての出現箇所を置換するために正規表現を使用
    html = html.replace(/\/\* INSERT: CSS \*\//g,           css);
    html = html.replace(/<!-- INSERT: HEADER -->/g,          headerHtml);
    html = html.replace(/<!-- INSERT: MANAGE_CONTENT -->/g,  manageHtml);
    html = html.replace(/<!-- INSERT: APP_CONTENT -->/g,     appHtml);
    html = html.replace(/<!-- INSERT: DEV_CONTENT -->/g,     devHtml);
    html = html.replace(/\/\* INSERT: JS \*\//g,             fullJs);

    html = html.replace(/{{LOGO_SRC}}/g, logoData);
    html = html.replace(/{{PHASE_DISPLAY}}/g, PHASE_DISPLAY);

    fs.writeFileSync(OUTPUT_FILE, html);

    copyFile('manifest.json');
    copyFile('sw.js');
    copyFile('icon.png');
    console.log('Copied PWA files to dist/');

    console.log(`Build complete: ${OUTPUT_FILE}`);

} catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
}
