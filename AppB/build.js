const fs = require('fs');
const path = require('path');

// 設定読み込み
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const phase = pkg.phase;
const phaseTag = phase.replace('.', '_');

// ソース読み込みヘルパー（ファイルがない場合のフォールバック付き）
const readSrc = (file, optional = false) => {
    const filePath = path.join(__dirname, 'src', file);
    if (!fs.existsSync(filePath)) {
        if (optional) return `<!-- Missing: ${file} -->`;
        console.warn(`Warning: ${file} not found. Using placeholder.`);
        return "";
    }
    return fs.readFileSync(filePath, 'utf8');
};

const buildManagerApp = () => {
    console.log(`\n--- Build Start: Manager App (Phase ${phase}) ---`);

    const templateFile = 'pc_manager.html.template';
    const outputPrefix = 'manager_app';
    
    // App B 構成ファイル定義
    const scriptFiles = [
        '2_script_core.js',    // 基本構造・地図・UI連動
        '2_script_import.js',  // インポート・エクスポート
        '2_script_db.js',      // データベース表示・編集
        '2_script_report.js',  // 帳票生成エンジン（PDF）
        '2_script_excel.js'    // Excel帳票生成エンジン
    ];

    // ライブラリファイル定義（アプリスクリプトより先に結合する）
    const libFiles = [
        // exceljs.min.jsはJSZip直書き方式に変更したため不要
    ];

    try {
        let output = readSrc(templateFile);
        
        // 1. CSS結合 (共通CSS + テンプレート内固有CSS)
        output = output.split('{{STYLE}}').join(readSrc('style.css'));
        
        // 2. ヘッダー・仕様書結合
        output = output.split('{{HEADER}}').join(readSrc('header.html'));
        output = output.split('{{SPEC}}').join(readSrc('spec.html'));
        
        // 3. スクリプト結合（ライブラリ→アプリスクリプトの順）
        let combinedScript = "";

        // 3-1. ライブラリ（先頭に結合）
        libFiles.forEach(file => {
            combinedScript += `\n/* --- Lib: ${file} --- */\n` + readSrc(file) + "\n";
        });

        // 3-2. アプリスクリプト（モジュール間の依存順序を維持）
        scriptFiles.forEach(file => {
            combinedScript += `\n/* --- Source: ${file} --- */\n` + readSrc(file) + "\n";
        });

        output = output.split('{{SCRIPT}}').join(combinedScript);
        
        // 4. SVGテンプレート置換（ファイルがなければダミーで通過）
        output = output.split('{{SVG_P1}}').join(readSrc('report_p1.svg', true));
        output = output.split('{{SVG_P2}}').join(readSrc('report_p2.svg', true));
        output = output.split('{{SVG_P3}}').join(readSrc('report_p3.svg', true));

        // 5. Excelテンプレートをbase64で埋め込む
        const xlsxPath = path.join(__dirname, 'src', 'template.xlsx');
        let xlsxBase64 = "";
        if (fs.existsSync(xlsxPath)) {
            xlsxBase64 = fs.readFileSync(xlsxPath).toString('base64');
            console.log(`✔ template.xlsx loaded (${Math.round(xlsxBase64.length / 1024)}KB base64)`);
        } else {
            console.warn("Warning: template.xlsx not found.");
        }
        output = output.split('{{XLSX_TEMPLATE}}').join(xlsxBase64);

        // 6. ロゴとフェーズ情報の置換
        // BOM除去とトリミングを行い、純粋な文字列として埋め込む
        let logoData = "";
        try {
            logoData = readSrc('rogo-AAA.txt', true).replace(/^\uFEFF/, '').trim().replace(/[\r\n\t]/g, '');
        } catch (e) {
            console.warn("Logo data processing failed, empty string used.");
        }
        output = output.split('{{PHASE}}').join(phase);
        output = output.split('{{LOGO_DATA}}').join(logoData);

        // 7. 出力
        if (!fs.existsSync('./dist')) fs.mkdirSync('./dist');
        const fileName = `${outputPrefix}_P${phaseTag}.html`;
        const outputPath = path.join(__dirname, 'dist', fileName);
        
        fs.writeFileSync(outputPath, output);
        console.log(`✔ Build success: dist/${fileName}`);

    } catch (err) {
        console.error(`✘ Build failed:`, err);
        process.exit(1);
    }
};

// 実行
buildManagerApp();
