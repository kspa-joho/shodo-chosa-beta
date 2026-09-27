// =============================================================================
// 白紙メモ (sketchApp)
// =============================================================================
// 【Phase 6.03 段階2続き】消しゴムを廃止し「編集」モードに統合（改修指示書Step2-③）。
// ツールは ペン(free) / 直線(line) / 文字(text) / 編集(edit) の4つ。
// 編集モードでは、既存の要素（文字・直線・ペンの線）をタップして選択し、
// 種類ごとに異なる操作を行う：
//   ・文字　　：選択して移動。浮動ツールバーで回転(±15度)・内容編集・削除。
//   ・直線　　：始点・終点それぞれに丸いつまみを表示し、個別に位置を直せる。
//               つまみ以外の線上をつまむと線全体を平行移動できる。浮動ツールバーは削除のみ。
//   ・ペンの線：形は変えず、線全体をそのまま平行移動するだけ（点の個別編集はしない）。
//               浮動ツールバーは削除のみ。
// 個々の要素を選んで🗑で消せるようになったため、消しゴム（面で塗りつぶして隠す方式）は廃止した。
//
// 【Phase 6.27】ペン色を、3色ボタンから12色のプルダウンに変更（既定は黒）。
//
// 【Phase 6.04】「線」ツールを、2点だけの直線から、タップのたびに頂点を追加していく
// 連続線（折れ線）に変更。タップするごとに1点追加し、「完了」ボタンで確定、
// 「中止」ボタンで破棄する。編集モードでは、確定した線のどの頂点にもつまみが出て、
// 個別に位置を直せる（つまみ以外の線上をつまむと線全体を平行移動）。
// =============================================================================
window.sketchApp = {
    canvas: null, ctx: null, isDrawing: false, startX: 0, startY: 0,
    mode: 'free', color: 'black',
    elements: [],
    currentStroke: null,

    // 選択・ドラッグ共通の状態
    selectedIndex: null,
    dragType: null,       // 'text' | 'line-endpoint' | 'line-whole' | 'stroke-whole'
    dragPointIndex: null, // 'line-endpoint'のときの対象点（0=始点, 1=終点）
    lastPos: null,        // 直前のタップ/ドラッグ位置（増分移動の基準）
    _pendingTextPos: null,
    _editingIndex: null,
    buildingPolyline: null, // 連続線：タップのたびに頂点を追加していく途中データ
    selectedPointIndex: null, // 線のうち、今つまんでいる頂点（1点だけ削除する対象）

    HANDLE_R: 14,     // 直線の端点つまみの当たり判定半径(px)
    LINE_HIT_TOL: 12, // 直線の「線上」判定の許容距離(px)
    BBOX_PAD: 15,      // ペンの線のバウンディングボックス判定の余白(px)

    init() {
        const canvas = document.getElementById('sketch-canvas');
        if (!canvas) return;
        if (!this.canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            const start = (e) => this.start(this.getPos(e));
            const move = (e) => this.move(this.getPos(e));
            const end = () => this.end();
            canvas.addEventListener('mousedown', start);
            canvas.addEventListener('mousemove', move);
            canvas.addEventListener('mouseup', end);
            canvas.addEventListener('mouseout', end);
            canvas.addEventListener('touchstart', (e) => { if(e.cancelable) e.preventDefault(); start(e.touches[0]); }, {passive:false});
            canvas.addEventListener('touchmove', (e) => { if(e.cancelable) e.preventDefault(); move(e.touches[0]); }, {passive:false});
            canvas.addEventListener('touchend', end);
        }
        this.resizeAndClear();
    },

    resizeAndClear() {
        if(!this.canvas) return;
        const container = this.canvas.parentElement;
        if (!container) return;
        const w = container.clientWidth;
        const h = Math.round(w * 3 / 4);
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        this.redrawAll();
    },

    setTool(t) {
        if (this.mode === 'edit' && t !== 'edit') {
            this.selectedIndex = null;
            this.selectedPointIndex = null;
            this.hideFloatingToolbar();
        }
        if (this.mode === 'line' && t !== 'line' && this.buildingPolyline) {
            // 描きかけの連続線は破棄する
            this.buildingPolyline = null;
            this.hideLineToolbar();
        }
        this.mode = t;
        document.querySelectorAll('.sketch-toolbar .sketch-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById('sk-' + t);
        if(btn) btn.classList.add('active');
        this.redrawAll();
    },
    // 【Phase 6.27】ペン色は12色のプルダウン（#sketch-color-select）で選ぶ。既定は黒。
    setColor(c, btn) {
        this.color = c;
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        if(btn) btn.classList.add('active');
        const sel = document.getElementById('sketch-color-select');
        if (sel) { if (sel.value !== c) sel.value = c; sel.style.color = c; }
    },

    getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },

    // --- 入口：モードに応じて振り分け ---
    start(pos) {
        // プルダウンの表示と実際のペン色を一致させる（新規現場作成・全消去でプルダウンが初期値に戻った場合の食い違い防止）
        const _sel = document.getElementById('sketch-color-select');
        if (_sel && _sel.value !== this.color) this.setColor(_sel.value);
        if (this.mode === 'text') {
            this._pendingTextPos = pos;
            this._editingIndex = null;
            this.openTextModal('');
            return;
        }
        if (this.mode === 'edit') {
            this.startEdit(pos);
            return;
        }
        if (this.mode === 'line') {
            // タップのたびに頂点を追加していく（ドラッグ中の移動は見ない。タップ位置だけを見る）
            if (!this.buildingPolyline) {
                this.buildingPolyline = { type: 'stroke', mode: 'line', color: this.color, points: [{ x: pos.x, y: pos.y }] };
            } else {
                this.buildingPolyline.points.push({ x: pos.x, y: pos.y });
            }
            this.showLineToolbar();
            this.redrawAll();
            this.drawStroke(this.buildingPolyline);
            return;
        }
        // ペンの新規作成
        this.isDrawing = true;
        this.currentStroke = { type: 'stroke', mode: this.mode, color: this.color, points: [{ x: pos.x, y: pos.y }] };
    },
    move(pos) {
        if (this.mode === 'edit') { this.moveEdit(pos); return; }
        if (this.mode === 'line') return; // 連続線はタップだけで頂点を追加するのでドラッグ中は何もしない
        if (!this.isDrawing || !this.currentStroke) return;
        this.currentStroke.points.push({ x: pos.x, y: pos.y });
        this.redrawAll();
        this.drawStroke(this.currentStroke);
    },
    end() {
        if (this.mode === 'edit') { this.dragType = null; return; }
        if (this.mode === 'line') return; // 頂点の追加はstart()側で完結している
        if (this.isDrawing && this.currentStroke && this.currentStroke.points.length > 1) {
            this.elements.push(this.currentStroke);
        }
        this.isDrawing = false;
        this.currentStroke = null;
        this.redrawAll();
    },

    // --- 連続線：完了・中止 ---
    showLineToolbar() {
        const tb = document.getElementById('sketch-line-toolbar');
        if (tb) tb.style.display = 'flex';
    },
    hideLineToolbar() {
        const tb = document.getElementById('sketch-line-toolbar');
        if (tb) tb.style.display = 'none';
    },
    finishPolyline() {
        if (this.buildingPolyline && this.buildingPolyline.points.length >= 2) {
            this.elements.push(this.buildingPolyline);
        }
        this.buildingPolyline = null;
        this.hideLineToolbar();
        this.redrawAll();
    },
    cancelPolyline() {
        this.buildingPolyline = null;
        this.hideLineToolbar();
        this.redrawAll();
    },

    // --- 編集モード：選択開始 ---
    startEdit(pos) {
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const el = this.elements[i];
            if (el.type === 'text') {
                if (this.hitTestOneText(pos, el)) {
                    this.selectedIndex = i; this.dragType = 'text'; this.selectedPointIndex = null; this.lastPos = pos;
                    this.redrawAll(); this.updateFloatingToolbar();
                    return;
                }
            } else if (el.type === 'stroke' && el.mode === 'line') {
                // 全ての頂点を対象に、つまみの当たり判定を行う（連続線対応）
                let handleHit = -1;
                for (let j = 0; j < el.points.length; j++) {
                    if (this.dist(pos, el.points[j]) <= this.HANDLE_R) { handleHit = j; break; }
                }
                if (handleHit !== -1) {
                    this.selectedIndex = i; this.dragType = 'line-endpoint'; this.dragPointIndex = handleHit;
                    this.selectedPointIndex = handleHit; this.lastPos = pos;
                    this.redrawAll(); this.updateFloatingToolbar();
                    return;
                }
                let minSegDist = Infinity;
                for (let j = 0; j < el.points.length - 1; j++) {
                    const d = this.pointToSegmentDist(pos, el.points[j], el.points[j + 1]);
                    if (d < minSegDist) minSegDist = d;
                }
                if (minSegDist <= this.LINE_HIT_TOL) {
                    this.selectedIndex = i; this.dragType = 'line-whole'; this.selectedPointIndex = null; this.lastPos = pos;
                    this.redrawAll(); this.updateFloatingToolbar();
                    return;
                }
            } else if (el.type === 'stroke' && el.mode === 'free') {
                if (this.hitTestBBox(pos, el)) {
                    this.selectedIndex = i; this.dragType = 'stroke-whole'; this.selectedPointIndex = null; this.lastPos = pos;
                    this.redrawAll(); this.updateFloatingToolbar();
                    return;
                }
            }
        }
        // 何にも当たらなければ選択解除
        this.selectedIndex = null; this.dragType = null; this.selectedPointIndex = null;
        this.hideFloatingToolbar();
        this.redrawAll();
    },
    moveEdit(pos) {
        if (this.selectedIndex === null || !this.dragType || !this.lastPos) return;
        const dx = pos.x - this.lastPos.x, dy = pos.y - this.lastPos.y;
        const el = this.elements[this.selectedIndex];
        if (this.dragType === 'text') {
            el.x += dx; el.y += dy;
        } else if (this.dragType === 'line-endpoint') {
            el.points[this.dragPointIndex].x += dx; el.points[this.dragPointIndex].y += dy;
        } else if (this.dragType === 'line-whole' || this.dragType === 'stroke-whole') {
            el.points.forEach(p => { p.x += dx; p.y += dy; });
        }
        this.lastPos = pos;
        this.redrawAll();
        this.updateFloatingToolbar();
    },

    // --- 当たり判定ヘルパー ---
    pointToSegmentDist(p, a, b) {
        const abx = b.x - a.x, aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        if (len2 === 0) return this.dist(p, a);
        let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
        t = Math.max(0, Math.min(1, t));
        const proj = { x: a.x + t * abx, y: a.y + t * aby };
        return this.dist(p, proj);
    },
    hitTestBBox(pos, el) {
        const xs = el.points.map(p => p.x), ys = el.points.map(p => p.y);
        const minX = Math.min(...xs) - this.BBOX_PAD, maxX = Math.max(...xs) + this.BBOX_PAD;
        const minY = Math.min(...ys) - this.BBOX_PAD, maxY = Math.max(...ys) + this.BBOX_PAD;
        return pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY;
    },
    rotatePoint(p, center, angle) {
        const dx = p.x - center.x, dy = p.y - center.y;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
    },
    getTextBounds(el) {
        this.ctx.font = "bold 16px sans-serif";
        const lines = (el.text || '').split('\n');
        const lineHeight = 20;
        let maxW = 0;
        lines.forEach(line => { const w = this.ctx.measureText(line).width; if (w > maxW) maxW = w; });
        return { x: el.x - 4, y: el.y - lineHeight + 2, w: maxW + 8, h: lines.length * lineHeight + 6 };
    },
    hitTestOneText(pos, el) {
        const angle = el.rotation || 0;
        const local = this.rotatePoint(pos, { x: el.x, y: el.y }, -angle);
        const b = this.getTextBounds(el);
        return local.x >= b.x && local.x <= b.x + b.w && local.y >= b.y && local.y <= b.y + b.h;
    },

    // --- 選択中の要素への操作（文字・直線・ペン共通） ---
    rotateSelected(deg) {
        if (this.selectedIndex === null) return;
        const el = this.elements[this.selectedIndex];
        if (el.type !== 'text') return;
        el.rotation = (el.rotation || 0) + deg * Math.PI / 180;
        this.redrawAll();
        this.updateFloatingToolbar();
    },
    editSelectedText() {
        if (this.selectedIndex === null) return;
        const el = this.elements[this.selectedIndex];
        if (el.type !== 'text') return;
        this._editingIndex = this.selectedIndex;
        this.openTextModal(el.text);
    },
    deleteSelected() {
        if (this.selectedIndex === null) return;
        this.elements.splice(this.selectedIndex, 1);
        this.selectedIndex = null; this.dragType = null; this.selectedPointIndex = null;
        this.hideFloatingToolbar();
        this.redrawAll();
    },
    // 線の、今つまんでいる頂点1点だけを削除する（線自体は残す）。2点以下の線は対象外（全体削除を使う）。
    deleteSelectedPoint() {
        if (this.selectedIndex === null || this.selectedPointIndex === null) return;
        const el = this.elements[this.selectedIndex];
        if (!el || el.type !== 'stroke' || el.mode !== 'line') return;
        if (el.points.length <= 2) return;
        el.points.splice(this.selectedPointIndex, 1);
        this.selectedPointIndex = null;
        this.dragType = null;
        this.redrawAll();
        this.updateFloatingToolbar();
    },
    updateFloatingToolbar() {
        const el = this.elements[this.selectedIndex];
        const toolbar = document.getElementById('sketch-text-toolbar');
        if (!el || !toolbar) return;
        const isText = el.type === 'text';
        const isLinePoint = (el.type === 'stroke' && el.mode === 'line' && this.selectedPointIndex !== null && el.points.length > 2);
        // 文字のときだけ回転・内容編集ボタンを見せる。線の頂点をつまんでいるときだけ「この点だけ削除」を見せる。
        const rl = document.getElementById('sk-tb-rotate-l');
        const rr = document.getElementById('sk-tb-rotate-r');
        const ed = document.getElementById('sk-tb-edit');
        const dp = document.getElementById('sk-tb-delpoint');
        if (rl) rl.style.display = isText ? 'inline-block' : 'none';
        if (rr) rr.style.display = isText ? 'inline-block' : 'none';
        if (ed) ed.style.display = isText ? 'inline-block' : 'none';
        if (dp) dp.style.display = isLinePoint ? 'inline-block' : 'none';

        let b;
        if (isText) {
            b = this.getTextBounds(el);
        } else {
            const xs = el.points.map(p => p.x), ys = el.points.map(p => p.y);
            b = { x: Math.min(...xs), y: Math.min(...ys) };
        }
        toolbar.style.left = Math.max(0, b.x) + 'px';
        toolbar.style.top = Math.max(0, b.y - 40) + 'px';
        toolbar.style.display = 'flex';
    },
    hideFloatingToolbar() {
        const toolbar = document.getElementById('sketch-text-toolbar');
        if (toolbar) toolbar.style.display = 'none';
    },

    // --- 文字入力モーダル（複数行対応） ---
    openTextModal(initialText) {
        const modal = document.getElementById('sketch-text-modal');
        const textarea = document.getElementById('sketch-text-textarea');
        if (!modal || !textarea) return;
        textarea.value = initialText || '';
        modal.style.display = 'flex';
        setTimeout(() => textarea.focus(), 50);
    },
    cancelTextModal() {
        const modal = document.getElementById('sketch-text-modal');
        if (modal) modal.style.display = 'none';
        this._pendingTextPos = null;
        this._editingIndex = null;
    },
    confirmTextModal() {
        const textarea = document.getElementById('sketch-text-textarea');
        const modal = document.getElementById('sketch-text-modal');
        const text = textarea ? textarea.value : '';
        if (modal) modal.style.display = 'none';
        if (!text || !text.trim()) { this._pendingTextPos = null; this._editingIndex = null; return; }
        if (this._editingIndex !== null && this._editingIndex !== undefined) {
            this.elements[this._editingIndex].text = text;
            this.selectedIndex = this._editingIndex;
        } else if (this._pendingTextPos) {
            const newEl = { type: 'text', x: this._pendingTextPos.x, y: this._pendingTextPos.y, color: this.color, text, rotation: 0 };
            this.elements.push(newEl);
        }
        this._pendingTextPos = null;
        this._editingIndex = null;
        this.redrawAll();
    },

    undo() {
        if (this.elements.length === 0) return;
        this.elements.pop();
        this.selectedIndex = null; this.dragType = null; this.selectedPointIndex = null;
        this.hideFloatingToolbar();
        this.redrawAll();
    },
    clearAll() {
        if (confirm("メモを全消去しますか？")) {
            this.elements = [];
            this.selectedIndex = null; this.dragType = null; this.selectedPointIndex = null;
            this.hideFloatingToolbar();
            this.redrawAll();
        }
    },

    // --- 描画 ---
    drawStroke(el) {
        if (!el.points || el.points.length < 1) return;
        this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = el.color; this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) this.ctx.lineTo(el.points[i].x, el.points[i].y);
        this.ctx.stroke();
    },
    // 作図中の連続線：置いた各点に小さい丸を表示する（1点目でも見えるように）
    drawPolylinePoints(el) {
        if (!el.points) return;
        this.ctx.save();
        el.points.forEach(p => {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            this.ctx.fillStyle = el.color;
            this.ctx.fill();
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();
        });
        this.ctx.restore();
    },
    drawText(el) {
        const angle = el.rotation || 0;
        const lines = (el.text || '').split('\n');
        const lineHeight = 20;
        this.ctx.save();
        this.ctx.translate(el.x, el.y);
        this.ctx.rotate(angle);
        this.ctx.fillStyle = el.color;
        this.ctx.font = "bold 16px sans-serif";
        lines.forEach((line, i) => { this.ctx.fillText(line, 0, i * lineHeight); });
        this.ctx.restore();
    },
    // 選択中の要素の見た目のフィードバック（点線の枠、直線は端点つまみ）
    drawSelectionUI(el) {
        this.ctx.save();
        this.ctx.strokeStyle = '#3498db'; this.ctx.lineWidth = 1;
        if (el.type === 'text') {
            const b = this.getTextBounds(el);
            this.ctx.translate(el.x, el.y);
            this.ctx.rotate(el.rotation || 0);
            this.ctx.setLineDash([4, 3]);
            this.ctx.strokeRect(b.x - el.x, b.y - el.y, b.w, b.h);
        } else if (el.mode === 'line') {
            this.ctx.setLineDash([]);
            el.points.forEach(p => {
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(52,152,219,0.3)';
                this.ctx.fill();
                this.ctx.stroke();
            });
        } else {
            const xs = el.points.map(p => p.x), ys = el.points.map(p => p.y);
            this.ctx.setLineDash([4, 3]);
            this.ctx.strokeRect(Math.min(...xs) - this.BBOX_PAD, Math.min(...ys) - this.BBOX_PAD,
                (Math.max(...xs) - Math.min(...xs)) + this.BBOX_PAD * 2, (Math.max(...ys) - Math.min(...ys)) + this.BBOX_PAD * 2);
        }
        this.ctx.restore();
    },

    clearCanvas() {
        if(!this.ctx) return;
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    },
    redrawAll() {
        this.clearCanvas();
        this.elements.forEach(el => {
            if (el.type === 'stroke') this.drawStroke(el);
            else if (el.type === 'text') this.drawText(el);
        });
        if (this.mode === 'line' && this.buildingPolyline) {
            this.drawStroke(this.buildingPolyline);
            this.drawPolylinePoints(this.buildingPolyline);
        }
        if (this.mode === 'edit' && this.selectedIndex !== null && this.elements[this.selectedIndex]) {
            this.drawSelectionUI(this.elements[this.selectedIndex]);
        }
    },

    saveToPhoto() {
        if (!window.photoApp) return;
        this.selectedIndex = null; this.dragType = null; this.selectedPointIndex = null;
        this.hideFloatingToolbar();
        this.redrawAll();
        const dataUrl = this.canvas.toDataURL('image/jpeg', 0.8);
        window.photoApp.photos.push({ dataUrl: dataUrl, memo: "手書きメモ", tag: "地図メモ" });
        window.photoApp.currentIndex = window.photoApp.photos.length - 1;
        window.photoApp.render();
        window.photoApp.updateHeaderSummary();
        if(window.uiHelper) window.uiHelper.showToast("メモを写真に追加しました");
        else alert("写真に追加しました");
    }
};
document.addEventListener('click', (e) => {
    const header = e.target.closest('.accordion-header');
    if (header && header.parentElement.dataset.group === 'map-area') {
        setTimeout(() => {
            const sketchContainer = document.getElementById('sketch-container');
            if (sketchContainer && sketchContainer.style.display === 'block') {
                if (window.sketchApp) window.sketchApp.init();
            }
        }, 250);
    }
});
