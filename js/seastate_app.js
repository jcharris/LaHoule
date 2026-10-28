// =========================================================================
// 1. PHYSICAL CONSTANTS & DISPERSION SOLVER
// =========================================================================
const g = 9.81;

// Exact finite-depth dispersion relation: w^2 = g*k*tanh(kd)
function solveWaveNumber(omega, depth) {
    const w2 = omega * omega;
    let k = w2 / (g * Math.sqrt(Math.tanh(w2 * depth / g)));
    for (let iter = 0; iter < 5; iter++) {
        const th = Math.tanh(k * depth);
        const f = g * k * th - w2;
        const df = g * th + g * k * depth * (1.0 - th * th);
        const step = f / df;
        k -= step;
        if (Math.abs(step) < 1e-4) break;
    }
    return Math.max(1e-4, k);
}

// =========================================================================
// 2. THREE.JS SCENE, SKYBOX & LIGHTING SETUP
// =========================================================================
const container = document.getElementById('canvas3d');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.5, 8000);
camera.position.set(130, 36, 160);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 8;
controls.maxDistance = 1200;

// Directional Sunlight & Ambient Fill
const sunLight = new THREE.DirectionalLight(0xfff6e5, 3.0);
sunLight.position.set(-600, 350, 450);
scene.add(sunLight);

const ambientLight = new THREE.AmbientLight(0x64748b, 0.75);
scene.add(ambientLight);

// Fallback Procedural Skybox
function buildSkybox() {
    const cubeMap = new THREE.CubeTexture([]);
    const size = 256;
    for (let i = 0; i < 6; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, size);

        if (i === 2) {
            grad.addColorStop(0.0, '#1e3a8a');
            grad.addColorStop(1.0, '#3b82f6');
        } else if (i === 3) {
            grad.addColorStop(0.0, '#0f172a');
            grad.addColorStop(1.0, '#1e293b');
        } else {
            grad.addColorStop(0.0, '#1e3a8a');
            grad.addColorStop(0.55, '#60a5fa');
            grad.addColorStop(0.85, '#93c5fd');
            grad.addColorStop(1.0, '#e2e8f0');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        cubeMap.images[i] = canvas;
    }
    cubeMap.needsUpdate = true;
    return cubeMap;
}

const fallbackSky = buildSkybox();
scene.background = fallbackSky;

// =========================================================================
// 3. TEXTURE LOADERS
// =========================================================================
const textureLoader = new THREE.TextureLoader();

textureLoader.load('textures/sky.jpg', function(tex) {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;
    waterMat.envMap = tex;
    waterMat.needsUpdate = true;
}, undefined, () => {});

let waterNormalTex = null;
textureLoader.load('textures/waternormals.jpg', function(tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8.5, 8.5);
    waterNormalTex = tex;
    waterMat.normalMap = waterNormalTex;
    waterMat.normalScale = new THREE.Vector2(0.05, 0.05);
    waterMat.needsUpdate = true;
}, undefined, () => {});

// =========================================================================
// 4. COMPUTATIONAL WAVE BASIN GEOMETRY
// =========================================================================
const baseDim = 900;
const isMobile = window.innerWidth < 768;
const oceanSegs = isMobile ? 70 : 110;

// Seabed Mesh
const seabedGeom = new THREE.PlaneGeometry(baseDim, baseDim, 16, 16);
seabedGeom.rotateX(-Math.PI / 2);
const seabedMat = new THREE.MeshStandardMaterial({
    color: 0x141210,
    roughness: 0.96,
    metalness: 0.0
});
const seabedMesh = new THREE.Mesh(seabedGeom, seabedMat);
scene.add(seabedMesh);

// Central datum mast
const mastMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 100, 16),
    new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6 })
);
scene.add(mastMesh);

// Water mesh with Dynamic Vertex Colors
const waterGeom = new THREE.PlaneGeometry(baseDim, baseDim, oceanSegs, oceanSegs);
waterGeom.rotateX(-Math.PI / 2);

const vertCount = waterGeom.attributes.position.count;
const vertexColors = new Float32Array(vertCount * 3);
waterGeom.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));

