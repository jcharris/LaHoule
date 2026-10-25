// =========================================================================
// 1. PHYSICAL CONSTANTS & DISPERSION SOLVER
// =========================================================================
const g = 9.81;

// Exact Finite-Depth Dispersion Relation: w^2 = g*k*tanh(k*d)
// Solved via Newton-Raphson iteration
function solveWaveNumber(omega, depth) {
    const w2 = omega * omega;
    // Initial guess using Eckart's explicit approximation
    let k = w2 / (g * Math.sqrt(Math.tanh(w2 * depth / g)));
    for (let iter = 0; iter < 6; iter++) {
        const th = Math.tanh(k * depth);
        const f = g * k * th - w2;
        const df = g * th + g * k * depth * (1.0 - th * th);
        const step = f / df;
        k -= step;
        if (Math.abs(step) < 1e-5) break;
    }
    return Math.max(1e-4, k);
}

// =========================================================================
// 2. THREE.JS SCENE, ATMOSPHERIC SKYBOX & SEABED
// =========================================================================
const container = document.getElementById('canvas3d');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.5, 4000);
camera.position.set(160, 45, 180);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI * 0.495; // Prevent camera sinking under the ocean mesh

// Sun Disc & Sky Fill
const sunLight = new THREE.DirectionalLight(0xfffbeb, 3.0);
sunLight.position.set(-600, 350, 400);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x7dd3fc, 0.7));

// Skybox Generation
function buildAtmosphericSky() {
    const cubeMap = new THREE.CubeTexture([]);
    const size = 512;
    for (let i = 0; i < 6; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createLinearGradient(0, 0, 0, size);
        if (i === 2) { // Zenith (Top)
            grad.addColorStop(0.0, '#0284c7');
            grad.addColorStop(1.0, '#38bdf8');
        } else if (i === 3) { // Nadir (Bottom)
            grad.addColorStop(0.0, '#082f49');
            grad.addColorStop(1.0, '#0369a1');
        } else { // Sides / Horizon
            grad.addColorStop(0.0, '#0284c7');
            grad.addColorStop(0.65, '#7dd3fc');
            grad.addColorStop(0.85, '#bae6fd');
            grad.addColorStop(1.0, '#f8fafc');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        // Sun disc on face 0
        if (i === 0) {
            const radGrad = ctx.createRadialGradient(256, 180, 8, 256, 180, 140);
            radGrad.addColorStop(0, '#ffffff');
            radGrad.addColorStop(0.25, '#fef08a');
            radGrad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = radGrad;
            ctx.beginPath();
            ctx.arc(256, 180, 140, 0, Math.PI * 2);
            ctx.fill();
        }
        cubeMap.images[i] = canvas;
    }
    cubeMap.needsUpdate = true;
    return cubeMap;
}
const envSkyMap = buildAtmosphericSky();
scene.background = envSkyMap;

// Underwater Sand Bathymetry Floor
const seabedGeom = new THREE.PlaneGeometry(1200, 1200, 20, 20);
seabedGeom.rotateX(-Math.PI / 2);
const seabedMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.95,
    metalness: 0.05
});
const seabedMesh = new THREE.Mesh(seabedGeom, seabedMat);
scene.add(seabedMesh);

// Depth Measurement Mooring Mast (Center Datum)
const mastMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 100, 16),
    new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6 })
);
scene.add(mastMesh);

// =========================================================================
// 3. DIRECTIONAL WAVERIDER BUOY (VIRTUAL WAVE PROBE)
// =========================================================================
const buoyGroup = new THREE.Group();

// Spherical Body (Yellow Hull)
const buoyHull = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35, metalness: 0.2 })
);
buoyGroup.add(buoyHull);

// Antenna / Sensor Mast
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
// 4. HIGH-RESOLUTION SPECTRAL OCEAN SURFACE (100x100 Grid)
// =========================================================================
const oceanDim = 600;
const oceanSegs = 100;
const waterGeom = new THREE.PlaneGeometry(oceanDim, oceanDim, oceanSegs, oceanSegs);
waterGeom.rotateX(-Math.PI / 2);

