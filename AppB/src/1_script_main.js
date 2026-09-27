// --- 地図日本語化（安全な拡張） ---
const setupJapaneseDraw = () => {
    if (typeof L.drawLocal === 'undefined') return;
    L.extend(L.drawLocal.draw.toolbar.buttons, { polyline: 'ラインを描く', polygon: '範囲を描く', marker: '地点をプロット', circlemarker: 'テキストを配置' });
    L.extend(L.drawLocal.draw.toolbar.actions, { text: '中止' });
    L.extend(L.drawLocal.draw.toolbar.finish, { text: '完了' });
    L.extend(L.drawLocal.draw.toolbar.undo, { text: '戻る' });
    L.extend(L.drawLocal.edit.toolbar.buttons, { edit: '編集', remove: '個別削除' });
};

// --- 地図管理 ---
window.mapApp = {
    map: null, allDrawnItems: null, drawControl: null, currentMode: 'main',
    
    init() {
        if (this.map) return;
        setupJapaneseDraw();
        // 描画をCanvasエンジンに強制（leaflet-image対策）
        this.map = L.map('map', { renderer: L.canvas() }).setView([31.5601, 130.5580], 16);
        const layers = {
            "地理院 標準": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', { attribution: "GSI", crossOrigin: 'anonymous' }),
            "地理院 写真": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', { attribution: "GSI", crossOrigin: 'anonymous' }),
            "ESRI 衛星": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: "Esri", crossOrigin: 'anonymous' })
        };
        layers["地理院 標準"].addTo(this.map);
        L.control.layers(layers).addTo(this.map);
        this.allDrawnItems = new L.FeatureGroup().addTo(this.map);
        this.setMode('main');
        
        this.map.on(L.Draw.Event.CREATED, (e) => {
            let layer = e.layer;
            const isM = (this.currentMode === 'main');
            if (isM) { this.allDrawnItems.eachLayer(l => { if (l.options.isMain) this.allDrawnItems.removeLayer(l); }); layer.options.isMain = true; }
            else { layer.options.isMain = false; }

            if (e.layerType === 'circlemarker') {
                const txt = prompt("注釈を入力してください");
                if (!txt) return;
                layer = this.createTextLayer(layer.getLatLng(), txt);
            } else if (e.layerType === 'marker') {
                if (isM) { layer.options.icon = new L.Icon.Default(); layer.on('add', () => { if(layer._icon) layer._icon.classList.add('marker-red'); }); }
            } else if (layer.setStyle) {
                layer.setStyle({ color: isM ? '#ff0000' : '#0000ff', weight: 6, opacity: 0.7, fillOpacity: 0.4 });
            }
            this.allDrawnItems.addLayer(layer); this.updateMapSummary();
        });
        this.map.on(L.Draw.Event.EDITED, () => this.updateMapSummary());
        this.map.on(L.Draw.Event.DELETED, () => this.updateMapSummary());
    },

    createTextLayer(latlng, txt) {
        return L.marker(latlng, {
            icon: L.divIcon({ className: 'map-text-wrapper', html: `<div class="map-text-label-inner">${txt}</div>`, iconSize: [0, 0] }),
            isText: true, textVal: txt, isMain: false
        });
    },

    setMode(mode) {
        this.currentMode = mode;
        if (this.drawControl) { this.map.removeControl(this.drawControl); this.drawControl = null; }
        this.drawControl = new L.Control.Draw({
            edit: { featureGroup: this.allDrawnItems, remove: true },
            draw: mode === 'main' ? { marker: true, polyline: { shapeOptions: { color: '#ff0000', weight: 6 } }, polygon: false, circle: false, rectangle: false, circlemarker: false }
            : { marker: true, polyline: { shapeOptions: { color: '#0000ff', weight: 4 } }, polygon: { shapeOptions: { color: '#0000ff', fillOpacity: 0.4 } }, circlemarker: true, circle: false, rectangle: false }
        });
        this.map.addControl(this.drawControl);
    },

    clearLayers() { if (confirm("全ての図形を消去しますか？")) { this.allDrawnItems.clearLayers(); this.updateMapSummary(); } },
    updateMapSummary() {
        let m = 0, s = 0; this.allDrawnItems.eachLayer(l => { if (l.options.isMain) m++; else s++; });
        const sum = document.querySelector('.accordion-item[data-group="map-area"] .summary-text');
        if (sum) sum.textContent = `メイン:${m} / サブ:${s}`;
    },

    getMainCoords() {
        let ml = null; this.allDrawnItems.eachLayer(l => { if (l.options.isMain) ml = l; });
        if (!ml) return { start: "", end: "" };
        const f = (ll) => `${ll.lat.toFixed(6)} ${ll.lng.toFixed(6)}`;
        if (ml instanceof L.Marker) return { start: f(ml.getLatLng()), end: "" };
        const pts = ml.getLatLngs(); const flat = Array.isArray(pts[0]) ? pts[0] : pts;
        return { start: f(flat[0]), end: f(flat[flat.length - 1]) };
    },

    captureToPhoto() {
        if (!window.leafletImage) return alert("ライブラリ未ロード");
        const textLayers = [];
        this.allDrawnItems.eachLayer(l => { if (l.options.isText) { textLayers.push(l); this.allDrawnItems.removeLayer(l); } });

        leafletImage(this.map, (err, canvas) => {
            textLayers.forEach(l => this.allDrawnItems.addLayer(l));
            if (err) return alert("画像化失敗");
            const ctx = canvas.getContext('2d');
            textLayers.forEach(l => {
                const point = this.map.latLngToContainerPoint(l.getLatLng());
                const txt = l.options.textVal;
                ctx.font = "bold 14px sans-serif";
                const metrics = ctx.measureText(txt);
                ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
                ctx.fillRect(point.x - (metrics.width/2) - 8, point.y - 25, metrics.width + 16, 22);
                ctx.strokeStyle = "#0000ff"; ctx.strokeRect(point.x - (metrics.width/2) - 8, point.y - 25, metrics.width + 16, 22);
                ctx.fillStyle = "#0000ff"; ctx.textAlign = "center"; ctx.fillText(txt, point.x, point.y - 8);
            });
            window.photoApp.photos.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.8), memo: `地図メモ`, tag: "地図メモ" });
            window.photoApp.currentIndex = window.photoApp.photos.length - 1; photoApp.render(); photoApp.updateHeaderSummary();
            alert("写真に追加しました");
        });
    },
    setCurrentLocation() { if (this.map) this.map.locate({setView: true, maxZoom: 16}); }
};