const restX = new Float32Array(vertCount);
const restZ = new Float32Array(vertCount);
for (let i = 0; i < vertCount; i++) {
    restX[i] = waterGeom.attributes.position.getX(i);
    restZ[i] = waterGeom.attributes.position.getZ(i);
}

const waterMat = new THREE.MeshStandardMaterial({
    color: 0x091c2b,
    roughness: 0.12,
    metalness: 0.10,
    envMap: fallbackSky,
    vertexColors: true,
    transparent: true,
    opacity: 0.94,
    side: THREE.DoubleSide
});
const waterMesh = new THREE.Mesh(waterGeom, waterMat);
scene.add(waterMesh);

// =========================================================================
// 5. DIRECTIONAL WAVERIDER BUOY
// =========================================================================
const buoyGroup = new THREE.Group();

const buoyHull = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3, metalness: 0.1 })
);
buoyGroup.add(buoyHull);

const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x0f172a })
);
antenna.position.y = 2.0;
buoyGroup.add(antenna);

const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xef4444 })
);
beacon.position.y = 3.6;
buoyGroup.add(beacon);

scene.add(buoyGroup);

// =========================================================================
// 6. PHYSICAL SPECTRAL SYNTHESIS (Nonlinear Surface Formulation)
// =========================================================================
const NUM_COMPS = 32;
const waveComps = [];

for (let i = 0; i < NUM_COMPS; i++) {
    const fNorm = (i + Math.random()) / NUM_COMPS;
    const freqFactor = 0.5 + fNorm * 1.8;
    const randSpread = (Math.random() - 0.5) * Math.PI;

    waveComps.push({
        freqFactor: freqFactor,
        angSeed: randSpread,
        phase: Math.random() * Math.PI * 2.0
    });
}

function getSpectralWeight(freqFactor, gamma) {
    const sigma = (freqFactor <= 1.0) ? 0.07 : 0.09;
    const peakExp = Math.exp(-Math.pow(freqFactor - 1.0, 2) / (2.0 * sigma * sigma));
    const PM_base = Math.pow(freqFactor, -5.0) * Math.exp(-1.25 * Math.pow(freqFactor, -4.0));
    return PM_base * Math.pow(gamma, peakExp);
}

