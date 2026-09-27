// --- 地図日本語化 & 挙動カスタマイズ（完全版） ---
const setupJapaneseDraw = () => {
    if (typeof L === 'undefined' || typeof L.drawLocal === 'undefined') return;
    
    // 【決定的な修正】ポリラインの「マーカークリックで完了」する挙動のみを無効化
    // これにより、描画機能（マーカー生成など）は正常に保ちつつ、
    // 誤操作による勝手な完了だけを防ぐことができる。
    if (L.Draw && L.Draw.Polyline) {
        L.Draw.Polyline.prototype._onMarkerClick = function() {
            // 何もしない。
            // これにより、頂点をタップしても完了せず、線を書き続けられる。
            // 完了するには「完了」ボタンを押す必要がある。
        };
    }

    // 文言設定
    L.drawLocal.draw.toolbar.actions.title = '描画をキャンセル';
    L.drawLocal.draw.toolbar.actions.text = '中止';
    L.drawLocal.draw.toolbar.finish.title = '描画を完了';
    L.drawLocal.draw.toolbar.finish.text = '完了';
    L.drawLocal.draw.toolbar.undo.title = '最後に追加した点を削除';
    L.drawLocal.draw.toolbar.undo.text = '戻る';
    L.drawLocal.draw.toolbar.buttons.polyline = 'ラインを描く';
    L.drawLocal.draw.toolbar.buttons.polygon = '範囲を描く';
    L.drawLocal.draw.toolbar.buttons.marker = '地点をプロット';
    L.drawLocal.draw.toolbar.buttons.circlemarker = 'テキストを配置';
    L.drawLocal.edit.toolbar.actions.save.title = '変更を保存';
    L.drawLocal.edit.toolbar.actions.save.text = '保存';
    L.drawLocal.edit.toolbar.actions.cancel.title = '編集を中止し、変更を破棄';
    L.drawLocal.edit.toolbar.actions.cancel.text = 'キャンセル';
    L.drawLocal.edit.toolbar.actions.clearAll.title = '全ての図形を消去';
    L.drawLocal.edit.toolbar.actions.clearAll.text = '全て消去';
    L.drawLocal.edit.handlers.edit.tooltip.text = '制御点をドラッグして編集';
    L.drawLocal.edit.handlers.edit.tooltip.subtext = '変更を保存するには「保存」をクリック';
    L.drawLocal.edit.handlers.remove.tooltip.text = '削除する図形をクリック';
};

// 【Phase 5.98】+ / - ボタンと現在のズーム数値表示を1つの自作コントロールにまとめる。
// （Phase 5.95では別枠のコントロールとして追加していたため、Leafletの並び順の都合で
//   +/-ボタンの下に来てしまっていた。+とーの間に数字を挟む見た目にするため作り直す。）
L.Control.ZoomWithLevel = L.Control.extend({
    options: { position: 'topleft', zoomInTitle: '', zoomOutTitle: '' },
    onAdd(map) {
        const container = L.DomUtil.create('div', 'leaflet-bar zoom-with-level');
        this._map = map;

        this._zoomInBtn = this._createButton('+', this.options.zoomInTitle, 'zoom-with-level-in', container,
            () => map.zoomIn());
        this._levelLabel = L.DomUtil.create('div', 'zoom-with-level-num', container);
        this._zoomOutBtn = this._createButton('−', this.options.zoomOutTitle, 'zoom-with-level-out', container,
            () => map.zoomOut());

        map.on('zoomend', this._update, this);
        map.on('load', this._update, this);
        this._update();
        return container;
    },
    onRemove(map) {
        map.off('zoomend', this._update, this);
        map.off('load', this._update, this);
    },
    _createButton(html, title, className, container, onClick) {
        const link = L.DomUtil.create('a', className, container);
        link.innerHTML = html;
        link.href = '#';
        link.title = title;
        link.setAttribute('role', 'button');
        L.DomEvent.on(link, 'click', L.DomEvent.stop).on(link, 'click', onClick, this);
        L.DomEvent.disableClickPropagation(link);
        return link;
    },
    _update() {
        if (this._levelLabel) this._levelLabel.innerHTML = this._map.getZoom();
    }
});

