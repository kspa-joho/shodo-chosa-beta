window.managerApp = {
    map: null,
    db:[],
    layerMap: new Map(),
    currentKey: null,
    sortKey: 'ref_no',
    sortAsc: true,
    isAborted: false,

    fieldMaster: {
        company_id: { label: "会社ID", type: "text" },
        leader_name: { label: "調査班長名", type: "text" },
        ref_no: { label: "整理番号", type: "text" },
        survey_date: { label: "調査日", type: "date" },
        disaster_no: { label: "災害番号", type: "text" },
        dept_name: { label: "所属名", type: "text" },
        loc_name: { label: "被災場所", type: "text" },
        route_name: { label: "路線・河川名", type: "text" },
        damage_date: { label: "被災日", type: "date" },
        length: { label: "延長[m]", type: "number", step: "0.1" },
        height: { label: "高さ[m]", type: "number", step: "0.1" },
        side_type: { label: "岸別", type: "select", options: ["選択...", "右岸", "左岸", "距離標なし"] },
        distance_label: { label: "距離標・区間", type: "text" },
        comment: { label: "コメント", type: "textarea" },
        expansion_exists: { label: "被災拡大の可能性", type: "select", options: ["選択...", "有", "無"] },
        expansion_status: { label: "拡大状況", type: "textarea" },
        special_exists: { label: "特記事項有無", type: "select", options: ["選択...", "有", "無"] },
        special_status: { label: "特記状況", type: "textarea" },
        plan_summary: { label: "対策概要", type: "textarea" },
        company_name: { label: "会社名", type: "text" },
        tel: { label: "電話番号", type: "tel" },
        fax: { label: "FAX番号", type: "tel" },
        person_name: { label: "職氏名", type: "text" },
        email: { label: "E-mail", type: "email" },
        start_lat: { label: "起点 緯度", type: "number", step: "0.000001" },
        start_lng: { label: "起点 経度", type: "number", step: "0.000001" },
        end_lat: { label: "終点 緯度", type: "number", step: "0.000001" },
        end_lng: { label: "終点 経度", type: "number", step: "0.000001" }
    },

    init() {
        if (this.map) return;
        
        this.map = L.map('map', { 
            renderer: L.canvas(),
            zoomSnap: 0,
            zoomDelta: 0.1,
            wheelPxPerZoomLevel: 200
        }).setView([31.5601, 130.5580], 16);

        const layers = {
            "地理院 標準": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', { attribution: "GSI", crossOrigin: 'anonymous' }),
            "地理院 淡色": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { attribution: "GSI", crossOrigin: 'anonymous' }),
            "地理院 写真": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', { attribution: "GSI", crossOrigin: 'anonymous' }),
            "ESRI 衛星": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: "Esri", crossOrigin: 'anonymous' })
        };
        layers["地理院 淡色"].addTo(this.map);
        L.control.layers(layers).addTo(this.map);
        managerApp.setupDropZone();
    },

    formatWareki(dateStr) {
        if (!dateStr || dateStr === "-") return "-";
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { era: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(d);
        } catch (e) { return dateStr; }
    },

    getCenterOfGeom(geom) {
        if (!geom || !geom.features || !geom.features.length) return null;
        try {
            const tempLayer = L.geoJSON(geom);
            const bounds = tempLayer.getBounds();
            return bounds.isValid() ? bounds.getCenter() : null;
        } catch (e) { return null; }
    },

    selectItem(key) {
        this.currentKey = key;
        const data = this.db.find(d => d._key === key);
        if (!data) return;
        managerApp.renderList();
        managerApp.renderMarkers();
        managerApp.showDetail(data);
        document.getElementById('edit-actions').style.display = 'flex';
        const center = managerApp.getCenterOfGeom(data.mainGeom);
        if (center) this.map.panTo(center);
    },

    showDetail(data) {
        const panel = document.getElementById('edit-panel');
        if (!panel) return; panel.innerHTML = "";
        const h = document.createElement('div'); h.style.padding = "10px 15px"; h.style.borderBottom = "1px solid #ddd"; h.style.background = "#fff";
        h.innerHTML = `<h3 style="margin:0; font-size:1rem;">#${data.ref_no} 編集</h3>`;
        panel.appendChild(h);
        const groups = [
            { t: "管理項目", f: ["company_id", "leader_name", "ref_no", "survey_date", "disaster_no"] },
            { t: "諸元", f: ["dept_name", "loc_name", "route_name"] },
            { t: "被災状況", f: ["damage_date", "length", "height", "side_type", "distance_label", "comment"] },
            { t: "拡大の可能性・特記", f: ["expansion_exists", "expansion_status", "special_exists", "special_status", "plan_summary"] },
            { t: "調査を実施した者", f: ["company_name", "tel", "fax", "person_name", "email"] },
            { t: "位置座標", f: ["start_lat", "start_lng", "end_lat", "end_lng"] }
        ];
        groups.forEach(g => {
            const groupDiv = document.createElement('div'); groupDiv.className = "detail-group";
            const title = document.createElement('div'); title.className = "detail-group-title"; title.textContent = g.t;
            groupDiv.appendChild(title);
            const table = document.createElement('table'); table.className = "detail-table";
            g.f.forEach(k => {
                const def = this.fieldMaster[k]; const tr = document.createElement('tr');
                const tdL = document.createElement('td'); tdL.className = "detail-label"; tdL.textContent = def.label;
                const tdI = document.createElement('td');
                let el;
                if (def.type === 'select') {
                    el = document.createElement('select');
                    def.options.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; if (data[k] === o) op.selected = true; el.appendChild(op); });
                    // 右ペインのselectはonchangeで即時更新（再描画不要）
                    el.onchange = (e) => managerApp.updateValue(data._key, k, e.target.value);
                } else if (def.type === 'textarea') {
                    el = document.createElement('textarea'); el.value = data[k] || '';
                    // 右ペインのtextareaはoninputで即時更新（再描画不要）
                    el.oninput = (e) => managerApp.updateValue(data._key, k, e.target.value);
                } else {
                    el = document.createElement('input'); el.type = def.type; if (def.step) el.step = def.step; el.value = data[k] || '';
                    // 右ペインのinputはoninputで即時更新（再描画不要）
                    el.oninput = (e) => managerApp.updateValue(data._key, k, e.target.value);
                }
                tdI.appendChild(el); tr.appendChild(tdL); tr.appendChild(tdI); table.appendChild(tr);
            });
            groupDiv.appendChild(table); panel.appendChild(groupDiv);
        });
        if (data._photos && data._photos.length > 0) {
            const pDiv = document.createElement('div'); pDiv.className = "detail-group";
            pDiv.innerHTML = `<div class="detail-group-title">写真 (${data._photos.length}枚)</div>`;
            const scroll = document.createElement('div'); scroll.style.display = "flex"; scroll.style.overflowX = "auto"; scroll.style.gap = "8px"; scroll.style.padding = "10px";
            data._photos.forEach(p => { const img = document.createElement('img'); img.src = p.dataUrl; img.style.height = "100px"; img.style.border = "1px solid #ccc"; scroll.appendChild(img); });
            pDiv.appendChild(scroll); panel.appendChild(pDiv);
        }
    },

    // 【Phase 13.38修正】データのみ更新・再描画しない。
    // 旧実装はupdateValue()末尾でrenderDatabase()を呼んでいたため、
    // データベースタブのinput編集中に1文字入力するたびにテーブルが
    // 丸ごと再描画されてフォーカスが飛ぶバグがあった。
    // データベースタブのinputはonblur時のみrenderDatabase()を呼ぶ方式に変更。
    updateValue(key, f, v) {
        const i = this.db.find(d => d._key === key);
        if (i) i[f] = v;
    },

    // データ更新後に明示的に再描画が必要な場合に使用（ソート・検索・インポート後等）
    updateValueAndRefresh(key, f, v) {
        this.updateValue(key, f, v);
        managerApp.renderDatabase();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-btn').forEach(t => t.addEventListener('click', () => {
        const target = t.dataset.target;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); t.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => {
            c.classList.toggle('active', c.id === target);
            if ((target === 'content-individual' || target === 'content-database') && window.managerApp.map) setTimeout(() => window.managerApp.map.invalidateSize(), 350);
        });
    }));
    window.managerApp.init();
});