function updateSeaState(time, Hs, Tp, gamma, spreadingS, headingRad, depth, meshScale) {
    const pos = waterGeom.attributes.position;
    const normals = waterGeom.attributes.normal;
    const colors = waterGeom.attributes.color;

    const omega_p = (2.0 * Math.PI) / Math.max(1.0, Tp);

    let sumWeight = 0.0;
    for (let c = 0; c < NUM_COMPS; c++) {
        sumWeight += getSpectralWeight(waveComps[c].freqFactor, gamma);
    }

    const activeWaves = [];
    for (let c = 0; c < NUM_COMPS; c++) {
        const comp = waveComps[c];
        const omega = omega_p * comp.freqFactor;
        const k = solveWaveNumber(omega, depth);

        let theta = headingRad;
        let dirWeight = 1.0;
        if (spreadingS > 0) {
            theta = headingRad + comp.angSeed / (1.0 + spreadingS * 0.4);
            dirWeight = Math.pow(Math.cos((theta - headingRad) * 0.5), spreadingS * 2);
        }

        const normAmp = Math.sqrt(getSpectralWeight(comp.freqFactor, gamma) / sumWeight) * dirWeight;
        const amp = (Hs * 0.5) * normAmp * 0.72;

        const cosTh = Math.cos(theta);
        const sinTh = Math.sin(theta);
        const kx = k * cosTh;
        const kz = k * sinTh;
        const coth_kd = 1.0 / Math.tanh(Math.min(10.0, k * depth));

        activeWaves.push({
            kx, kz, k, ux: cosTh, uz: sinTh,
            amp, coth_kd, phase: comp.phase - omega * time
        });
    }

    let probeEta = 0.0, probeDx = 0.0, probeDz = 0.0;
    let probeSlopeX = 0.0, probeSlopeZ = 0.0;
    const midIdx = Math.floor(vertCount * 0.5);
    const lambda_c = 1.0;

    for (let i = 0; i < vertCount; i++) {
        const x0 = restX[i] * meshScale;
        const z0 = restZ[i] * meshScale;

        let eta = 0.0, dx = 0.0, dz = 0.0;
        let dxi_dx = 0.0, dxi_dz = 0.0, grad_x = 0.0, grad_z = 0.0;

        for (let c = 0; c < NUM_COMPS; c++) {
            const w = activeWaves[c];
            const p = w.kx * x0 + w.kz * z0 + w.phase;
            const cosP = Math.cos(p);
            const sinP = Math.sin(p);

            eta += w.amp * cosP;
            const dH = -w.amp * sinP * w.coth_kd;
            dx += w.ux * dH;
            dz += w.uz * dH;

            const dH_prime = -w.amp * cosP * w.coth_kd;
            dxi_dx += w.ux * w.kx * dH_prime;
            dxi_dz += w.uz * w.kz * dH_prime;

            const slope = -w.amp * sinP;
            grad_x += slope * w.kx;
            grad_z += slope * w.kz;
        }

        pos.setX(i, restX[i] + (dx * lambda_c) / meshScale);
        pos.setY(i, eta);
        pos.setZ(i, restZ[i] + (dz * lambda_c) / meshScale);

        const Jxx = 1.0 + lambda_c * dxi_dx;
        const Jzz = 1.0 + lambda_c * dxi_dz;
        const jacobian = Jxx * Jzz;

        if (jacobian < 0.25 && eta > 0.3 * Hs) {
            const foamIntensity = Math.min(1.0, (0.25 - jacobian) * 3.5);
            colors.setXYZ(i, 0.09 + 0.91 * foamIntensity, 0.28 + 0.72 * foamIntensity, 0.43 + 0.57 * foamIntensity);
        } else {
            colors.setXYZ(i, 0.05, 0.16, 0.26);
        }

        const nx = -grad_x, nz = -grad_z;
        const invLen = 1.0 / Math.sqrt(nx * nx + 1.0 + nz * nz);
        normals.setXYZ(i, nx * invLen, invLen, nz * invLen);

        if (i === midIdx) {
            probeEta = eta;
            probeDx = dx;
            probeDz = dz;
            probeSlopeX = grad_x;
            probeSlopeZ = grad_z;
        }
    }

    pos.needsUpdate = true;
    normals.needsUpdate = true;
    colors.needsUpdate = true;

    return { probeEta, probeDx, probeDz, probeSlopeX, probeSlopeZ };
}

// =========================================================================
// 7. LIVE PLOTLY MONITOR (3D Tank Surface Probe η(t))
// =========================================================================
const maxPoints = 250;
const timeHist = new Array(maxPoints).fill(0);
const etaHist = new Array(maxPoints).fill(0);
let plotCounter = 0;