const waterMat = new THREE.MeshStandardMaterial({
    color: 0x0369a1,
    roughness: 0.22,       // Micro-facet scattering prevents harsh mirror gloss
    metalness: 0.75,       // Deep water dielectric sheen
    envMap: envSkyMap,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide
});
const waterMesh = new THREE.Mesh(waterGeom, waterMat);
scene.add(waterMesh);

// =========================================================================
// 5. 48-COMPONENT JONSWAP / PM DIRECTIONAL WAVE FIELD
// =========================================================================
const NUM_COMPS = 48;
const waveComps = [];

for (let i = 0; i < NUM_COMPS; i++) {
    // Non-repeating Monte Carlo frequency partition
    const fNorm = (i + Math.random()) / NUM_COMPS;
    const freqFactor = 0.45 + fNorm * 1.85; // Covers 0.45*fp to 2.3*fp

    waveComps.push({
        freqFactor: freqFactor,
        angSeed: (Math.random() - 0.5) * Math.PI,
        phase: Math.random() * Math.PI * 2.0
    });
}

// Compute JONSWAP Spectral Weights
function getSpectralWeight(freqFactor, gamma) {
    const sigma = (freqFactor <= 1.0) ? 0.07 : 0.09;
    const peakExp = Math.exp(-Math.pow(freqFactor - 1.0, 2) / (2.0 * sigma * sigma));
    const PM_base = Math.pow(freqFactor, -5.0) * Math.exp(-1.25 * Math.pow(freqFactor, -4.0));
    return PM_base * Math.pow(gamma, peakExp);
}

// Surface Update with Finite-Depth Wave Numbers & Analytic Normals
function updateSeaState(time, Hs, Tp, gamma, spreadingS, headingRad, depth) {
    const pos = waterGeom.attributes.position;
    const normals = waterGeom.attributes.normal;
    const omega_p = (2.0 * Math.PI) / Math.max(1.0, Tp);

    let probeEta = 0.0;
    let probeSlopeX = 0.0;
    let probeSlopeZ = 0.0;

    // Precalculate wave numbers & amplitudes for all components
    const activeWaves = [];
    let sumWeight = 0.0;
    for (let c = 0; c < NUM_COMPS; c++) {
        const w = getSpectralWeight(waveComps[c].freqFactor, gamma);
        sumWeight += w;
    }

    for (let c = 0; c < NUM_COMPS; c++) {
        const comp = waveComps[c];
        const omega = omega_p * comp.freqFactor;
        const k = solveWaveNumber(omega, depth);

        // Directional spreading: s = 0 -> purely long-crested
        let theta = headingRad;
        let dirWeight = 1.0;
        if (spreadingS > 0) {
            theta = headingRad + comp.angSeed / (1.0 + spreadingS * 0.4);
            dirWeight = Math.pow(Math.cos((theta - headingRad) * 0.5), spreadingS * 2);
        }

        const normAmp = Math.sqrt(getSpectralWeight(comp.freqFactor, gamma) / sumWeight) * dirWeight;
        const amp = (Hs / 2.0) * normAmp * 0.72;

        activeWaves.push({
            omega: omega,
            k: k,
            kx: k * Math.cos(theta),
            kz: k * Math.sin(theta),
            amp: amp,
            phase: comp.phase
        });
    }

    // Evaluate surface vertices and analytic normals
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);

        let eta = 0.0;
        let grad_x = 0.0;
        let grad_z = 0.0;

        for (let c = 0; c < NUM_COMPS; c++) {
            const w = activeWaves[c];
            const p = w.kx * x + w.kz * z - w.omega * time + w.phase;

            eta += w.amp * Math.cos(p);
            const slope = w.amp * -Math.sin(p);
            grad_x += slope * w.kx;
            grad_z += slope * w.kz;
        }

        // Capillary slope perturbation for realistic light scattering
        const microJitterX = Math.sin(x * 0.45 + time * 2.2) * Math.cos(z * 0.35) * 0.035;
        const microJitterZ = Math.cos(x * 0.35 - time * 1.8) * Math.sin(z * 0.45) * 0.035;

        pos.setY(i, eta);

        const nx = -(grad_x + microJitterX);
        const nz = -(grad_z + microJitterZ);
        const invLen = 1.0 / Math.sqrt(nx * nx + 1.0 + nz * nz);
        normals.setXYZ(i, nx * invLen, invLen, nz * invLen);

        // Probe elevation at center (0, 0)
        if (i === Math.floor(pos.count / 2)) {
            probeEta = eta;
            probeSlopeX = grad_x;
            probeSlopeZ = grad_z;
        }
    }

    pos.needsUpdate = true;
    normals.needsUpdate = true;

    return { probeEta, probeSlopeX, probeSlopeZ };
}

