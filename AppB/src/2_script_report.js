// --- 帳票・キャプチャモジュール ---
Object.assign(window.managerApp, {
    showProgress(msg, current, total) {
        const overlay = document.getElementById('progress-overlay'); overlay.style.display = 'flex';
        document.getElementById('progress-msg').textContent = msg;
        document.getElementById('progress-count').textContent = total ? `${current} / ${total}` : "";
    },

    hideProgress() { document.getElementById('progress-overlay').style.display = 'none'; },
    
    abortProcess() { this.isAborted = true; managerApp.hideProgress(); },

    // --- 全体図出力モード開始 ---
    async startGlobalMapMode() {
        const selectedKeys = Array.from(document.querySelectorAll('.db-check:checked')).map(cb => cb.dataset.key);
        if (selectedKeys.length === 0) return alert("箇所を選択してください。");
        
        this._selectedKeysForGlobalMap = selectedKeys;

        const labelSel = document.getElementById('cfg-label-field');
        if (labelSel) {
            labelSel.innerHTML = "";
            const fm = window.managerApp.fieldMaster;
            Object.keys(fm).forEach(k => {
                const op = document.createElement('option');
                op.value = k;
                op.textContent = fm[k].label;
                if (k === 'disaster_no') op.selected = true; 
                labelSel.appendChild(op);
            });
        }

        this.switchToMapTab();
        await new Promise(r => setTimeout(r, 200));
        this.map.invalidateSize(); 
        managerApp.renderSelectedMarkers(selectedKeys);
        document.getElementById('config-modal').style.display = 'flex';
    },

    closeA3Config() {
        document.getElementById('config-modal').style.display = 'none';
        managerApp.renderMarkers();
        this._selectedKeysForGlobalMap = null;
    },

    execA3Output() {
        if (!this._selectedKeysForGlobalMap) return;
        const config = {
            targetHeight: parseInt(document.getElementById('cfg-height').value) || 2000,
            labelField: document.getElementById('cfg-label-field').value,
            fontScale: parseFloat(document.getElementById('cfg-font').value),
            showCompass: document.getElementById('cfg-compass').checked,
            showScale: document.getElementById('cfg-scale').checked
        };
        this.generateA3GlobalMap(config);
    },

    switchToMapTab() {
        const activeTab = document.querySelector('.tab-btn.active');
        const originalTabId = activeTab ? activeTab.dataset.target : 'content-individual';
        const mapBtn = document.querySelector('.tab-btn[data-target="content-individual"]');
        if (mapBtn && !mapBtn.classList.contains('active')) mapBtn.click();
        return originalTabId;
    },

    restoreTab(tabId) {
        const btn = document.querySelector(`.tab-btn[data-target="${tabId}"]`);
        if (btn) btn.click();
    },

    async waitForTiles() {
        return new Promise(resolve => {
            const timeout = setTimeout(() => { console.warn("Tile load timeout"); resolve(); }, 5000);
            setTimeout(() => {
                if (!this.map._tilesToLoad || this.map._tilesToLoad === 0) {
                    setTimeout(() => { clearTimeout(timeout); resolve(); }, 500);
                } else {
                    this.map.once('load', () => { clearTimeout(timeout); setTimeout(resolve, 500); });
                }
            }, 200); 
        });
    },

    getStartPoint(feature) {
        if (!feature || !feature.geometry) return null;
        const geom = feature.geometry;
        if (geom.type === "Point") return { lat: geom.coordinates[1], lng: geom.coordinates[0] };
        else if (geom.type === "LineString") return { lat: geom.coordinates[0][1], lng: geom.coordinates[0][0] };
        else if (geom.type === "Polygon") return { lat: geom.coordinates[0][0][1], lng: geom.coordinates[0][0][0] };
        else if (geom.type === "MultiLineString") return { lat: geom.coordinates[0][0][1], lng: geom.coordinates[0][0][0] };
        return null; 
    },

    // --- 個別帳票生成 ---
    async generateReport() {
        const data = this.db.find(d => d._key === this.currentKey);
        if (!data || !confirm("帳票を生成します。よろしいですか？")) return;
        
        managerApp.showProgress("帳票生成中...", 1, 1);
        const pw = window.open('', '_blank');
        if (!pw) { alert("ポップアップがブロックされました。"); managerApp.hideProgress(); return; }
        
        const st = `<style>@page { size: A4; margin: 0; } body { margin: 0; padding: 0; background: #fff; width: 210mm; } .print-page-a4 { width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; position: relative; } svg { width: 100%; height: 100%; display: block; }</style>`;
        pw.document.write(`<!DOCTYPE html><html><head><title>調査票</title>${st}</head><body>`);
        
        const originalTab = this.switchToMapTab();
        await new Promise(r => setTimeout(r, 500));

        try {
            const maps = await managerApp.captureMapFinal(data);
            pw.document.write(`<div class="print-page-a4">${managerApp.fillSVG('tpl-p1', data, maps, false)}</div>`);
            pw.document.write(`<div class="print-page-a4">${managerApp.fillSVG('tpl-p2', data, null, true)}</div>`);
            const ex = data._photos.filter(p => p.tag !== '全景' && p.tag !== '近景');
            for (let i = 0; i < ex.length; i += 3) { pw.document.write(`<div class="print-page-a4">${managerApp.fillPhotoBook(ex.slice(i, i + 3), data)}</div>`); }
            pw.document.write('</body></html>'); pw.document.close();
            managerApp.hideProgress();
            setTimeout(() => { if(!this.isAborted) pw.print(); }, 1000);
        } catch (e) {
            console.error(e);
            pw.document.write(`<div style="padding:20px; color:red;">エラーが発生しました: ${e.message}</div>`);
            managerApp.hideProgress();
        } finally {
            this.restoreTab(originalTab);
        }
    },

    // --- 一括帳票生成 ---
    async batchPrint() {
        const selectedKeys = Array.from(document.querySelectorAll('.db-check:checked')).map(cb => cb.dataset.key);
        if (selectedKeys.length === 0) return alert("箇所を選択してください。");
        if (!confirm(`${selectedKeys.length}件の帳票を一括生成します。\n※処理中は画面が自動で切り替わりますが、完了まで触らずにお待ちください。`)) return;
        
        this.isAborted = false;
        const pw = window.open('', '_blank');
        if (!pw) return alert("ポップアップがブロックされました。");

        const st = `<style>@page { size: A4; margin: 0; } body { margin: 0; padding: 0; background: #fff; width: 210mm; } .print-page-a4 { width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; position: relative; } svg { width: 100%; height: 100%; display: block; }</style>`;
        pw.document.write(`<!DOCTYPE html><html><head><title>一括出力</title>${st}</head><body>`);
        
        const originalTab = this.switchToMapTab();
        await new Promise(r => setTimeout(r, 1000));
        this.map.invalidateSize();

        try {
            for (let i = 0; i < selectedKeys.length; i++) {
                if (this.isAborted) break;
                const data = this.db.find(d => d._key === selectedKeys[i]);
                managerApp.showProgress(`データ処理中... (${i + 1}/${selectedKeys.length})`, i + 1, selectedKeys.length);
                
                const maps = await managerApp.captureMapFinal(data);
                
                pw.document.write(`<div class="print-page-a4">${managerApp.fillSVG('tpl-p1', data, maps, false)}</div>`);
                pw.document.write(`<div class="print-page-a4">${managerApp.fillSVG('tpl-p2', data, null, true)}</div>`);
                const ex = data._photos.filter(p => p.tag !== '全景' && p.tag !== '近景');
                for (let j = 0; j < ex.length; j += 3) { pw.document.write(`<div class="print-page-a4">${managerApp.fillPhotoBook(ex.slice(j, j + 3), data)}</div>`); }
            }
        } catch (e) {
            console.error(e);
            alert("処理中にエラーが発生しました: " + e.message);
        } finally {
            this.restoreTab(originalTab);
            managerApp.hideProgress();
        }

        if (!this.isAborted) { 
            pw.document.write('</body></html>'); 
            pw.document.close(); 
            setTimeout(() => pw.print(), 1000); 
        } else {
            pw.close();
        }
    },

    // --- 全体図出力 ---
    async generateA3GlobalMap(config) {
        this.isAborted = false;
        managerApp.showProgress("全体図を作成中 (高画質)...", 1, 1);
        
        try {
            await this.waitForTiles();
            
            const mapSize = this.map.getSize(); 
            const scale = config.targetHeight / mapSize.y;
            
            const canvas = document.createElement('canvas'); 
            canvas.width = mapSize.x * scale;
            canvas.height = mapSize.y * scale;
            const ctx = canvas.getContext('2d'); 
            ctx.scale(scale, scale); 
            ctx.fillStyle="#fff"; ctx.fillRect(0,0,mapSize.x, mapSize.y);
            
            const mapRect = document.getElementById('map').getBoundingClientRect();
            const tiles = Array.from(document.querySelectorAll('.leaflet-tile-pane img'));
            
            tiles.forEach(tile => { 
                const r = tile.getBoundingClientRect(); 
                if (r.width > 0 && r.height > 0 && tile.naturalWidth > 0) {
                    try { ctx.drawImage(tile, r.left - mapRect.left, r.top - mapRect.top, r.width, r.height); } catch(e){}
                }
            });
            
            const targetKeys = this._selectedKeysForGlobalMap || [];
            this.db.filter(d => targetKeys.includes(d._key)).forEach(data => {
                let labelPt = null;
                const feature = data.mainGeom.features[0];
                if (feature) {
                    const startLatLng = managerApp.getStartPoint(feature);
                    if (startLatLng) labelPt = this.map.latLngToContainerPoint(startLatLng);
                }

                if (labelPt) {
                    L.geoJSON(data.mainGeom).eachLayer(l => {
                        const pts = [];
                        if (l.getLatLngs) {
                            const r = l.getLatLngs(); 
                            (Array.isArray(r[0]) ? r[0] : r).forEach(ll => pts.push(this.map.latLngToContainerPoint(ll)));
                        } else if (l.getLatLng) {
                            pts.push(this.map.latLngToContainerPoint(l.getLatLng()));
                        }

                        if (pts.length > 1) { 
                            ctx.beginPath(); ctx.strokeStyle = "#ff0000"; ctx.lineWidth = 2;
                            ctx.moveTo(pts[0].x, pts[0].y); pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
                        } else if (pts.length === 1) { 
                            ctx.beginPath(); ctx.strokeStyle = "#ff0000"; ctx.lineWidth = 2;
                            ctx.arc(pts[0].x, pts[0].y, 2, 0, Math.PI * 2); ctx.stroke();
                        }
                    });

                    const baseSize = 5 * config.fontScale; 
                    ctx.font = `bold ${baseSize}px sans-serif`;
                    ctx.textAlign = "center";
                    const txt = data[config.labelField] || "---";
                    
                    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255, 255, 255, 0.9)"; ctx.lineJoin = "round";
                    ctx.strokeText(txt, labelPt.x, labelPt.y - (baseSize + 1));
                    ctx.fillStyle = "#ff0000";
                    ctx.fillText(txt, labelPt.x, labelPt.y - (baseSize + 1));
                }
            });

            if (config.showCompass) this.drawNorthArrow(ctx, mapSize.x, mapSize.y);
            
            if (config.showScale) {
                this.drawScaleBar(ctx, mapSize.x, mapSize.y);
                this.drawLegend(ctx, mapSize.x, mapSize.y, config.labelField);
            } else {
                this.drawLegend(ctx, mapSize.x, mapSize.y, config.labelField);
            }

            const link = document.createElement('a');
            const now = new Date();
            const timeStr = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;
            link.download = `GlobalMap_${timeStr}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

        } catch(e) {
            alert("出力エラー: " + e.message);
        } finally {
            managerApp.hideProgress();
        }
    },

    drawNorthArrow(ctx, w, h) {
        const size = 40; const x = w - 50; const y = 50;
        ctx.save(); ctx.translate(x, y);
        ctx.fillStyle = "#333"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.fillText("N", 0, -size/2 - 5);
        ctx.beginPath(); ctx.moveTo(0, -size/2); ctx.lineTo(10, size/2); ctx.lineTo(0, size/2 - 10); ctx.lineTo(-10, size/2); ctx.closePath();
        ctx.fillStyle = "#333"; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "#fff"; ctx.stroke();
        ctx.restore();
    },

    drawScaleBar(ctx, w, h) {
        const centerLatLng = this.map.getCenter();
        const y = centerLatLng.lat; const zoom = this.map.getZoom();
        const metersPerPx = 40075017 * Math.cos(y * Math.PI / 180) / Math.pow(2, zoom + 8);
        const targetPx = 100; const rawMeters = targetPx * metersPerPx;
        let displayMeters;
        if (rawMeters > 1000) displayMeters = Math.round(rawMeters / 1000) * 1000;
        else if (rawMeters > 100) displayMeters = Math.round(rawMeters / 100) * 100;
        else displayMeters = Math.round(rawMeters / 10) * 10;
        if (displayMeters === 0) displayMeters = 10;
        const barPx = displayMeters / metersPerPx;
        const label = displayMeters >= 1000 ? (displayMeters/1000) + "km" : displayMeters + "m";
        const bx = w - 20 - barPx; const by = h - 50;
        ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = "#000"; ctx.fillStyle = "#000"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
        ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + barPx, by); ctx.lineTo(bx + barPx, by - 5); ctx.stroke();
        ctx.fillText(label, bx + barPx/2, by - 8); ctx.restore();
    },

    drawLegend(ctx, w, h, labelKey) {
        const fm = window.managerApp.fieldMaster;
        const labelName = (fm[labelKey] && fm[labelKey].label) ? fm[labelKey].label : labelKey;
        const text = `[ラベル：${labelName}]`;
        const x = w - 20; const y = h - 20;
        ctx.save();
        ctx.fillStyle = "#333"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"; ctx.lineJoin = "round";
        ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
        ctx.restore();
    },

    async captureMapFinal(data) {
        return new Promise(async (resolve, reject) => {
            try {
                const center = managerApp.getCenterOfGeom(data.mainGeom);
                const targetCanvas = document.createElement('canvas'); 
                targetCanvas.width = 600; targetCanvas.height = 400;
                const ctx = targetCanvas.getContext('2d'); 
                
                if (!center) { 
                    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,600,400);
                    ctx.fillStyle = "#999"; ctx.textAlign = "center"; ctx.fillText("(位置図データなし)", 300, 200); 
                    return resolve({ zentai: targetCanvas.toDataURL('image/jpeg'), kakudai: targetCanvas.toDataURL('image/jpeg') });
                }

                const tempLayers = [];
                this.map.eachLayer(l => { 
                    if (!(l instanceof L.TileLayer)) { tempLayers.push(l); this.map.removeLayer(l); } 
                });

                const renderView = async (renderMode) => {
                    const feature = data.mainGeom.features[0];
                    if (feature.geometry.type === "Point") {
                        const z = (renderMode === 'targetOnly') ? 14 : 17;
                        this.map.setView(center, z, { animate: false });
                    } else {
                        const bounds = L.geoJSON(data.mainGeom).getBounds();
                        const padRatio = (renderMode === 'targetOnly') ? 4.5 : 1.0; 
                        this.map.fitBounds(bounds.pad(padRatio), { animate: false });
                    }
                    
                    await this.waitForTiles();

                    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,600,400);
                    
                    const mapRect = document.getElementById('map').getBoundingClientRect();
                    const tiles = Array.from(document.querySelectorAll('.leaflet-tile-pane img'));
                    const mapCenterX = mapRect.width / 2;
                    const mapCenterY = mapRect.height / 2;
                    const offsetX = 300 - mapCenterX;
                    const offsetY = 200 - mapCenterY;

                    tiles.forEach(tile => {
                        const r = tile.getBoundingClientRect();
                        const x = r.left - mapRect.left;
                        const y = r.top - mapRect.top;
                        if (r.width > 0 && r.height > 0) {
                            try {
                                if (tile.naturalWidth > 0) {
                                    ctx.drawImage(tile, x + offsetX, y + offsetY, r.width, r.height);
                                }
                            } catch(e) { }
                        }
                    });

                    const drawGeom = (geom, color, weight, isGlow) => {
                        if(!geom) return;
                        L.geoJSON(geom).eachLayer(l => {
                            const pts = [];
                            const toCanvasPt = (latlng) => {
                                const p = this.map.latLngToContainerPoint(latlng);
                                return { x: p.x + offsetX, y: p.y + offsetY };
                            };

                            if (l.getLatLngs) { 
                                const r = l.getLatLngs(); 
                                (Array.isArray(r[0]) ? r[0] : r).forEach(ll => pts.push(toCanvasPt(ll))); 
                            } else if (l.getLatLng) { 
                                pts.push(toCanvasPt(l.getLatLng())); 
                            }

                            if (pts.length > 1) { 
                                ctx.beginPath(); 
                                ctx.strokeStyle = color; 
                                ctx.lineWidth = weight; 
                                ctx.lineJoin = "round"; ctx.lineCap = "round"; 
                                ctx.globalAlpha = isGlow ? 0.5 : 1.0;
                                ctx.moveTo(pts[0].x, pts[0].y); 
                                pts.forEach(p => ctx.lineTo(p.x, p.y)); 
                                if (l instanceof L.Polygon) ctx.closePath(); 
                                ctx.stroke(); 
                                if (l instanceof L.Polygon && !isGlow) { 
                                    ctx.fillStyle = color; ctx.globalAlpha = 0.2; ctx.fill(); 
                                } 
                            } else if (pts.length === 1) { 
                                ctx.beginPath();
                                ctx.strokeStyle = color;
                                ctx.lineWidth = isGlow ? 6 : 3; 
                                ctx.globalAlpha = isGlow ? 0.4 : 1.0;
                                const r = isGlow ? 8 : 3;
                                ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
                                ctx.stroke();
                            }
                        });
                    };

                    this.db.forEach(od => { 
                        const isTarget = (od._key === data._key);
                        if (renderMode === 'targetOnly') {
                            if (isTarget) { drawGeom(od.mainGeom, "#ff0000", 6, false); }
                        } else {
                            if (isTarget) { drawGeom(od.mainGeom, "#f1c40f", 14, true); drawGeom(od.mainGeom, "#ff0000", 6, false); }
                            else { drawGeom(od.mainGeom, "#ff0000", 5, false); }
                        }
                    });

                    return targetCanvas.toDataURL('image/jpeg', 0.8);
                };

                const imgKakudai = await renderView('all');
                const imgZentai = await renderView('targetOnly');

                tempLayers.forEach(l => this.map.addLayer(l));
                resolve({ zentai: imgZentai, kakudai: imgKakudai });

            } catch (err) {
                console.error("Map Capture Error:", err);
                reject(err);
            }
        });
    },

    fillSVG(tpl, data, maps, isP2) {
        const svgStr = document.getElementById(tpl).innerHTML;
        if (!svgStr || svgStr.includes('<!-- Missing:')) {
            return `<div style="padding: 20px; color: red;"><b>[エラー]</b> テンプレート(${tpl})が読み込めませんでした。<br>ビルド時に <code>src</code> フォルダ内にSVGファイルが存在していたか確認してください。</div>`;
        }

        const doc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
        if (doc.querySelector('parsererror')) {
            return `<div style="padding: 20px; color: red;"><b>[XMLパースエラー]</b> テンプレート(${tpl})のSVG構造が不正です。<br>SVGファイルをアウトライン化して保存し直してみてください。</div>`;
        }
        
        const fs = { ...data };
        if (window.managerApp.fieldMaster) {
            Object.keys(window.managerApp.fieldMaster).forEach(k => {
                if (fs[k] === undefined || fs[k] === null) fs[k] = "-";
            });
        }
        ["survey_date", "damage_date"].forEach(k => { 
            if(fs[k]) fs[k] = managerApp.formatWareki(fs[k]); 
        });
        
        fs.start_coord = managerApp.getCoordsText(data);

        const check = (id, v) => {
            const isY = (v === '有');
            doc.querySelectorAll('rect').forEach(r => {
                const cid = r.id.replace(/_x5F_/g, '_');
                if (cid.startsWith(id)) {
                    const isT = cid.includes('true'), isF = cid.includes('fulse')||cid.includes('false');
                    if (isT) managerApp.replaceRectWithText(doc, r, isY ? '✓' : '', { alignH: 'center', size: 14 });
                    else if (isF) managerApp.replaceRectWithText(doc, r, !isY ? '✓' : '', { alignH: 'center', size: 14 });
                }
            });
        };
        check('expansion', data.expansion_exists); check('special', data.special_exists);
        
        doc.querySelectorAll('rect').forEach(rect => {
            if (!rect.parentNode || rect.id.includes('枠')) return;
            const id = rect.id.replace(/_x5F_/g, '_').replace(/_[0-9]+_$/, '');
            if (maps && id === 'ichizu_zentai') { managerApp.replaceRectWithImage(doc, rect, maps.zentai); return; }
            if (maps && id === 'ichizu_kakudai') { managerApp.replaceRectWithImage(doc, rect, maps.kakudai); return; }
            if (isP2 && (id === 'photo_zenkei' || id === 'photo_kinkei')) {
                const tag = (id === 'photo_zenkei' ? '全景' : '近景');
                const p = data._photos.find(x => x.tag === tag);
                if (p) managerApp.replaceRectWithImage(doc, rect, p.dataUrl);
                else managerApp.replaceRectWithText(doc, rect, "（写真なし）", { alignH: 'center' });
                return;
            }
            if (id.includes('comment') && (id.includes('zenkei') || id.includes('kinkei'))) { 
                managerApp.replaceRectWithText(doc, rect, fs[id] || ""); 
            } else if (fs[id] !== undefined) { 
                managerApp.replaceRectWithText(doc, rect, fs[id]); 
            }
        });
        return new XMLSerializer().serializeToString(doc);
    },

    fillPhotoBook(ps, data) {
        const svgStr = document.getElementById('tpl-p3').innerHTML;
        if (!svgStr || svgStr.includes('<!-- Missing:')) {
            return `<div style="padding: 20px; color: red;"><b>[エラー]</b> テンプレート(tpl-p3)が読み込めませんでした。</div>`;
        }
        const doc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
        if (doc.querySelector('parsererror')) {
            return `<div style="padding: 20px; color: red;"><b>[XMLパースエラー]</b> テンプレート(tpl-p3)のSVG構造が不正です。</div>`;
        }

        const fs = { ...data }; 
        ["survey_date", "damage_date"].forEach(k => { if(fs[k]) fs[k] = managerApp.formatWareki(fs[k]); });
        
        doc.querySelectorAll('rect').forEach(r => {
            if (!r.parentNode || r.id.includes('枠')) return;
            const id = r.id.replace(/_x5F_/g, '_');

            // 写真エリア: photo_1_ / photo_2_ / photo_3_
            const photoMatch = id.match(/^photo_([1-3])_?$/);
            if (photoMatch) {
                const idx = parseInt(photoMatch[1]) - 1;
                if (ps[idx]) managerApp.replaceRectWithImage(doc, r, ps[idx].dataUrl);
                else managerApp.replaceRectWithText(doc, r, "（写真なし）", { alignH: 'center' });
                return;
            }

            // 【Phase 13.36修正】photo_commentインデックス取得ロジックを堅牢化。
            // 旧: id.match(/[1-2]/) は文字列中どこにでもマッチする危険な正規表現だった。
            // 新: id末尾の _数字_ パターンで番号を確実に抽出する。
            //   photo_comment       → idx=0 (ps[0].memo)
            //   photo_comment_1_    → idx=1 (ps[1].memo)
            //   photo_comment_2_    → idx=2 (ps[2].memo)
            if (id.includes('photo_comment')) {
                const numMatch = id.match(/photo_comment_(\d+)_?$/);
                const idx = numMatch ? parseInt(numMatch[1]) : 0;
                managerApp.replaceRectWithText(doc, r, ps[idx] ? (ps[idx].memo || "") : "", { alignV: 'top' });
                return;
            }

            // その他フィールド（整理番号・調査日等のヘッダー情報）
            const key = id.replace(/_[0-9]+_$/, '');
            if (fs[key] !== undefined) managerApp.replaceRectWithText(doc, r, fs[key] || "-");
        });
        return new XMLSerializer().serializeToString(doc);
    },

    // --- 長文折り返し対応 (Fix: 配置とフォント自動縮小) ---
    replaceRectWithText(doc, rect, text, opt = {}) {
        const x = parseFloat(rect.getAttribute('x')), y = parseFloat(rect.getAttribute('y')), 
              w = parseFloat(rect.getAttribute('width')), h = parseFloat(rect.getAttribute('height'));
        const size = opt.size || 10; 
        
        if (text === "") return rect.parentNode.removeChild(rect);

        if (text === "-" || text === "✓") {
            const nt = doc.createElementNS("http://www.w3.org/2000/svg", "text");
            let posY = (opt.alignV === 'top') ? y + size : y + (h / 2) + (size / 3);
            let posX = (opt.alignH === 'center') ? x + (w / 2) : x + 3;
            nt.setAttribute("x", posX); nt.setAttribute("y", posY);
            nt.setAttribute("font-family", "sans-serif"); nt.setAttribute("font-size", size);
            if (opt.alignH === 'center') nt.setAttribute("text-anchor", "middle");
            nt.textContent = text;
            rect.parentNode.replaceChild(nt, rect);
            return;
        }

        // --- 【Phase 13.43修正】1行枠（高さが文字2行分に満たない枠）専用の配置 ---
        // 旧実装は行の高さ1.2(=12px)＋上余白2pxで文字を置いていたため、高さ約11.3ptの1行枠では
        // 文字の下側が枠外へはみ出し overflow:hidden で切れる／罫線と重なる不具合があった。
        // また、長文だけが自動縮小されて行ごとに文字位置がバラつく問題もあった。
        // 1行枠は「余白0・行の高さ1・縦中央・折り返しなし」とし、長文は枠の幅に収まるまで縮小する。
        // 複数行枠は従来どおり（下の処理）。
        if (h < size * 2.2) {
            const oneLine = String(text).replace(/\s*[\r\n]+\s*/g, ' ');
            const padX = 4;
            const availW = w - padX * 2;
            let fitSize = size;
            try {
                if (!this._measureCtx) this._measureCtx = document.createElement('canvas').getContext('2d');
                this._measureCtx.font = size + "px sans-serif";
                const measured = this._measureCtx.measureText(oneLine).width;
                if (measured > availW && measured > 0) {
                    fitSize = Math.floor((size * availW / measured) * 10) / 10;
                }
            } catch (e) {
                // 測定できない環境では文字数から概算（全角基準）
                const est = oneLine.length * size;
                if (est > availW && est > 0) fitSize = Math.floor((size * availW / est) * 10) / 10;
            }
            if (fitSize > size) fitSize = size;
            if (fitSize < 4) fitSize = 4;

            const foS = doc.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
            foS.setAttribute("x", x);
            foS.setAttribute("y", y);
            foS.setAttribute("width", w);
            foS.setAttribute("height", h);
            // 端末（フォント）により文字の縦位置は±1pt程度変わる。枠でクリップすると文字が消えるため、
            // 1行枠は overflow:visible とし、多少はみ出しても文字が欠けないようにする。
            foS.setAttribute("overflow", "visible");

            const divS = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
            divS.style.width = "100%";
            divS.style.height = "100%";
            divS.style.fontFamily = "sans-serif";
            divS.style.fontSize = fitSize + "px";
            divS.style.boxSizing = "border-box";
            divS.style.overflow = "visible";
            divS.style.whiteSpace = "nowrap";
            divS.style.lineHeight = "1";
            divS.style.display = "flex";
            divS.style.alignItems = "center";
            if (opt.alignH === 'center') {
                divS.style.justifyContent = "center";
                divS.style.textAlign = "center";
            } else {
                divS.style.paddingLeft = padX + "px";
                divS.style.paddingRight = padX + "px";
            }
            divS.textContent = oneLine;
            foS.appendChild(divS);
            rect.parentNode.replaceChild(foS, rect);
            return;
        }

        // --- フォント自動縮小の計算（複数行枠） ---
        let adjustedSize = size;
        const effW = w - 8; 
        const effH = h - 4; 
        const maxChars = (effW / size) * (effH / (size * 1.2));
        
        if (text.length > maxChars && text.length > 0) {
            adjustedSize = Math.floor(Math.sqrt((effW * effH) / (text.length * 1.2)));
            if (adjustedSize > size) adjustedSize = size;
            if (adjustedSize < 4) adjustedSize = 4; 
        }

        const fo = doc.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
        fo.setAttribute("x", x);
        fo.setAttribute("y", y);
        fo.setAttribute("width", w);
        fo.setAttribute("height", h);
        
        const div = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        div.style.width = "100%";
        div.style.height = "100%";
        div.style.fontFamily = "sans-serif";
        div.style.fontSize = adjustedSize + "px"; 
        div.style.boxSizing = "border-box";
        div.style.overflow = "hidden"; 
        div.style.whiteSpace = "pre-wrap"; 
        div.style.wordWrap = "break-word"; 
        div.style.lineHeight = "1.2";

        // 配置修正: デフォルトを左上寄せに変更
        if (opt.alignH === 'center') {
            div.style.display = "flex";
            div.style.justifyContent = "center";
            div.style.alignItems = "center";
            div.style.textAlign = "center";
        } else if (opt.alignV === 'top') {
            div.style.display = "flex";
            div.style.alignItems = "flex-start"; 
            div.style.padding = "2px";
        } else {
            div.style.display = "flex";
            div.style.alignItems = "flex-start";
            div.style.paddingLeft = "4px";
            div.style.paddingTop = "2px";
        }
        
        div.textContent = text;
        fo.appendChild(div);
        rect.parentNode.replaceChild(fo, rect);
    },

    replaceRectWithImage(doc, rect, url) {
        if (!rect.parentNode) return;
        const img = doc.createElementNS("http://www.w3.org/2000/svg", "image");
        img.setAttribute("href", url); img.setAttributeNS("http://www.w3.org/1999/xlink", "href", url);
        ["x","y","width","height"].forEach(a => img.setAttribute(a, rect.getAttribute(a)));
        img.setAttribute("preserveAspectRatio", "xMidYMid meet");
        rect.parentNode.replaceChild(img, rect);
    },

    getCoordsText(d) {
        if (!d.mainGeom || !d.mainGeom.features.length) return "-";
        const f = d.mainGeom.features[0];
        const fmt = (c) => `${c[1].toFixed(6)} ${c[0].toFixed(6)}`;
        if (f.geometry.type === "Point") return fmt(f.geometry.coordinates);
        const pts = f.geometry.coordinates;
        return `${fmt(pts[0])} ～ ${fmt(pts[pts.length-1])}`;
    }
});