function initPlot() {
    const traceEta = {
        x: timeHist,
        y: etaHist,
        name: 'Elevation η(t) [m]',
        line: { color: '#38bdf8', width: 2 }
    };

    const layout = {
        margin: { t: 25, b: 35, l: 45, r: 25 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        showlegend: false,
        xaxis: { title: 'Time (s)', tickfont: { color: '#f8fafc' }, gridcolor: '#334155' },
        yaxis: { title: 'Probe η (m)', tickfont: { color: '#38bdf8' }, gridcolor: '#334155' },
        height: 240
    };

    Plotly.newPlot('plot-container', [traceEta], layout, { responsive: true });
}
initPlot();

// =========================================================================
// 8. SOLAR EPHEMERIS CALCULATOR
// =========================================================================
function updateSolarLighting(latDeg, lonDeg, dateObj) {
    const rad = Math.PI / 180.0;
    const lat = latDeg * rad;

    const startOfYear = new Date(Date.UTC(dateObj.getUTCFullYear(), 0, 1));
    const dayOfYear = Math.floor((dateObj - startOfYear) / 86400000) + 1;

    const delta = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * rad) * rad;
    const B = (360 / 364) * (dayOfYear - 81) * rad;
    const EoT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

    const utcHours = dateObj.getUTCHours() + dateObj.getUTCMinutes() / 60.0;
    const solarTimeHours = (utcHours + lonDeg / 15.0 + EoT / 60.0 + 24.0) % 24.0;
    const hourAngle = (solarTimeHours - 12.0) * 15.0 * rad;

    const sinElevation = Math.sin(lat) * Math.sin(delta) + Math.cos(lat) * Math.cos(delta) * Math.cos(hourAngle);
    const elevation = Math.asin(Math.max(-1.0, Math.min(1.0, sinElevation)));

    const cosAzimuth = (Math.sin(delta) * Math.cos(lat) - Math.cos(delta) * Math.sin(lat) * Math.cos(hourAngle)) / Math.cos(elevation);
    let azimuth = Math.acos(Math.max(-1.0, Math.min(1.0, cosAzimuth)));
    if (Math.sin(hourAngle) > 0) azimuth = 2 * Math.PI - azimuth;

    const elevDeg = elevation / rad;
    const azDeg = azimuth / rad;

    const r = 800.0;
    const sunX = r * Math.sin(azimuth) * Math.cos(Math.max(0.08, elevation));
    const sunY = r * Math.sin(Math.max(0.08, elevation));
    const sunZ = -r * Math.cos(azimuth) * Math.cos(Math.max(0.08, elevation));

    sunLight.position.set(sunX, sunY, sunZ);

    if (elevDeg > 0) {
        sunLight.intensity = 0.8 + 2.4 * Math.sin(elevation);
        sunLight.color.set(elevDeg < 10 ? 0xffaa55 : 0xfff6e5);
        ambientLight.intensity = 0.5 + 0.35 * Math.sin(elevation);
    } else {
        sunLight.intensity = 0.35;
        sunLight.color.set(0x38bdf8);
        ambientLight.intensity = 0.35;
    }

    const sunLabel = document.getElementById('overlay-sun');
    if (sunLabel) {
        sunLabel.innerText = `${azDeg.toFixed(0)}° / ${elevDeg.toFixed(1)}° (${elevDeg > 0 ? 'Day' : 'Night/Moon'})`;
    }
}

// =========================================================================
// 9. ANIMATION LOOP
// =========================================================================
const clock = new THREE.Clock();
let simTime = 0.0;
let isSimulationPaused = false;