// --- 写真管理 ---
window.photoApp = {
    photos: [], currentIndex: -1,
    async handleFile(input) {
        for (const file of Array.from(input.files)) { const d = await this.resizeImage(file); this.photos.push({ dataUrl: d, memo: "", tag: "補足" }); }
        this.currentIndex = this.photos.length - 1; this.render(); this.updateHeaderSummary(); input.value = "";
    },
    resizeImage(f) {
        return new Promise((res) => {
            const r = new FileReader(); r.readAsDataURL(f);
            r.onload = (e) => {
                const i = new Image(); i.src = e.target.result;
                i.onload = () => {
                    const c = document.createElement('canvas'); let w = i.width, h = i.height;
                    if (w > h) { if (w > 1200) { h *= 1200/w; w = 1200; } } else { if (h > 1200) { w *= 1200/h; h = 1200; } }
                    c.width = w; c.height = h; c.getContext('2d').drawImage(i, 0, 0, w, h);
                    res(c.toDataURL('image/jpeg', 0.8));
                };
            };
        });
    },
    updateTag(tag) {
        if (this.currentIndex === -1) return;
        this.photos[this.currentIndex].tag = tag;
        this.photos.sort((a, b) => { const s = { "全景": 1, "近景": 2, "地図メモ": 3, "補足": 4 }; return (s[a.tag] || 99) - (s[b.tag] || 99); });
        this.currentIndex = 0; this.render();
    },
    render() {
        const d = document.getElementById('photo-display'), c = document.getElementById('photo-counter'), m = document.getElementById('photo-memo'), t = document.getElementById('photo-tag');
        if (this.photos.length === 0) { d.innerHTML = '<span>No Image</span>'; c.textContent = "0/0"; m.value = ""; this.currentIndex = -1; return; }
        const p = this.photos[this.currentIndex]; d.innerHTML = `<img src="${p.dataUrl}" style="width:100%;height:100%;object-fit:contain;">`;
        c.textContent = `${this.currentIndex + 1}/${this.photos.length}`; m.value = p.memo; t.value = p.tag;
    },
    next() { if (this.currentIndex < this.photos.length - 1) { this.currentIndex++; this.render(); } },
    prev() { if (this.currentIndex > 0) { this.currentIndex--; this.render(); } },
    delete() { if (this.currentIndex === -1 || !confirm("削除？")) return; this.photos.splice(this.currentIndex, 1); this.currentIndex = Math.max(-1, this.photos.length - 1); this.render(); this.updateHeaderSummary(); },
    updateMemo(v) { if (this.currentIndex !== -1) this.photos[this.currentIndex].memo = v; },
    updateHeaderSummary() {
        const s = document.querySelector('.accordion-item[data-group="photo-area"] .summary-text');
        if (s) { s.textContent = `${this.photos.length}枚`; s.classList.toggle('filled', this.photos.length > 0); }
    }
};