// =========================================================================
// 6. LIVE PLOTLY TIME-SERIES MONITOR
// =========================================================================
const timeHist = [];
const etaHist = [];

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
// 7. MAIN ANIMATION & RENDERING LOOP
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
    if (dt > 0.1) dt = 0.02; // Background-tab desync protection

    const Hs = parseFloat(document.getElementById('slider-hs').value);
    const Tp = parseFloat(document.getElementById('slider-tp').value);
    const gamma = parseFloat(document.getElementById('slider-gamma').value);
    const headingDeg = parseFloat(document.getElementById('slider-heading').value);
    const spreadingS = parseInt(document.getElementById('slider-spread').value);
    const depth = parseFloat(document.getElementById('slider-depth').value);

    const headingRad = (headingDeg * Math.PI) / 180.0;

    // Update Bathymetric Floor & Datum Mast
    seabedMesh.position.y = -depth;
    mastMesh.position.set(0, -depth / 2, 0);
    mastMesh.scale.set(1.0, depth / 100.0, 1.0);

    if (!isSimulationPaused) {
        simTime += dt;

        const res = updateSeaState(simTime, Hs, Tp, gamma, spreadingS, headingRad, depth);

        // Update Buoy Motion (Conformal ride on water surface + tilt from wave slopes)
        buoyGroup.position.set(0, res.probeEta + 0.3, 0);
        buoyGroup.rotation.z = -Math.atan(res.probeSlopeX);
        buoyGroup.rotation.x = Math.atan(res.probeSlopeZ);

        // Calculate Physics Metrics
        const omega_p = (2.0 * Math.PI) / Tp;
        const kp = solveWaveNumber(omega_p, depth);
        const lambda_p = (2.0 * Math.PI) / kp;
        const cp = lambda_p / Tp;
        const steepness = Hs / lambda_p;

        document.getElementById('dash-lambda').innerText = lambda_p.toFixed(1) + ' m';
        document.getElementById('dash-cp').innerText = cp.toFixed(1) + ' m/s';
        document.getElementById('dash-eta').innerText = (res.probeEta >= 0 ? '+' : '') + res.probeEta.toFixed(2) + ' m';
        document.getElementById('dash-steep').innerText = steepness.toFixed(3);

        const kd = kp * depth;
        let regimeStr = "Deep Water (d > λ/2)";
        if (kd < Math.PI / 10.0) regimeStr = "Shallow Water (d < λ/20)";
        else if (kd < Math.PI) regimeStr = "Intermediate Depth";
        document.getElementById('overlay-regime').innerText = regimeStr;

        // Plotly rolling time-series
        if (timeHist.length > 500) {
            timeHist.shift();
            etaHist.shift();
        }
        timeHist.push(simTime.toFixed(1));
        etaHist.push(res.probeEta);
        Plotly.update('plot-container', { x: [timeHist], y: [etaHist] });
    }

    renderer.render(scene, camera);
}
animate();

// =========================================================================
// 8. UI SLIDER LISTENERS
// =========================================================================
function updateUI() {
    const Hs = document.getElementById('slider-hs').value;
    const Tp = document.getElementById('slider-tp').value;
    const gamma = parseFloat(document.getElementById('slider-gamma').value);
    const heading = document.getElementById('slider-heading').value;
    const sVal = parseInt(document.getElementById('slider-spread').value);
    const depth = document.getElementById('slider-depth').value;

    document.getElementById('val-hs').innerText = Hs + ' m';
    document.getElementById('val-tp').innerText = Tp + ' s';
    document.getElementById('val-gamma').innerText = (gamma === 1.0) ? 'γ = 1.0 (Pierson-Moskowitz)' : 'γ = ' + gamma.toFixed(1);
    document.getElementById('val-heading').innerText = heading + '°';
    document.getElementById('val-spread').innerText = (sVal === 0) ? 's = 0 (Unidirectional)' : 's = ' + sVal;
    document.getElementById('val-depth').innerText = depth + ' m';
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