function togglePause() {
    isSimulationPaused = !isSimulationPaused;
    document.getElementById('btn-pause').innerText = isSimulationPaused ? '▶ Run' : '⏸ Pause';
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    let dt = clock.getDelta();
    if (dt > 0.1) dt = 0.02;

    const Hs = parseFloat(document.getElementById('slider-hs').value);
    const Tp = parseFloat(document.getElementById('slider-tp').value);
    const gamma = parseFloat(document.getElementById('slider-gamma').value);
    const headingDeg = parseFloat(document.getElementById('slider-heading').value);
    const spreadingS = parseInt(document.getElementById('slider-spread').value);
    const depth = parseFloat(document.getElementById('slider-depth').value);
    const maxDepth = parseFloat(document.getElementById('slider-depth').max) || 400;

    const headingRad = (headingDeg * Math.PI) / 180.0;

    const omega_p = (2.0 * Math.PI) / Tp;
    const kp = solveWaveNumber(omega_p, depth);
    const lambda_p = (2.0 * Math.PI) / kp;
    const cp = lambda_p / Tp;

    const steepnessEng = Hs / lambda_p;
    const steepnessKa = 0.5 * kp * Hs;

    const targetDim = Math.min(1100, Math.max(340, lambda_p * 6.0));
    const meshScale = targetDim / baseDim;

    waterMesh.scale.set(meshScale, 1.0, meshScale);
    seabedMesh.scale.set(meshScale, 1.0, meshScale);

    // Deep water regime: hide visual floor when at the deep ocean threshold
    const showSeabed = depth < maxDepth;
    seabedMesh.visible = showSeabed;
    mastMesh.visible = showSeabed;

    if (showSeabed) {
        seabedMesh.position.y = -depth;
        mastMesh.position.set(0, -depth / 2, 0);
        mastMesh.scale.set(1.0, depth / 100.0, 1.0);
    }

    if (!isSimulationPaused) {
        simTime += dt;

        if (waterNormalTex) {
            const advectSpeed = 0.003;
            waterNormalTex.offset.x = (simTime * advectSpeed * Math.cos(headingRad)) % 1.0;
            waterNormalTex.offset.y = (simTime * advectSpeed * Math.sin(headingRad)) % 1.0;
        }

        const res = updateSeaState(simTime, Hs, Tp, gamma, spreadingS, headingRad, depth, meshScale);

        buoyGroup.position.set(res.probeDx, res.probeEta + 0.3, res.probeDz);
        buoyGroup.rotation.z = -Math.atan(res.probeSlopeX);
        buoyGroup.rotation.x = Math.atan(res.probeSlopeZ);

        document.getElementById('dash-lambda').innerText = lambda_p.toFixed(1) + ' m';
        document.getElementById('dash-cp').innerText = cp.toFixed(1) + ' m/s';
        document.getElementById('dash-eta').innerText = (res.probeEta >= 0 ? '+' : '') + res.probeEta.toFixed(2) + ' m';
        document.getElementById('dash-steep').innerText = `${steepnessEng.toFixed(3)} (ka=${steepnessKa.toFixed(2)})`;

        const kd = kp * depth;
        let regimeStr = "Deep Water (d > λ/2)";
        if (kd < Math.PI / 10.0) regimeStr = "Shallow Water (d < λ/20)";
        else if (kd < Math.PI) regimeStr = "Intermediate Depth";
        document.getElementById('overlay-regime').innerText = regimeStr;

        plotCounter++;
        if (plotCounter % 6 === 0) {
            timeHist.shift();
            etaHist.shift();
            timeHist.push(simTime.toFixed(1));
            etaHist.push(res.probeEta);
            Plotly.update('plot-container', { x: [timeHist], y: [etaHist] });
        }
    }

    renderer.render(scene, camera);
}
animate();

// =========================================================================
// 10. UI UPDATERS
// =========================================================================
function updateUI() {
    const Hs = document.getElementById('slider-hs').value;
    const Tp = document.getElementById('slider-tp').value;
    const gamma = parseFloat(document.getElementById('slider-gamma').value);
    const heading = document.getElementById('slider-heading').value;
    const sVal = parseInt(document.getElementById('slider-spread').value);
    const depthVal = parseFloat(document.getElementById('slider-depth').value);
    const maxDepth = parseFloat(document.getElementById('slider-depth').max) || 400;

    document.getElementById('val-hs').innerText = Hs + ' m';
    document.getElementById('val-tp').innerText = Tp + ' s';
    document.getElementById('val-gamma').innerText = (gamma === 1.0) ? 'γ = 1.0 (PM)' : 'γ = ' + gamma.toFixed(1);
    document.getElementById('val-heading').innerText = heading + '°';
    document.getElementById('val-spread').innerText = (sVal === 0) ? 's = 0 (Uni)' : 's = ' + sVal;

    if (depthVal >= maxDepth) {
        document.getElementById('val-depth').innerText = `${maxDepth} m (Deep Water ∞)`;
    } else {
        document.getElementById('val-depth').innerText = depthVal.toFixed(0) + ' m';
    }
}

[
    'slider-hs', 'slider-tp', 'slider-gamma', 'slider-heading',
    'slider-spread', 'slider-depth'
].forEach(id => {
    document.getElementById(id).addEventListener('input', updateUI);
});

window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    Plotly.Plots.resize('plot-container');
});

// =========================================================================
// 11. MAP PICKER, NOAA BATHYMETRY & TIMELINE SPARKLINE MODULE
// =========================================================================
let map = null;
let pinMarker = null;
let currentPinLat = 56.0, currentPinLon = -20.0;
let cachedTimeSeries = null;

