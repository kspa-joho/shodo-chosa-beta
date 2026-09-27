// --- インポート・エクスポートモジュール ---
Object.assign(window.managerApp, {
    setupDropZone() {
        const dz = document.getElementById('drop-zone');
        if (!dz) return;
        dz.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file'; input.multiple = true; input.accept = '.zip';
            input.onchange = (e) => managerApp.handleFiles(e.target.files);
            input.click();
        };
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('drop', (e) => { e.preventDefault(); managerApp.handleFiles(e.dataTransfer.files); });
    },

    async handleFiles(files) {
        for (const file of Array.from(files)) {
            if (file.name.endsWith('.zip')) await managerApp.importJZip(file);
        }
        managerApp.refreshAll();
    },

    async importJZip(file) {
        try {
            const zip = await JSZip.loadAsync(file);
            const jsonStr = await zip.file("survey_data.json").async("string");
            const data = JSON.parse(jsonStr);
            data._key = `${data.company_id}_${data.ref_no}_${Date.now()}`;
            data._originalName = file.name.replace(/\.zip$/i, '');
            data._photos = [];
            if (data.photoList) {
                for (const p of data.photoList) {
                    const bFile = zip.file(`photos/${p.fileName}`);
                    if(bFile) {
                        const b64 = await bFile.async("base64");
                        data._photos.push({ dataUrl: `data:image/jpeg;base64,${b64}`, memo: p.memo, tag: p.tag });
                    }
                }
            }

            // 座標情報の自動抽出
            if (data.mainGeom && data.mainGeom.features && data.mainGeom.features.length > 0) {
                const geom = data.mainGeom.features[0].geometry;
                let sLat = "", sLng = "", eLat = "", eLng = "";
                
                if (geom.type === "Point") {
                    sLng = eLng = geom.coordinates[0];
                    sLat = eLat = geom.coordinates[1];
                } else if (geom.type === "LineString") {
                    const coords = geom.coordinates;
                    if (coords.length > 0) {
                        sLng = coords[0][0];
                        sLat = coords[0][1];
                        eLng = coords[coords.length - 1][0];
                        eLat = coords[coords.length - 1][1];
                    }
                } else if (geom.type === "Polygon" || geom.type === "MultiLineString") {
                    const coords = geom.coordinates[0];
                    if (coords && coords.length > 0) {
                        sLng = coords[0][0];
                        sLat = coords[0][1];
                        eLng = coords[coords.length - 1][0];
                        eLat = coords[coords.length - 1][1];
                    }
                }
                data.start_lat = sLat;
                data.start_lng = sLng;
                data.end_lat = eLat;
                data.end_lng = eLng;
            }

            this.db.push(data);
        } catch (e) { console.error("Import error", e); }
    },

    async exportSingleJZip() {
        const data = this.db.find(d => d._key === this.currentKey);
        if (!data) return;
        
        const zip = new JSZip(); 
        const folder = zip.folder("photos");
        const exportData = JSON.parse(JSON.stringify(data));
        
        const originalName = exportData._originalName; 
        delete exportData._key; 
        delete exportData._photos; 
        delete exportData._originalName;
        
        data._photos.forEach((p, i) => { 
            folder.file(`photo_${i}.jpg`, p.dataUrl.split(',')[1], {base64: true}); 
        });
        zip.file("survey_data.json", JSON.stringify(exportData, null, 2));
        
        const blob = await zip.generateAsync({type:"blob"});
        const a = document.createElement('a'); 
        a.href = URL.createObjectURL(blob);
        
        const dlName = originalName ? `${originalName}.zip` : `update_${data.ref_no}.zip`;
        a.download = dlName; 
        a.click();
    },

    executeExport() {
        const type = document.getElementById('export-type').value;
        if (type === 'csv') {
            this.exportTotalCSV();
        } else if (type === 'geojson') {
            this.exportGeoJSON();
        } else if (type === 'geojson_label') {
            this.exportGeoJSONLabelOnly();
        } else if (type === 'kml') {
            this.exportKML();
        } else if (type === 'kml_label') {
            this.exportKMLLabelOnly();
        }
    },

    exportTotalCSV() {
        const csv = "\uFEFF" + Object.keys(this.fieldMaster).map(k => this.fieldMaster[k].label).join(",") + "\n" + 
                    this.db.map(d => Object.keys(this.fieldMaster).map(k => `"${(d[k] || "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:"text/csv"}));
        a.download = `integrated_data.csv`; a.click();
    },

    // GeoJSON（線・点）: Point/LineStringをそのまま出力
    exportGeoJSON() {
        const features = this.db.map(d => {
            if (!d.mainGeom || !d.mainGeom.features || !d.mainGeom.features.length) return null;
            const geom = d.mainGeom.features[0].geometry;
            
            const props = {};
            Object.keys(this.fieldMaster).forEach(k => {
                props[this.fieldMaster[k].label] = d[k] || "";
            });

            return {
                type: "Feature",
                properties: props,
                geometry: geom
            };
        }).filter(f => f !== null);

        const geojson = { type: "FeatureCollection", features: features };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(geojson, null, 2)], {type: "application/geo+json"}));
        a.download = "integrated_data.geojson";
        a.click();
    },

    // GeoJSON（起点のみ）: LineStringは起点座標をPointに変換して出力
    // 地理院地図ではLineStringにラベルが表示されないため、
    // 起点Pointデータとして出力することでラベル表示が可能になる。
    exportGeoJSONLabelOnly() {
        const features = this.db.map(d => {
            if (!d.mainGeom || !d.mainGeom.features || !d.mainGeom.features.length) return null;
            const geom = d.mainGeom.features[0].geometry;

            const props = {};
            Object.keys(this.fieldMaster).forEach(k => {
                props[this.fieldMaster[k].label] = d[k] || "";
            });

            // Pointはそのまま / LineString等は起点座標をPointに変換
            let pointCoords;
            if (geom.type === "Point") {
                pointCoords = geom.coordinates;
            } else if (geom.type === "LineString") {
                pointCoords = geom.coordinates[0];
            } else if (geom.type === "Polygon" || geom.type === "MultiLineString") {
                pointCoords = geom.coordinates[0][0];
            } else {
                return null;
            }

            return {
                type: "Feature",
                properties: props,
                geometry: { type: "Point", coordinates: pointCoords }
            };
        }).filter(f => f !== null);

        const geojson = { type: "FeatureCollection", features: features };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(geojson, null, 2)], {type: "application/geo+json"}));
        a.download = "integrated_data_labelonly.geojson";
        a.click();
    },

    // KML（線・点）: Point/LineStringをそのまま出力
    exportKML() {
        let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Integrated Data</name>`;

        this.db.forEach(d => {
            if (!d.mainGeom || !d.mainGeom.features || !d.mainGeom.features.length) return;
            const geom = d.mainGeom.features[0].geometry;
            const name = d.disaster_no || d.ref_no || "No Name";
            
            let desc = '<table border="1">';
            Object.keys(this.fieldMaster).forEach(k => {
                desc += `<tr><td>${this.fieldMaster[k].label}</td><td>${d[k] || ""}</td></tr>`;
            });
            desc += '</table>';

            kml += `
    <Placemark>
      <name>${name}</name>
      <description><![CDATA[${desc}]]></description>`;

            if (geom.type === "Point") {
                kml += `
      <Point><coordinates>${geom.coordinates[0]},${geom.coordinates[1]}</coordinates></Point>`;
            } else if (geom.type === "LineString") {
                const coords = geom.coordinates.map(c => `${c[0]},${c[1]}`).join(" ");
                kml += `
      <LineString><coordinates>${coords}</coordinates></LineString>`;
            }

            kml += `
    </Placemark>`;
        });

        kml += `
  </Document>
</kml>`;

        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([kml], {type: "application/vnd.google-earth.kml+xml"}));
        a.download = "integrated_data.kml";
        a.click();
    },

    // KML（起点のみ）: LineStringは起点座標をPointに変換して出力
    // GoogleEarthではLineStringにラベルが表示されないため、
    // 起点Pointデータとして出力することでラベル表示が可能になる。
    exportKMLLabelOnly() {
        let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Integrated Data (起点のみ)</name>`;

        this.db.forEach(d => {
            if (!d.mainGeom || !d.mainGeom.features || !d.mainGeom.features.length) return;
            const geom = d.mainGeom.features[0].geometry;
            const name = d.disaster_no || d.ref_no || "No Name";

            let desc = '<table border="1">';
            Object.keys(this.fieldMaster).forEach(k => {
                desc += `<tr><td>${this.fieldMaster[k].label}</td><td>${d[k] || ""}</td></tr>`;
            });
            desc += '</table>';

            // Point はそのまま / LineString等は起点座標をPointに変換
            let pointCoords;
            if (geom.type === "Point") {
                pointCoords = geom.coordinates;
            } else if (geom.type === "LineString") {
                pointCoords = geom.coordinates[0];
            } else if (geom.type === "Polygon" || geom.type === "MultiLineString") {
                pointCoords = geom.coordinates[0][0];
            } else {
                return;
            }

            kml += `
    <Placemark>
      <name>${name}</name>
      <description><![CDATA[${desc}]]></description>
      <Point><coordinates>${pointCoords[0]},${pointCoords[1]}</coordinates></Point>
    </Placemark>`;
        });

        kml += `
  </Document>
</kml>`;

        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([kml], {type: "application/vnd.google-earth.kml+xml"}));
        a.download = "integrated_data_labelonly.kml";
        a.click();
    }
});
