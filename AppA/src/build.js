const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');

const SRC_DIR  = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');

function readFile(name) {
    return fs.readFileSync(path.join(SRC_DIR, name), 'utf-8');
}

function build() {
    console.log(`Building App A (Phase ${pkg.config.phase.replace('Phase_', '').replace(/_/g, '.')})...`);

    if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR);

    const template = readFile('index.html.template');
    const css      = readFile('style.css');

    const headerHtml  = readFile('header.html');
    const manageHtml  = readFile('manage.html');
    const appHtml     = readFile('introduction.html');
    let   devHtml     = readFile('dev.html');
    const specHtml    = readFile('spec.html');
    const installHtml = readFile('install_guide.html');

    // dev.html内のプレースホルダーにspec・installを展開する
    devHtml = devHtml.replace(/<!-- INSERT: SPEC_CONTENT -->/g,    specHtml);
    devHtml = devHtml.replace(/<!-- INSERT: INSTALL_CONTENT -->/g,  installHtml);

    // JSファイルを結合（piexif.jsを先頭に）
    const jsFiles = [
        'piexif.js',
        '1_script_map.js',
        '1_script_sketch.js',
        '2_script_photo.js',
        '3_script_main.js'
    ];
    const fullJs = jsFiles.map(f => readFile(f)).join('\n\n');

    const phaseDisplay = pkg.config.phase.replace('Phase_', '').replace(/_/g, '.');

    let html = template;
    html = html.replace(/\{\{PHASE_DISPLAY\}\}/g,             phaseDisplay);
    html = html.replace(/\/\* INSERT: CSS \*\//g,           css);
    html = html.replace(/<!-- INSERT: HEADER -->/g,          headerHtml);
    html = html.replace(/<!-- INSERT: MANAGE_CONTENT -->/g,  manageHtml);
    html = html.replace(/<!-- INSERT: APP_CONTENT -->/g,     appHtml);
    html = html.replace(/<!-- INSERT: DEV_CONTENT -->/g,     devHtml);
    html = html.replace(/\/\* INSERT: JS \*\//g,             fullJs);

    // ロゴをBase64で埋め込み
    try {
        const logoBase64 = readFile('rogo-AAA.txt').trim();
        html = html.replace(/\{\{LOGO_SRC\}\}/g, `data:image/png;base64,${logoBase64}`);
    } catch (e) {
        console.warn('ロゴファイル未検出（rogo-AAA.txt）。LOGO_SRCは空のままです。');
    }

    const outPath = path.join(DIST_DIR, `application_${phaseDisplay.replace(/\./g, '_')}.html`);
    fs.writeFileSync(outPath, html, 'utf-8');
    console.log(`Build complete: ${outPath}`);
}

try {
    build();
} catch (e) {
    console.error('Build failed:', e);
    process.exit(1);
}