function initMap() {
    const mapEl = document.getElementById('leaflet-map');
    if (!mapEl) return;

    if (map) {
        map.invalidateSize();
        return;
    }

    map = L.map('leaflet-map', {
        center: [currentPinLat, currentPinLon],
        zoom: 2,
        minZoom: 1,
        maxZoom: 11,
        worldCopyJump: true
    });

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri, GEBCO, NOAA',
        maxZoom: 13
    }).addTo(map);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 13
    }).addTo(map);

    pinMarker = L.marker([currentPinLat, currentPinLon]).addTo(map);

    map.on('click', (e) => {
        currentPinLat = e.latlng.lat;
        currentPinLon = e.latlng.lng;
        pinMarker.setLatLng(e.latlng);
        fetchMetoceanData(currentPinLat, currentPinLon);
    });
}

// Authoritative NOAA NCEI Global Bathymetry Identify Query (EPSG:4326)
async function fetchOceanDepth(lat, lon) {
    const x = parseFloat(lon.toFixed(4));
    const y = parseFloat(lat.toFixed(4));

    // 1. Primary: NOAA DEM Global Mosaic
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        const url = `https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer/identify?geometry=${x},${y}&geometryType=esriGeometryPoint&spatialReference=%7B%22wkid%22%3A4326%7D&returnGeometry=false&f=json`;

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (data && data.value !== undefined && data.value !== "" && data.value !== "NoData") {
                const elev = parseFloat(data.value);
                if (!isNaN(elev)) {
                    if (elev < 0) return Math.abs(elev); // Depth beneath sea surface
                    if (elev === 0) return 20.0;        // Intertidal
                    return 12.0;                        // Shallow edge
                }
            }
        }
    } catch (err) {
        console.warn("NOAA DEM_global_mosaic lookup failed, trying ETOPO1...", err);
    }

    // 2. Secondary: NOAA ETOPO1 Bedrock Mosaic fallback
    try {
        const controller2 = new AbortController();
        const timeoutId2 = setTimeout(() => controller2.abort(), 4000);

        const url2 = `https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/ETOPO1_bedrock/ImageServer/identify?geometry=${x},${y}&geometryType=esriGeometryPoint&spatialReference=%7B%22wkid%22%3A4326%7D&returnGeometry=false&f=json`;

        const res2 = await fetch(url2, { signal: controller2.signal });
        clearTimeout(timeoutId2);

        if (res2.ok) {
            const data2 = await res2.json();
            if (data2 && data2.value !== undefined && data2.value !== "" && data2.value !== "NoData") {
                const elev2 = parseFloat(data2.value);
                if (!isNaN(elev2)) {
                    if (elev2 < 0) return Math.abs(elev2);
                    if (elev2 === 0) return 20.0;
                    return 12.0;
                }
            }
        }
    } catch (err2) {
        console.warn("NOAA ETOPO1 fallback unavailable:", err2);
    }

    // 3. Last-resort default
    return 75.0;
}

