// --- Excel帳票生成エンジン ---
// ExcelJSを使わず、JSZipでsharedStrings.xmlとsheet1.xmlを直接書き換える。
// template.xlsxの構造を一切壊さない（exe版appc_xml_writer.pyと同方式）。
// 画像：drawing1.xmlのxdr:spをxdr:picに変換（appc_image_writer.pyと同方式）。

Object.assign(window.managerApp, {

    // --- 個別Excel出力 ---
    async generateExcel() {
        const data = this.db.find(d => d._key === this.currentKey);
        if (!data) return;
        if (!confirm("Excel帳票を生成します。よろしいですか？")) return;

        managerApp.showProgress("Excel帳票生成中...", 1, 1);
        const originalTab = this.switchToMapTab();
        try {
            await new Promise(r => setTimeout(r, 500));
            const maps = await managerApp.captureMapFinal(data);
            const blob = await managerApp._buildExcelBlob([{ data, maps }]);
            managerApp._downloadBlob(blob, `report_${data.ref_no || 'output'}.xlsx`);
        } catch(e) {
            console.error(e);
            alert("Excel生成エラー: " + e.message);
        } finally {
            this.restoreTab(originalTab);
            managerApp.hideProgress();
        }
    },

    // --- 一括Excel出力 ---
    async batchExcel() {
        const selectedKeys = Array.from(document.querySelectorAll('.db-check:checked')).map(cb => cb.dataset.key);
        if (selectedKeys.length === 0) return alert("箇所を選択してください。");
        if (!confirm(`${selectedKeys.length}件のExcel帳票を一括生成します。\n※1件ずつのxlsxをZIPにまとめて出力します。`)) return;

        this.isAborted = false;
        const originalTab = this.switchToMapTab();
        await new Promise(r => setTimeout(r, 1000));
        this.map.invalidateSize();

        const outputZip = new JSZip();

        try {
            for (let i = 0; i < selectedKeys.length; i++) {
                if (this.isAborted) break;
                const data = this.db.find(d => d._key === selectedKeys[i]);
                managerApp.showProgress(`処理中... (${i + 1}/${selectedKeys.length})`, i + 1, selectedKeys.length);
                const maps = await managerApp.captureMapFinal(data);
                const blob = await managerApp._buildExcelBlob([{ data, maps }]);
                const arrayBuffer = await blob.arrayBuffer();
                const fileName = `report_${data.ref_no || String(i + 1).padStart(4, '0')}.xlsx`;
                outputZip.file(fileName, arrayBuffer);
            }

            if (!this.isAborted) {
                managerApp.showProgress("ZIPファイル生成中...", selectedKeys.length, selectedKeys.length);
                const zipBlob = await outputZip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
                const now = new Date();
                const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
                managerApp._downloadBlob(zipBlob, `report_batch_${selectedKeys.length}件_${ts}.zip`);
            }
        } catch(e) {
            console.error(e);
            alert("Excel一括生成エラー: " + e.message);
        } finally {
            this.restoreTab(originalTab);
            managerApp.hideProgress();
        }
    },

    // --- Excelファイル生成 ---
    // template.xlsxをベースにsharedStrings・sheet.xml・drawing1.xmlだけを書き換える。
    // 1件 = 1シート。複数件は1シートずつ連結（将来拡張）。現状は1件ずつ個別ファイル出力。
    async _buildExcelBlob(items) {
        const templateBase64 = document.getElementById('xlsx-template-data').value;
        if (!templateBase64) throw new Error("template.xlsxが埋め込まれていません。");

        const templateBin = Uint8Array.from(atob(templateBase64), c => c.charCodeAt(0));

        // 1件ずつZIPを複製して書き換える（複数件は1件目のみ、将来対応）
        // 現状は items[0] の1件だけを対象とする
        const { data, maps } = items[0];

        const zip = await JSZip.loadAsync(templateBin.buffer);

        // --- sharedStrings.xmlを読み込んで書き換え ---
        let sharedXml = await zip.file('xl/sharedStrings.xml').async('string');
        const sharedStrings = managerApp._parseSharedStrings(sharedXml);

        // --- sheet1.xmlを読み込んで書き換え ---
        let sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');

        // フィールドを書き込む
        const fw = (v) => (v && v !== "選択...") ? String(v).trim() : "-";
        const fwDate = (v) => managerApp.formatWareki(v) || "-";
        const fwCheck = (field, val) => (data[field] === val) ? "✓" : " ";
        const zenkei = (data._photos || []).find(p => p.tag === '全景');
        const kinkei = (data._photos || []).find(p => p.tag === '近景');
        const extra  = (data._photos || []).filter(p => p.tag !== '全景' && p.tag !== '近景');

        const cellMap = {
            'Z1':  fw(data.ref_no),
            'Z2':  fwDate(data.survey_date),
            'G3':  fw(data.disaster_no),
            'G4':  fw(data.dept_name),
            'G5':  fw(data.loc_name),
            'G6':  fw(data.route_name),
            'K7':  fwDate(data.damage_date),
            'H9':  fw(data.length),
            'H10': fw(data.height),
            'G11': fw(data.side_type),
            'G12': fw(data.distance_label),
            'O9':  fw(data.comment),
            'G13': fwCheck('expansion_exists', '有'),
            'J13': fwCheck('expansion_exists', '無'),
            'O13': fw(data.expansion_status),
            'K46': managerApp.getCoordsText(data) || "-",
            'G48': fwCheck('special_exists', '有'),
            'J48': fwCheck('special_exists', '無'),
            'O48': fw(data.special_status),
            'K50': fw(data.plan_summary),
            'J52': fw(data.company_name),
            'L53': fw(data.tel),
            'X53': fw(data.fax),
            'J54': fw(data.person_name),
            'U54': fw(data.email),
            'Z56':  fw(data.ref_no),
            'Z57':  fwDate(data.survey_date),
            'G58':  fw(data.disaster_no),
            'G59':  fw(data.loc_name),
            'G60':  fw(data.route_name),
            'B85':  fw(zenkei ? zenkei.memo : ""),
            'B109': fw(kinkei ? kinkei.memo : ""),
            'Z111': fw(data.ref_no),
            'Z112': fwDate(data.survey_date),
            'G113': fw(data.disaster_no),
            'G114': fw(data.loc_name),
            'G115': fw(data.route_name),
            'W117': fw(extra[0] ? extra[0].memo : ""),
            'W133': fw(extra[1] ? extra[1].memo : ""),
            'W149': fw(extra[2] ? extra[2].memo : ""),
        };

        // セルを書き換え
        for (const [cell, value] of Object.entries(cellMap)) {
            const result = managerApp._writeCell(sheetXml, sharedStrings, cell, value);
            sheetXml = result.sheetXml;
            // sharedStringsは参照渡しで更新される
        }

        // sharedStrings.xmlを再構築
        sharedXml = managerApp._buildSharedStringsXml(sharedStrings);

        zip.file('xl/worksheets/sheet1.xml', sheetXml);
        zip.file('xl/sharedStrings.xml', sharedXml);

        // --- 画像を差し込む ---
        const imageMap = new Map();
        if (maps && maps.zentai)  imageMap.set('ichizu_zentai',  maps.zentai);
        if (maps && maps.kakudai) imageMap.set('ichizu_kakudai', maps.kakudai);
        if (zenkei)   imageMap.set('photo_zenkei', zenkei.dataUrl);
        if (kinkei)   imageMap.set('photo_kinkei', kinkei.dataUrl);
        if (extra[0]) imageMap.set('photo_1', extra[0].dataUrl);
        if (extra[1]) imageMap.set('photo_2', extra[1].dataUrl);
        if (extra[2]) imageMap.set('photo_3', extra[2].dataUrl);

        if (imageMap.size > 0) {
            await managerApp._injectImages(zip, imageMap);
        }

        const buffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
        return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    },

    // --- sharedStrings.xmlをパースして文字列配列を返す ---
    _parseSharedStrings(xml) {
        const strings = [];
        const siRegex = /<si>([\s\S]*?)<\/si>/g;
        let m;
        while ((m = siRegex.exec(xml)) !== null) {
            const tMatch = /<t[^>]*>([^<]*)<\/t>/.exec(m[1]);
            strings.push(tMatch ? tMatch[1] : '');
        }
        return strings;
    },

    // --- sharedStrings配列からXMLを再構築 ---
    _buildSharedStringsXml(strings) {
        const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const parts = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            `<sst xmlns="${ns}" count="${strings.length}" uniqueCount="${strings.length}">`
        ];
        for (const s of strings) {
            parts.push(`<si><t xml:space="preserve">${esc(s)}</t></si>`);
        }
        parts.push('</sst>');
        return parts.join('');
    },

    // --- セルにsharedString方式で値を書き込む ---
    // appc_xml_writer.pyのXlsmWriter.write()と同等の処理
    _writeCell(sheetXml, sharedStrings, cell, value) {
        value = value ? String(value).trim() : '';

        // sharedStringsに値を追加または取得
        let idx = sharedStrings.indexOf(value);
        if (idx === -1) {
            sharedStrings.push(value);
            idx = sharedStrings.length - 1;
        }

        // 既存セルを書き換え: <c r="Z1" s="29" t="s"><v>40</v></c>
        const cellRe = new RegExp(`<c r="${cell}"([^>]*)>(<v>)[^<]*(</v>)`, 'g');
        let found = false;
        sheetXml = sheetXml.replace(cellRe, (match, attrs, vOpen, vClose) => {
            found = true;
            // 既存のt属性を除去してt="s"を追加
            attrs = attrs.replace(/\s+t="[^"]*"/, '');
            return `<c r="${cell}"${attrs} t="s">${vOpen}${idx}${vClose}`;
        });

        if (!found) {
            // セルが存在しない場合（空セル）: 行内に挿入
            const rowNum = cell.replace(/[A-Z]+/, '');
            const rowRe = new RegExp(`(<row[^>]*r="${rowNum}"[^>]*>)(.*?)(</row>)`, 's');
            sheetXml = sheetXml.replace(rowRe, (match, rOpen, rBody, rClose) => {
                const newCell = `<c r="${cell}" t="s"><v>${idx}</v></c>`;
                return `${rOpen}${rBody}${newCell}${rClose}`;
            });
        }

        return { sheetXml };
    },

    // --- drawing1.xmlのxdr:spをxdr:picに変換して画像を差し込む ---
    // appc_image_writer.pyの_convert_shapes()と同等の処理
    async _injectImages(zip, imageMap) {
        const drawingPath = 'xl/drawings/drawing1.xml';
        const drawingFile = zip.file(drawingPath);
        if (!drawingFile) return;

        let drawingXml = await drawingFile.async('string');
        const rels = [];

        // twoCellAnchor単位で分割して処理
        const parts = drawingXml.split(/(?=<xdr:twoCellAnchor)/);
        const header = parts[0];
        const anchors = parts.slice(1);

        const processedAnchors = anchors.map(anchor => {
            const nameMatch = anchor.match(/name="([^"]+)"/);
            if (!nameMatch) return anchor;
            const shapeName = nameMatch[1];
            if (!imageMap.has(shapeName)) return anchor;

            const dataUrl = imageMap.get(shapeName);
            const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
            const imgPath = `xl/media/appc_${shapeName}.jpg`;
            zip.file(imgPath, base64, { base64: true });

            const rId = `rId${rels.length + 1}`;
            rels.push({ rId, target: `../media/appc_${shapeName}.jpg` });

            // from/toを取得
            const fromMatch = anchor.match(/<xdr:from>[\s\S]*?<\/xdr:from>/);
            const toMatch   = anchor.match(/<xdr:to>[\s\S]*?<\/xdr:to>/);
            const fromXml   = fromMatch ? fromMatch[0] : '';
            const toXml     = toMatch   ? toMatch[0]   : '';

            // 元のボックスサイズを取得（off/ext）
            const offMatch = anchor.match(/<a:off x="([0-9]+)" y="([0-9]+)"/);
            const extMatch = anchor.match(/<a:ext cx="([0-9]+)" cy="([0-9]+)"/);
            const ox  = offMatch ? offMatch[1] : '0';
            const oy  = offMatch ? offMatch[2] : '0';
            const cx  = extMatch ? extMatch[1] : '3000000';
            const cy  = extMatch ? extMatch[2] : '2000000';

            // appc_image_writer.pyに合わせてoneCellAnchorで出力
            const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
            const picXml = [
                `<xdr:pic>`,
                `<xdr:nvPicPr>`,
                `<xdr:cNvPr id="${rels.length + 100}" name="${shapeName}"/>`,
                `<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>`,
                `</xdr:nvPicPr>`,
                `<xdr:blipFill>`,
                `<a:blip xmlns:r="${NS_R}" r:embed="${rId}"/>`,
                `<a:stretch><a:fillRect/></a:stretch>`,
                `</xdr:blipFill>`,
                `<xdr:spPr>`,
                `<a:xfrm><a:off x="${ox}" y="${oy}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`,
                `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`,
                `</xdr:spPr>`,
                `</xdr:pic>`
            ].join('');

            // oneCellAnchorとして出力（twoCellAnchorを置き換え）
            return `<xdr:oneCellAnchor>${fromXml}<xdr:ext cx="${cx}" cy="${cy}"/>${picXml}<xdr:clientData/></xdr:oneCellAnchor>`;
        });

        // drawing1.xmlを更新（wsDrの閉じタグを確実に付ける）
        let newDrawingXml = header + processedAnchors.join('');
        if (!newDrawingXml.includes('</xdr:wsDr>')) {
            newDrawingXml += '</xdr:wsDr>';
        }
        zip.file(drawingPath, newDrawingXml);

        // drawing1.xml.relsを更新
        const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
        const REL_IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
        const relsXml = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            `<Relationships xmlns="${NS_REL}">`,
            ...rels.map(r => `<Relationship Id="${r.rId}" Type="${REL_IMG}" Target="${r.target}"/>`),
            '</Relationships>'
        ].join('\n');
        zip.file('xl/drawings/_rels/drawing1.xml.rels', relsXml);

        // Content_Types.xmlにjpegを追加
        const ctFile = zip.file('[Content_Types].xml');
        if (ctFile) {
            let ctXml = await ctFile.async('string');
            if (!ctXml.includes('image/jpeg')) {
                ctXml = ctXml.replace('</Types>', '<Default Extension="jpg" ContentType="image/jpeg"/>\n</Types>');
                zip.file('[Content_Types].xml', ctXml);
            }
        }
    },

    // --- ダウンロードヘルパー ---
    _downloadBlob(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
});