// --- 入出力（全項目CSV整合版） ---
window.appControl = {
    getFormData() {
        const d = {}; document.querySelectorAll('.accordion-item input, .accordion-item select, .accordion-item textarea').forEach(i => { if (i.name) d[i.name] = i.value; });
        const main = [], sub = []; window.mapApp.allDrawnItems.eachLayer(l => {
            const geo = l.toGeoJSON(); geo.properties.isMain = !!l.options.isMain;
            if (l.options.isText) { geo.properties.isText = true; geo.properties.textVal = l.options.textVal; }
            if (l.options.isMain) main.push(geo); else sub.push(geo);
        });
        d.mainGeom = { type: "FeatureCollection", features: main }; d.subGeom = { type: "FeatureCollection", features: sub };
        return d;
    },
    async exportZip() {
        const zip = new JSZip(); const d = this.getFormData(); const folder = zip.folder("photos");
        d.photoList = window.photoApp.photos.map((p, i) => { const fn = `photo_${i}.jpg`; folder.file(fn, p.dataUrl.split(',')[1], {base64: true}); return { fileName: fn, memo: p.memo, tag: p.tag }; });
        zip.file("survey_data.json", JSON.stringify(d, null, 2));
        zip.generateAsync({type:"blob"}).then(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = this.getFn() + ".zip"; a.click(); });
    },
    exportCSV() {
        const d = this.getFormData(); const c = window.mapApp.getMainCoords();
        const headers = ["調査日","会社ID","調査班長名","整理番号","災害番号","所属名","被災場所","路線・河川名等","被災日","延長 [m]","高さ [m]","岸別","距離標・区間","コメント","被災拡大の可能性","拡大状況","特記事項有無","特記事項状況","対策の概要","会社名","電話番号","FAX番号","職氏名","E-mail","起点座標","終点座標","写真枚数"];
        const row = [d.survey_date, d.company_id, d.leader_name, d.ref_no, d.disaster_no, d.dept_name, d.loc_name, d.route_name, d.damage_date, d.length, d.height, d.side_type, d.distance_label, d.comment, d.expansion_exists, d.expansion_status, d.special_exists, d.special_status, d.plan_summary, d.company_name, d.tel, d.fax, d.person_name, d.email, c.start, c.end, window.photoApp.photos.length]
                    .map(v => `"${(v || "").toString().replace(/"/g, '""')}"`);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(["\uFEFF" + headers.join(",") + "\n" + row.join(",")], {type:"text/csv"})); a.download = this.getFn() + ".csv"; a.click();
    },
    importZip(input) {
        const file = input.files[0]; if (!file) return;
        JSZip.loadAsync(file).then(async zip => {
            const json = JSON.parse(await zip.file("survey_data.json").async("string"));
            Object.keys(json).forEach(k => { const el = document.querySelector(`[name="${k}"]`); if (el) { el.value = json[k]; el.dispatchEvent(new Event('input')); } });
            window.mapApp.init(); window.mapApp.allDrawnItems.clearLayers();
            const restore = (geom, isM) => {
                if (!geom) return;
                L.geoJSON(geom).eachLayer(l => {
                    l.options.isMain = isM;
                    if (l.feature.properties && l.feature.properties.isText) { window.mapApp.allDrawnItems.addLayer(window.mapApp.createTextLayer(l.getLatLng(), l.feature.properties.textVal)); }
                    else { if (l.setStyle) l.setStyle({ color: isM ? '#ff0000' : '#0000ff', weight: 6, opacity: 0.7 }); if (isM && l instanceof L.Marker) { l.options.icon = new L.Icon.Default(); l.on('add', () => { if(l._icon) l._icon.classList.add('marker-red'); }); } window.mapApp.allDrawnItems.addLayer(l); }
                });
            };
            restore(json.mainGeom, true); restore(json.subGeom, false); window.mapApp.updateMapSummary();
            window.photoApp.photos = []; for (const p of json.photoList) { const b64 = await zip.file(`photos/${p.fileName}`).async("base64"); window.photoApp.photos.push({ dataUrl: `data:image/jpeg;base64,${b64}`, memo: p.memo, tag: p.tag }); }
            window.photoApp.currentIndex = 0; window.photoApp.render(); window.photoApp.updateHeaderSummary(); alert("インポート完了");
        });
    },
    exportCurrentApp() {
        document.querySelectorAll('input, select, textarea').forEach(el => {
            if (el.tagName === 'TEXTAREA') el.innerText = el.value;
            else if (el.tagName === 'SELECT') Array.from(el.options).forEach(o => o.selected ? o.setAttribute('selected','selected') : o.removeAttribute('selected'));
            else if (el.type !== 'file') el.setAttribute('value', el.value);
        });
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(["<!DOCTYPE html>\n" + document.documentElement.outerHTML], {type: 'text/html'})); a.download = "configured_app.html"; a.click();
    },
    getFn() {
        const d = this.getFormData(); const p = [];
        ['fn1','fn2','fn3','fn4','fn5'].forEach(id => { const v = document.getElementById(id).value; if (v !== 'none') p.push((d[v] || 'null').toString().replace(/-/g, '')); });
        return p.join('_') || 'survey';
    }
};