// Render the 168-hour Significant Wave Height (Hs) series (Fixed-range, No-Zoom)
function renderPickerSparkline(timeArr, hsArr, activeIdx) {
    const placeholder = document.getElementById('picker-plot-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    const plotEl = document.getElementById('picker-plot');
    if (!plotEl) return;

    const cleanTimes = timeArr.map(t => t.replace('T', ' ').slice(5));

    const traceHs = {
        x: cleanTimes,
        y: hsArr,
        type: 'scatter',
        mode: 'lines',
        name: 'Hs (m)',
        line: { color: '#38bdf8', width: 2 },
        fill: 'tozeroy',
        fillcolor: 'rgba(56, 189, 248, 0.15)',
        hoverinfo: 'x+y'
    };

    const validHs = hsArr.filter(v => v !== null && !isNaN(v));
    const maxVal = validHs.length > 0 ? Math.max(...validHs) : 4.0;
    const yCap = Math.max(2.0, maxVal * 1.15);

    const cursorLine = {
        type: 'line',
        x0: cleanTimes[activeIdx],
        x1: cleanTimes[activeIdx],
        y0: 0,
        y1: yCap,
        line: { color: '#f59e0b', width: 2, dash: 'dot' }
    };

    const layout = {
        margin: { t: 6, b: 20, l: 34, r: 12 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        showlegend: false,
        shapes: [cursorLine],
        dragmode: false, // Prevents box-selection & click-drag zooming
        xaxis: {
            showgrid: true,
            gridcolor: '#1e293b',
            tickfont: { color: '#64748b', size: 9 },
            nticks: 7,
            fixedrange: true // Locks X-axis against zoom/pan
        },
        yaxis: {
            title: { text: 'Hs (m)', font: { size: 9, color: '#38bdf8' } },
            showgrid: true,
            gridcolor: '#1e293b',
            tickfont: { color: '#94a3b8', size: 9 },
            range: [0, yCap],
            fixedrange: true // Locks Y-axis against zoom/pan
        }
    };

    const config = {
        displayModeBar: false,
        responsive: true,
        scrollZoom: false,
        doubleClick: false // Prevents double-click reset/zoom
    };

    Plotly.react(plotEl, [traceHs], layout, config).then(() => {
        Plotly.Plots.resize(plotEl);
    });

    plotEl.removeAllListeners && plotEl.removeAllListeners('plotly_click');
    plotEl.on('plotly_click', (data) => {
        if (data.points && data.points.length > 0) {
            const ptIdx = data.points[0].pointIndex;
            document.getElementById('time-slider').value = ptIdx;
            previewTimeIndex(ptIdx);
        }
    });
}

function updatePickerCursor(activeIdx) {
    if (!cachedTimeSeries) return;
    const cleanTime = cachedTimeSeries.time[activeIdx].replace('T', ' ').slice(5);
    const validHs = cachedTimeSeries.hs.filter(v => v !== null && !isNaN(v));
    const maxVal = validHs.length > 0 ? Math.max(...validHs) : 4.0;
    const yCap = Math.max(2.0, maxVal * 1.15);

    Plotly.relayout('picker-plot', {
        'shapes[0].x0': cleanTime,
        'shapes[0].x1': cleanTime,
        'shapes[0].y1': yCap
    }).catch(() => {});
}

async function fetchMetoceanData(lat, lon) {
    const latStr = Math.abs(lat).toFixed(1) + (lat >= 0 ? '° N' : '° S');
    const lonStr = Math.abs(lon).toFixed(1) + (lon >= 0 ? '° E' : '° W');
    document.getElementById('modal-status').innerText = `Querying Copernicus & NOAA Bathymetry for [${latStr}, ${lonStr}]...`;
    document.getElementById('btn-apply-conditions').disabled = true;
    const timeSlider = document.getElementById('time-slider');
    timeSlider.disabled = true;

    try {
        const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&hourly=wave_height,wave_direction,wave_period&past_days=2&forecast_days=5`;
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&hourly=wind_speed_10m&past_days=2&forecast_days=5`;

        const [marineRes, weatherRes, realDepth] = await Promise.all([
            fetch(marineUrl),
            fetch(weatherUrl),
            fetchOceanDepth(lat, lon)
        ]);

        const mData = await marineRes.json();
        const wData = await weatherRes.json();

        if (!mData.hourly || !mData.hourly.wave_height || mData.hourly.wave_height[48] === null) {
            throw new Error("Selected point is on land or outside active wave grid.");
        }

        cachedTimeSeries = {
            lat: lat,
            lon: lon,
            depth: realDepth,
            time: mData.hourly.time,
            hs: mData.hourly.wave_height,
            tp: mData.hourly.wave_period,
            dir: mData.hourly.wave_direction,
            wind: wData.hourly.wind_speed_10m
        };

        timeSlider.max = cachedTimeSeries.time.length - 1;
        timeSlider.value = 48; // Current hour
        timeSlider.disabled = false;
        document.getElementById('btn-apply-conditions').disabled = false;

        renderPickerSparkline(cachedTimeSeries.time, cachedTimeSeries.hs, 48);
        previewTimeIndex(48);

        document.getElementById('modal-status').innerText = `Loaded 168h series. Seafloor Depth: ${realDepth >= 1000 ? (realDepth / 1000).toFixed(1) + ' km' : realDepth.toFixed(0) + ' m'}.`;

    } catch (err) {
        document.getElementById('modal-status').innerText = `Notice: ${err.message}`;
    }
}

function previewTimeIndex(idx) {
    if (!cachedTimeSeries) return;
    const rawTime = cachedTimeSeries.time[idx];
    const h = cachedTimeSeries.hs[idx] !== null ? cachedTimeSeries.hs[idx] : 1.2;
    const wind = (cachedTimeSeries.wind[idx] || 25.0) / 3.6;

    document.getElementById('active-time-label').innerText =
        `${rawTime.replace('T', ' ')} UTC (Hs: ${h}m, Wind: ${wind.toFixed(1)} m/s)`;

    updatePickerCursor(idx);
}

document.getElementById('time-slider').addEventListener('input', (e) => {
    previewTimeIndex(parseInt(e.target.value));
});

document.getElementById('btn-apply-conditions').addEventListener('click', () => {
    if (!cachedTimeSeries) return;
    const idx = parseInt(document.getElementById('time-slider').value);

    const curH = cachedTimeSeries.hs[idx] !== null ? cachedTimeSeries.hs[idx] : 1.5;
    const curTp = cachedTimeSeries.tp[idx] !== null ? cachedTimeSeries.tp[idx] : 7.0;
    const curDir = cachedTimeSeries.dir[idx] !== null ? cachedTimeSeries.dir[idx] : 240;
    const curWind = (cachedTimeSeries.wind[idx] || 25.0) / 3.6;
    const realDepth = cachedTimeSeries.depth;
    const dateObj = new Date(cachedTimeSeries.time[idx] + ":00Z");

    const Cp = (g * curTp) / (2.0 * Math.PI);
    const waveAge = Cp / Math.max(1.0, curWind);

    let calcGamma = 3.3;
    let calcSpread = 4;

    if (waveAge < 0.85) {
        calcGamma = Math.min(5.0, 3.3 * Math.pow(waveAge, -0.75));
        calcSpread = Math.max(2, Math.min(6, Math.round(11.5 * Math.pow(waveAge, 2.5))));
    } else if (waveAge > 1.25) {
        calcGamma = 1.0;
        calcSpread = Math.min(22, Math.round(11.5 * Math.pow(waveAge, 2.5)));
    }

    const maxSliderDepth = parseFloat(document.getElementById('slider-depth').max) || 400;
    const isPelagic = realDepth >= maxSliderDepth;
    const visualDepth = isPelagic ? maxSliderDepth : Math.max(8, realDepth);

    document.getElementById('slider-hs').value = Math.min(14.0, Math.max(0.5, curH)).toFixed(1);
    document.getElementById('slider-tp').value = Math.min(22.0, Math.max(4.0, curTp)).toFixed(1);
    document.getElementById('slider-gamma').value = calcGamma.toFixed(1);
    document.getElementById('slider-heading').value = ((curDir > 180 ? curDir - 360 : curDir)).toFixed(0);
    document.getElementById('slider-spread').value = calcSpread;
    document.getElementById('slider-depth').value = visualDepth.toFixed(0);

    updateUI();

    if (isPelagic) {
        const depthStr = realDepth >= 1000 ? `${(realDepth / 1000).toFixed(1)} km` : `${realDepth.toFixed(0)} m`;
        document.getElementById('val-depth').innerText = `${depthStr} (Deep Water ∞)`;
    } else {
        document.getElementById('val-depth').innerText = `${realDepth.toFixed(0)} m`;
    }

    updateSolarLighting(cachedTimeSeries.lat, cachedTimeSeries.lon, dateObj);
    document.getElementById('map-modal').style.display = 'none';
});

// Modal Event Listeners
document.getElementById('btn-open-map').addEventListener('click', () => {
    const modal = document.getElementById('map-modal');
    modal.style.display = 'flex';

    setTimeout(() => {
        initMap();
        if (map) {
            map.invalidateSize();
            map.setView([currentPinLat, currentPinLon], map.getZoom());
        }
        if (cachedTimeSeries) {
            Plotly.Plots.resize('picker-plot');
        }
    }, 60);
});

document.getElementById('btn-close-modal').addEventListener('click', () => {
    document.getElementById('map-modal').style.display = 'none';
});