// --- 地図管理 ---
window.mapApp = {
    map: null, allDrawnItems: null, drawControl: null, currentMode: 'main',
    // 【Phase 6.25】メイン図形（〇）は「位置を示すマーク」であり、ズームレベルによらず画面上で
    // 同じ大きさに見えるようにする。従来（〜6.24）は半径をメートルで指定した円（L.circle）で
    // 描いていたため、ズームアウトすると点のように小さくなり、ズームインすると大きくなっていた。
    // ピクセル指定のL.circleMarkerに変更した。保存される形は従来どおりGeoJSONのPoint（座標1点）で、
    // JZIP・AppBへの影響はない。
    // サイズの決め方：ズーム18（緯度約31.5度）で従来の半径10m・線幅6pxの〇を描くと、外形の直径は
    // 約45px（半径19.7px＋線幅の分）だった。これを1/3にした外形の直径約15px（半径6px＋線幅3px）にする。
    // 大きさを変えたい場合は、この2つの値だけを変える（作図・復元・地図の写真保存の全てが参照する）。
    MAIN_MARK_RADIUS_PX: 6,
    MAIN_MARK_WEIGHT: 3,
    createMainMark(latlng) {
        const m = L.circleMarker(latlng, {
            radius: this.MAIN_MARK_RADIUS_PX, color: '#ff0000', weight: this.MAIN_MARK_WEIGHT, fillOpacity: 0
        });
        m.options.isMain = true;
        return m;
    },

    // 【Phase 6.24】地図の中心を示す十字線。現在地ボタンで移動した後など、地図の中心（＝現在地）が
    // どこか分かりにくいという指摘への対応。地図コンテナに重ねるだけの飾りで、タップは下の地図へ通す
    // （pointer-events:none）。地図を写真に保存する処理（captureToPhoto）はタイル・図形・注記だけを
    // 描き写す方式のため、この十字線は保存画像には写り込まない。
    _addCrosshair() {
        const c = this.map.getContainer();
        if (c.querySelector('.map-crosshair')) return;
        const el = document.createElement('div');
        el.className = 'map-crosshair';
        el.style.cssText = 'position:absolute; left:50%; top:50%; width:0; height:0; z-index:650; pointer-events:none;';
        const bar = (css) => {
            const b = document.createElement('div');
            // 黒線＋白い縁取り：航空写真・地図のどちらの上でも見えるようにする
            b.style.cssText = 'position:absolute; background:#000; box-shadow:0 0 0 1px #fff;' + css;
            return b;
        };
        el.appendChild(bar('left:-14px; top:-1px; width:28px; height:2px;'));
        el.appendChild(bar('left:-1px; top:-14px; width:2px; height:28px;'));
        c.appendChild(el);
    },

    init() {
        if (this.map) return;
        setupJapaneseDraw();
        
        // オプションは全て標準（デフォルト）に戻す
        // これでブラウザ標準のスムーズな操作感が戻る
        this.map = L.map('map', { 
            renderer: L.canvas(),
            zoomControl: false,
            maxZoom: 25
        }).setView([31.5601, 130.5580], 16);
        
        // +ボタン・現在のズーム数値・-ボタンを1つのコントロールとして追加
        new L.Control.ZoomWithLevel().addTo(this.map);

        const layers = {
            "地理院 標準": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', { attribution: "GSI", crossOrigin: 'anonymous', maxZoom: 25, maxNativeZoom: 18 }),
            "地理院 写真": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', { attribution: "GSI", crossOrigin: 'anonymous', maxZoom: 25, maxNativeZoom: 18 }),
            "ESRI 衛星": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: "Esri", crossOrigin: 'anonymous', maxZoom: 25, maxNativeZoom: 19 })
        };
        layers["地理院 標準"].addTo(this.map);
        L.control.layers(layers).addTo(this.map);
        this.allDrawnItems = new L.FeatureGroup().addTo(this.map);
        this._addCrosshair();
        
        this.setMode('main');
        
        this.map.on(L.Draw.Event.CREATED, (e) => {
            let layer = e.layer;
            const isM = (this.currentMode === 'main');
            if (isM) {
                this.allDrawnItems.eachLayer(l => { if (l.options && l.options.isMain) this.allDrawnItems.removeLayer(l); });
            }
            if (!layer.options) layer.options = {};
            layer.options.isMain = isM;

            if (e.layerType === 'circlemarker') {
                const txt = prompt("注釈を入力してください");
                if (!txt) return;
                layer = this.createTextLayer(layer.getLatLng(), txt);
            } else if (e.layerType === 'marker') {
                if (isM) {
                    layer = this.createMainMark(layer.getLatLng());
                }
            } else if (layer.setStyle) {
                layer.setStyle({ color: isM ? '#ff0000' : '#0000ff', weight: 6, opacity: 0.7, fillOpacity: 0.4 });
            }
            this.allDrawnItems.addLayer(layer); 
            this.updateMapSummary();
        });
        
        this.map.on(L.Draw.Event.EDITED, () => this.updateMapSummary());
        this.map.on(L.Draw.Event.DELETED, () => this.updateMapSummary());
    },

    createTextLayer(latlng, txt) {
        return L.marker(latlng, {
            icon: L.divIcon({ className: 'map-text-wrapper', html: `<div class="map-text-label-inner">${txt}</div>` }),
            isText: true, textVal: txt, isMain: false
        });
    },

    setMode(mode) {
        this.currentMode = mode;
        if(this.drawControl) this.map.removeControl(this.drawControl);
        
        this.drawControl = new L.Control.Draw({
            edit: { featureGroup: this.allDrawnItems, remove: true },
            draw: mode === 'main' 
            ? { marker: true, polyline: { shapeOptions: { color: '#ff0000', weight: 6 } }, polygon: false, circle: false, rectangle: false, circlemarker: false }
            : { marker: true, polyline: { shapeOptions: { color: '#0000ff', weight: 4 } }, polygon: { shapeOptions: { color: '#0000ff', fillOpacity: 0.4 } }, circlemarker: true, circle: false, rectangle: false }
        });
        this.map.addControl(this.drawControl);
        this._moveDrawControlOutside();
    },

    // 【Phase 6.26】描画ツールバー（完了/戻る/中止・編集/削除を含む）を地図枠の外（上）へ移動し、描画の邪魔にならないようにする
    _moveDrawControlOutside() {
        const mapEl = document.getElementById('map');
        if (!mapEl || !this.drawControl) return;
        let bar = document.getElementById('map-draw-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'map-draw-bar';
            mapEl.parentNode.insertBefore(bar, mapEl);
        }
        const c = this.drawControl.getContainer();
        if (c && c.parentNode !== bar) bar.appendChild(c);
    },

    clearLayers() { if (confirm("全ての図形を消去しますか？")) { this.allDrawnItems.clearLayers(); this.updateMapSummary(); } },
    updateMapSummary() {
        let m = 0, s = 0; this.allDrawnItems.eachLayer(l => { if (l.options && l.options.isMain) m++; else s++; });
        const sum = document.querySelector('.accordion-item[data-group="map-area"] .summary-text');
        if (sum) sum.textContent = `メイン:${m} / サブ:${s}`;
    },

    getMainCoords() {
        let ml = null; this.allDrawnItems.eachLayer(l => { if (l.options && l.options.isMain) ml = l; });
        if (!ml) return { start: "", end: "" };
        const f = (ll) => `${ll.lat.toFixed(6)} ${ll.lng.toFixed(6)}`;
        if (ml instanceof L.Marker || ml instanceof L.CircleMarker) return { start: f(ml.getLatLng()), end: "" };
        const pts = ml.getLatLngs();
        if (!pts || pts.length === 0) return { start: "", end: ""};
        const flat = Array.isArray(pts[0]) ? pts[0] : pts;
        return { start: f(flat[0]), end: f(flat[flat.length - 1]) };
    },

    // 【Phase 5.97】地図タイルの自前合成方式に変更（Step2-①真っ黒画像バグ 最終対応）。
    // 経緯：
    //   1. leaflet-image → maxNativeZoomを超えたオーバーズーム時、実在しないタイルを
    //      サーバーへ再取得しに行き失敗。透明のままJPEG変換され黒くなる。
    //   2. html2canvas → 画面全体をキャプチャする汎用ライブラリのため、内部で画像を
    //      再取得しようとする際に地理院サーバー側で404になり、同じく黒くなる。
    //   3. 今回：どちらも「タイル画像をもう一度サーバーから取りに行く」ことが原因なので、
    //      新規の通信を一切せず、画面に既に読み込み済み・表示済みのタイル<img>要素を
    //      そのままcanvasへ描き写す方式に変更。19以上のオーバーズーム状態でも、
    //      Leafletが実際に画面へ貼り付けている「粗いなりの見たまま」の絵を、
    //      失敗しようがない形でそのまま保存できる。
    // 対象は地図のタイル・描画レイヤー（メイン/サブの図形・注記）のみ。
    // ズームボタン・ズームレベル数値・レイヤー切替・描画ツールバー等のLeafletコントロールは
    // そもそも合成対象に含めていないため、保存画像には一切写り込まない。
    captureToPhoto() {
        const mapEl = document.getElementById('map');
        if (!mapEl || !this.map) return;

        const size = this.map.getSize();
        const canvas = document.createElement('canvas');
        canvas.width = size.x;
        canvas.height = size.y;
        const ctx = canvas.getContext('2d');
        // 背景（タイルが読み込み中で隙間がある場合に真っ黒ではなく白にするため）
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // --- 1. タイル画像を描き写す ---
        // Leafletが既に画面へ配置済みの<img class="leaflet-tile">を、そのままの見た目で転写する。
        // 新規のネットワークリクエストは発生しない（読み込み済み画像を流用するのみ）。
        const mapRect = mapEl.getBoundingClientRect();
        const tileImgs = mapEl.querySelectorAll('.leaflet-tile-pane img.leaflet-tile');
        tileImgs.forEach((img) => {
            if (!img.complete || img.naturalWidth === 0) return; // 未読込・読込失敗タイルはスキップ（白背景のまま残る）
            const r = img.getBoundingClientRect();
            try {
                ctx.drawImage(img, r.left - mapRect.left, r.top - mapRect.top, r.width, r.height);
            } catch (e) {
                // 個別タイルの描画に失敗しても他のタイルの描画は継続する
                console.warn('タイル描画スキップ:', e);
            }
        });

        // --- 2. メイン/サブの図形・注記を描き写す ---
        // allDrawnItemsの緯度経度情報から、現在の地図の変換（zoom/中心）に基づき自前で座標変換する。
        const textLayers = [], drawLayers = [];
        this.allDrawnItems.eachLayer(l => {
            if (l.options && l.options.isText) { textLayers.push(l); return; }
            // メインモードで保存する際はサブ(落書き)の図形は含めない（従来の挙動を維持）
            if (this.currentMode === 'main' && l.options && !l.options.isMain) return;
            drawLayers.push(l);
        });

        drawLayers.forEach(l => {
            const isMain = !!(l.options && l.options.isMain);
            const color = isMain ? '#ff0000' : '#0000ff';
            if (l instanceof L.CircleMarker && !(l instanceof L.Circle)) {
                // 【Phase 6.25】メインの〇（ピクセル指定のマーク）：画面と同じピクセルサイズ・線幅でそのまま描く
                const p = this.map.latLngToContainerPoint(l.getLatLng());
                ctx.beginPath(); ctx.arc(p.x, p.y, l.getRadius(), 0, Math.PI * 2);
                ctx.lineWidth = (l.options && l.options.weight) || this.MAIN_MARK_WEIGHT;
                ctx.strokeStyle = color; ctx.stroke();
            } else if (l instanceof L.Circle) {
                // 中心から実距離(メートル)ぶん東へ移動した地点を求め、
                // 両点を同じcontainerPoint座標系に投影して画面上の半径(px)を算出する
                // （外部プラグイン不要・他の描画と同じ座標系で完結させるため）
                const center = l.getLatLng();
                const radiusM = l.getRadius();
                const dLng = (radiusM / (111320 * Math.cos(center.lat * Math.PI / 180)));
                const edgeLatLng = L.latLng(center.lat, center.lng + dLng);
                const c = this.map.latLngToContainerPoint(center);
                const edge = this.map.latLngToContainerPoint(edgeLatLng);
                const r = Math.max(4, Math.hypot(edge.x - c.x, edge.y - c.y) || 8);
                ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
                ctx.lineWidth = 6; ctx.strokeStyle = color; ctx.stroke();
            } else if (l instanceof L.Marker) {
                const p = this.map.latLngToContainerPoint(l.getLatLng());
                ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
                ctx.fillStyle = color; ctx.fill();
                ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
            } else if (l.getLatLngs) {
                const latlngsRaw = l.getLatLngs();
                const rings = Array.isArray(latlngsRaw[0]) ? latlngsRaw : [latlngsRaw];
                rings.forEach(ring => {
                    if (!ring || ring.length === 0) return;
                    ctx.beginPath();
                    ring.forEach((latlng, i) => {
                        const pt = this.map.latLngToContainerPoint(latlng);
                        if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
                    });
                    if (l instanceof L.Polygon) {
                        ctx.closePath();
                        ctx.fillStyle = color.replace(')', ',0.4)').replace('rgb', 'rgba') || color;
                        ctx.globalAlpha = 0.4; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
                    }
                    ctx.lineWidth = isMain ? 6 : 4; ctx.strokeStyle = color; ctx.stroke();
                });
            }
        });

        // --- 3. 注記（テキスト）を描き写す ---
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
        window.photoApp.currentIndex = window.photoApp.photos.length - 1;
        photoApp.render();
        photoApp.updateHeaderSummary();
        if (window.uiHelper) uiHelper.showToast("地図を写真に追加しました"); else alert("写真に追加しました");
    },
    setCurrentLocation() { if (this.map) this.map.locate({setView: true, maxZoom: 16}); },

    // =========================================================================
    // 写真GPS修正モード
    // =========================================================================
    // 使い方：
    //   photoApp.modifyGps() → mapApp.startGpsFixMode(photoIndex) を呼ぶ
    //   地図をタップ → 座標確定 → photoApp.applyGpsFix(lat, lng) を呼ぶ
    //   キャンセル → mapApp.cancelGpsFixMode() を呼ぶ
    // =========================================================================
    _gpsFixMode: false,
    _gpsFixPhotoIndex: null,
    _gpsFixMarker: null,

    startGpsFixMode(photoIndex) {
        this._gpsFixMode = true;
        this._gpsFixPhotoIndex = photoIndex;

        // バナーを表示
        const banner = document.getElementById('gps-fix-banner');
        if (banner) banner.style.display = 'flex';

        // 地図タップリスナーを登録
        this._gpsFixClickHandler = (e) => {
            if (!this._gpsFixMode) return;
            const { lat, lng } = e.latlng;

            // タップ位置にマーカーを表示
            if (this._gpsFixMarker) this.map.removeLayer(this._gpsFixMarker);
            this._gpsFixMarker = L.marker([lat, lng], {
                icon: L.divIcon({
                    className: '',
                    html: '<div style="width:16px;height:16px;background:#e74c3c;border:2px solid white;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>',
                    iconSize: [0, 0]
                })
            }).addTo(this.map);

            // 座標を写真に適用して修正モードを終了
            window.photoApp.applyGpsFix(lat, lng);
            this.cancelGpsFixMode();
        };
        this.map.on('click', this._gpsFixClickHandler);

        // 地図を invalidateSize してからズームイン
        setTimeout(() => {
            if (!this.map) return;
            this.map.invalidateSize();
        }, 350);

        setTimeout(() => {
            if (!this.map) return;
            const p = window.photoApp.photos[photoIndex];
            const currentZoom = this.map.getZoom();
            const targetZoom  = Math.min(currentZoom + 2, 25); // 現在+2（最大25）
            if (p && p.lat !== null) {
                // 既存GPSがあればその位置にズームイン
                this.map.setView([p.lat, p.lng], targetZoom);
            } else if (gpsManager.lat !== null) {
                // なければ現在地にズームイン
                this.map.setView([gpsManager.lat, gpsManager.lng], targetZoom);
            } else {
                // どちらもなければズームだけ上げる
                this.map.setZoom(targetZoom);
            }
        }, 500);
    },

    cancelGpsFixMode() {
        this._gpsFixMode = false;
        this._gpsFixPhotoIndex = null;

        // タップリスナーを解除
        if (this._gpsFixClickHandler) {
            this.map.off('click', this._gpsFixClickHandler);
            this._gpsFixClickHandler = null;
        }

        // 仮マーカーを削除
        if (this._gpsFixMarker) {
            this.map.removeLayer(this._gpsFixMarker);
            this._gpsFixMarker = null;
        }

        // バナーを非表示
        const banner = document.getElementById('gps-fix-banner');
        if (banner) banner.style.display = 'none';
    }
};