// --- 基本制御 ---
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-btn').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); t.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === t.dataset.target));
    }));
    document.querySelectorAll('.accordion-header').forEach(h => h.addEventListener('click', () => {
        const content = h.nextElementSibling; if (!content) return;
        const open = content.style.display === 'block';
        document.querySelectorAll('.accordion-content').forEach(x => x.style.display = 'none');
        document.querySelectorAll('.accordion-header .icon').forEach(i => i.textContent = '+');
        if (!open) { content.style.display = 'block'; h.querySelector('.icon').textContent = '-'; if (h.parentElement.dataset.group === 'map-area') { window.mapApp.init(); setTimeout(() => window.mapApp.map.invalidateSize(), 200); } }
    }));
    const updateS = (item) => {
        const s = item.querySelector('.summary-text'); if (!s || ['map-area', 'photo-area', 'io-area'].includes(item.dataset.group)) return;
        const vals = Array.from(item.querySelectorAll('input, select, textarea')).map(i => i.value).filter(v => v && v !== 'none' && v !== '');
        if (vals.length > 0) { s.textContent = vals.join(' / ').substring(0, 20); s.classList.replace('empty', 'filled'); }
        else { s.textContent = '未入力'; s.classList.replace('filled', 'empty'); }
    };
    document.querySelectorAll('.accordion-item').forEach(item => { item.querySelectorAll('input, select, textarea').forEach(i => i.addEventListener('input', () => updateS(item))); updateS(item); });
    const d = document.getElementById('default-date'); if (d) d.value = new Date().toISOString().split('T')[0];
});