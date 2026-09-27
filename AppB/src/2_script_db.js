// --- データベース・リスト表示モジュール ---
Object.assign(window.managerApp, {

    // 列幅を保持するマップ（キー名→px幅）
    _colWidths: {},

    refreshAll() {
        if (!this._searchOptionsInitialized) {
            this.setupSearchOptions();
            this._searchOptionsInitialized = true;
        }
        managerApp.renderList();
        managerApp.renderMarkers();
        managerApp.renderDatabase();
    },

    setupSearchOptions() {
        const sel = document.getElementById('db-search-field');
        if (!sel) return;
        sel.innerHTML = '<option value="all">全項目</option>';
        Object.keys(this.fieldMaster).forEach(k => {
            const op = document.createElement('option');
            op.value = k;
            op.textContent = this.fieldMaster[k].label;
            sel.appendChild(op);
        });
    },

    renderList() {
        const list = document.getElementById('data-list');
        if (!list) return; list.innerHTML = "";
        const counter = document.getElementById('list-count');
        if (counter) counter.textContent = this.db.length;
        this.db.forEach(data => {
            const item = document.createElement('div');
            item.className = `data-item ${this.currentKey === data._key ? 'active' : ''}`;
            item.innerHTML = `<strong>#${data.ref_no || '---'} (${data.disaster_no || ''})</strong><small>${data.company_id} / ${data.leader_name}</small>`;
            item.onclick = () => managerApp.selectItem(data._key);
            list.appendChild(item);
        });
    },

    renderMarkers() {
        this.layerMap.forEach(obj => { this.map.removeLayer(obj.main); if(obj.glow) this.map.removeLayer(obj.glow); });
        this.layerMap.clear();
        this.db.forEach((data, key) => { this._addMarkerToMap(data); });
    },

    renderSelectedMarkers(targetKeys) {
        this.layerMap.forEach(obj => { this.map.removeLayer(obj.main); if(obj.glow) this.map.removeLayer(obj.glow); });
        this.layerMap.clear();
        this.db.filter(d => targetKeys.includes(d._key)).forEach(data => { this._addMarkerToMap(data); });
        const geoms = this.db.filter(d => targetKeys.includes(d._key)).map(d => d.mainGeom);
        if (geoms.length > 0) {
            try {
                const bounds = L.geoJSON(geoms).getBounds();
                if (bounds.isValid()) {
                    this.map.fitBounds(bounds, {
                        paddingTopLeft: [50, 50],
                        paddingBottomRight: [350, 100]
                    });
                }
            } catch(e) {}
        }
    },

    _addMarkerToMap(data) {
        if (!data.mainGeom || !data.mainGeom.features.length) return;
        const isSelected = (this.currentKey === data._key);
        let glowLayer = null;
        if (isSelected) {
            glowLayer = L.geoJSON(data.mainGeom, {
                style: { color: '#f1c40f', weight: 14, opacity: 0.6 },
                pointToLayer: (f, ll) => L.circle(ll, { radius: 10, color: '#f1c40f', weight: 12, fillOpacity: 0.4 })
            }).addTo(this.map);
        }
        const mainLayer = L.geoJSON(data.mainGeom, {
            style: { color: '#ff0000', weight: 5, opacity: 1.0 },
            pointToLayer: (f, ll) => L.circle(ll, { radius: 10, color: '#ff0000', weight: 2, fillOpacity: 0 }),
            onEachFeature: (f, layer) => {
                layer.bindPopup(`災害:${data.disaster_no}<br>整理番号:${data.ref_no}`);
                layer.on('click', () => managerApp.selectItem(data._key));
                layer.on('mouseover', function() { this.openPopup(); });
                layer.on('mouseout', function() { this.closePopup(); });
            }
        });
        mainLayer.addTo(this.map);
        this.layerMap.set(data._key, { main: mainLayer, glow: glowLayer });
    },

    renderDatabase() {
        const tbody = document.getElementById('db-tbody'), thead = document.getElementById('db-thead');
        if (!tbody || !thead) return;

        const keys = Object.keys(this.fieldMaster);
        const DEFAULT_WIDTH = 40;

        // テーブル全体の幅を_colWidthsから再計算して設定（再描画後も幅を維持するため）
        const table = document.querySelector('.db-table');
        if (table) {
            const fixedW = 30 + 50; // チェック列+個別ボタン列
            const colsW = keys.reduce((sum, k) => sum + (this._colWidths[k] || DEFAULT_WIDTH), 0);
            table.style.width = (fixedW + colsW) + 'px';
        }

        // --- ヘッダー生成（リサイズハンドル付き）---
        const trHead = document.createElement('tr');

        // チェックボックス列
        const thCheck = document.createElement('th');
        thCheck.style.width = '30px';
        thCheck.style.minWidth = '30px';
        thCheck.innerHTML = `<input type="checkbox" id="db-check-all" onclick="managerApp.toggleAllChecks(this)">`;
        trHead.appendChild(thCheck);

        // 個別へボタン列
        const thBtn = document.createElement('th');
        thBtn.style.width = '50px';
        thBtn.style.minWidth = '50px';
        thBtn.textContent = '';
        trHead.appendChild(thBtn);

        // フィールド列
        keys.forEach(k => {
            const th = document.createElement('th');
            const w = this._colWidths[k] || DEFAULT_WIDTH;
            th.style.width = w + 'px';
            th.style.minWidth = '40px';
            th.style.position = 'relative';
            th.style.userSelect = 'none';
            th.dataset.key = k;

            // ラベル（クリックでソート）
            const label = document.createElement('span');
            label.textContent = this.fieldMaster[k].label;
            label.style.cursor = 'pointer';
            label.onclick = () => managerApp.sortDB(k);
            th.appendChild(label);

            // リサイズハンドル（幅広めのグレー線）
            const handle = document.createElement('div');
            handle.style.cssText = [
                'position:absolute', 'right:-4px', 'top:0', 'bottom:0',
                'width:9px', 'cursor:col-resize',
                'z-index:10'
            ].join(';');

            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startW = th.offsetWidth;
                const colIndex = Array.from(th.parentNode.children).indexOf(th);

                const onMove = (ev) => {
                    const newW = Math.max(40, startW + ev.clientX - startX);
                    th.style.width = newW + 'px';
                    managerApp._colWidths[k] = newW;
                    const tb = document.getElementById('db-tbody');
                    if (tb) {
                        tb.querySelectorAll('tr').forEach(tr => {
                            const td = tr.children[colIndex];
                            if (td) td.style.width = newW + 'px';
                        });
                    }
                    // テーブル全体の幅を再計算して広げる
                    const table = document.querySelector('.db-table');
                    if (table) {
                        const thAll = document.querySelectorAll('#db-thead th');
                        let totalW = 0;
                        thAll.forEach(t => { totalW += t.offsetWidth; });
                        table.style.width = totalW + 'px';
                    }
                };

                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            th.appendChild(handle);
            trHead.appendChild(th);
        });

        thead.innerHTML = '';
        thead.appendChild(trHead);

        // --- データ行生成 ---
        const q = (document.getElementById('db-search').value || "").toLowerCase();
        const targetField = document.getElementById('db-search-field').value;

        let flt = this.db.filter(d => {
            if (targetField === 'all') {
                return Object.values(d).some(v => String(v).toLowerCase().includes(q));
            } else {
                return String(d[targetField] || "").toLowerCase().includes(q);
            }
        });

        flt.sort((a, b) => {
            let vA = a[this.sortKey] || "", vB = b[this.sortKey] || "";
            return this.sortAsc ? vA.toString().localeCompare(vB.toString()) : vB.toString().localeCompare(vA.toString());
        });

        tbody.innerHTML = "";
        flt.forEach(d => {
            const tr = document.createElement('tr');

            const tdC = document.createElement('td');
            tdC.style.width = '30px';
            tdC.innerHTML = `<input type="checkbox" class="db-check" data-key="${d._key}">`;
            tr.appendChild(tdC);

            const tdJ = document.createElement('td');
            tdJ.style.width = '50px';
            const btn = document.createElement('button');
            btn.className = "btn-sub";
            btn.style.fontSize = "0.6rem";
            btn.style.padding = "2px 4px";
            btn.style.whiteSpace = "nowrap";
            btn.textContent = "個別へ";
            btn.onclick = () => managerApp.selectFromDB(d._key);
            tdJ.appendChild(btn);
            tr.appendChild(tdJ);

            keys.forEach(k => {
                const td = document.createElement('td');
                const w = this._colWidths[k] || DEFAULT_WIDTH;
                td.style.width = w + 'px';
                const inp = document.createElement('input');
                inp.type = "text";
                inp.value = d[k] || '';
                inp.style.border = "none";
                inp.style.background = "transparent";
                inp.style.width = "100%";
                inp.style.fontSize = "0.75rem";
                // 【Phase 13.38修正】oninputでデータ更新、onblurで再描画
                inp.oninput = (e) => managerApp.updateValue(d._key, k, e.target.value);
                inp.onblur = () => managerApp.renderDatabase();
                td.appendChild(inp);
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });
    },

    toggleAllChecks(source) {
        document.querySelectorAll('#db-tbody .db-check').forEach(cb => {
            cb.checked = source.checked;
        });
    },

    selectFromDB(key) {
        document.querySelector('.tab-btn[data-target="content-individual"]').click();
        setTimeout(() => managerApp.selectItem(key), 400);
    },

    sortDB(k) {
        if(this.sortKey === k) this.sortAsc = !this.sortAsc;
        else { this.sortKey = k; this.sortAsc = true; }
        managerApp.renderDatabase();
    }
});
