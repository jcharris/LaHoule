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

// Maritime Directional Sunlight + Ambient Fill
const sunLight = new THREE.DirectionalLight(0xfff6e5, 3.0);
sunLight.position.set(-600, 350, 450);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x64748b, 0.75));

// Fallback Procedural Skybox
function buildSkybox() {
    const cubeMap = new THREE.CubeTexture([]);
    const size = 512;
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
});

let waterNormalTex = null;
textureLoader.load('textures/waternormals.jpg', function(tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8.5, 8.5);
    waterNormalTex = tex;
    waterMat.normalMap = waterNormalTex;
    waterMat.normalScale = new THREE.Vector2(0.05, 0.05);
    waterMat.needsUpdate = true;
});

// =========================================================================
// 4. COMPUTATIONAL WAVE BASIN GEOMETRY
// =========================================================================
const baseDim = 900;
const oceanSegs = 120; // 14,641 vertices for high-fidelity Creamer crest resolution

// Seabed mesh
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

// Water mesh with Dynamic Vertex Colors for Breaking Crest Foam
const waterGeom = new THREE.PlaneGeometry(baseDim, baseDim, oceanSegs, oceanSegs);
waterGeom.rotateX(-Math.PI / 2);

const vertCount = waterGeom.attributes.position.count;
const vertexColors = new Float32Array(vertCount * 3);
waterGeom.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));

// Cache resting reference coordinates (x0, z0) for Lagrangian mapping
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
// 6. PHYSICAL SPECTRAL SYNTHESIS (Creamer Nonlinear Formulation)
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

        // Finite-depth kinematic elongation factor: coth(kd)
        const coth_kd = 1.0 / Math.tanh(Math.min(10.0, k * depth));

        activeWaves.push({
            kx: kx,
            kz: kz,
            k: k,
            // Directional unit vectors for horizontal Hilbert transform
            ux: cosTh,
            uz: sinTh,
            amp: amp,
            coth_kd: coth_kd,
            phase: comp.phase - omega * time
        });
    }

    let probeEta = 0.0;
    let probeDx = 0.0;
    let probeDz = 0.0;
    let probeSlopeX = 0.0;
    let probeSlopeZ = 0.0;

    const midIdx = Math.floor(vertCount * 0.5);

    // Creamer parameter (choppiness factor, 0 = pure linear, 1.0 = full Creamer)
    const lambda_c = 1.0;

    for (let i = 0; i < vertCount; i++) {
        const x0 = restX[i] * meshScale;
        const z0 = restZ[i] * meshScale;

        let eta = 0.0;
        let dx = 0.0;
        let dz = 0.0;
        let dxi_dx = 0.0;
        let dxi_dz = 0.0;
        let grad_x = 0.0;
        let grad_z = 0.0;

        for (let c = 0; c < NUM_COMPS; c++) {
            const w = activeWaves[c];
            const p = w.kx * x0 + w.kz * z0 + w.phase;
            const cosP = Math.cos(p);
            const sinP = Math.sin(p);

            // Vertical Elevation (Real Fourier component)
            eta += w.amp * cosP;

            // Horizontal Lagrangian shift (Hilbert Transform: -sin(p))
            const dH = -w.amp * sinP * w.coth_kd;
            dx += w.ux * dH;
            dz += w.uz * dH;

            // Jacobian Spatial Derivatives
            const dH_prime = -w.amp * cosP * w.coth_kd;
            dxi_dx += w.ux * w.kx * dH_prime;
            dxi_dz += w.uz * w.kz * dH_prime;

            // Linear Slope Tensor
            const slope = -w.amp * sinP;
            grad_x += slope * w.kx;
            grad_z += slope * w.kz;
        }

        // Horizontal coordinate update (Pulls mesh vertices toward crests)
        const finalX = restX[i] + (dx * lambda_c) / meshScale;
        const finalZ = restZ[i] + (dz * lambda_c) / meshScale;

        pos.setX(i, finalX);
        pos.setY(i, eta);
        pos.setZ(i, finalZ);

        // Creamer Jacobian: J = (1 + lambda * dxi_dx) * (1 + lambda * dxi_dz)
        // J <= 0 represents wave overturning / crossing particle paths (breaking whitecaps)
        const Jxx = 1.0 + lambda_c * dxi_dx;
        const Jzz = 1.0 + lambda_c * dxi_dz;
        const jacobian = Jxx * Jzz;

        // Dynamic Crest Whitecap Painting
        if (jacobian < 0.25 && eta > 0.3 * Hs) {
            // Whitecap foam on breaking crests
            const foamIntensity = Math.min(1.0, (0.25 - jacobian) * 3.5);
            colors.setXYZ(i, 0.09 + 0.91 * foamIntensity, 0.28 + 0.72 * foamIntensity, 0.43 + 0.57 * foamIntensity);
        } else {
            // Deep North Atlantic slate navy
            colors.setXYZ(i, 0.05, 0.16, 0.26);
        }

        // Normals with Jacobian steepening
        const nx = -grad_x;
        const nz = -grad_z;
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
// 7. LIVE PLOTLY MONITOR (Throttled to 10 Hz)
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
// 8. REAL-TIME 60 FPS ANIMATION LOOP
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

    const headingRad = (headingDeg * Math.PI) / 180.0;

    // Physical metrics
    const omega_p = (2.0 * Math.PI) / Tp;
    const kp = solveWaveNumber(omega_p, depth);
    const lambda_p = (2.0 * Math.PI) / kp;
    const cp = lambda_p / Tp;

    // Engineering steepness & dynamic ka
    const steepnessEng = Hs / lambda_p;
    const steepnessKa = 0.5 * kp * Hs;

    // Dynamic wave tank scaling: maintain ~15-20 vertices per peak wavelength
    const targetDim = Math.min(1100, Math.max(340, lambda_p * 6.0));
    const meshScale = targetDim / baseDim;

    waterMesh.scale.set(meshScale, 1.0, meshScale);
    seabedMesh.scale.set(meshScale, 1.0, meshScale);

    seabedMesh.position.y = -depth;
    mastMesh.position.set(0, -depth / 2, 0);
    mastMesh.scale.set(1.0, depth / 100.0, 1.0);

    if (!isSimulationPaused) {
        simTime += dt;

        // Capillary ripple advection along sea heading
        if (waterNormalTex) {
            const advectSpeed = 0.003;
            waterNormalTex.offset.x = (simTime * advectSpeed * Math.cos(headingRad)) % 1.0;
            waterNormalTex.offset.y = (simTime * advectSpeed * Math.sin(headingRad)) % 1.0;
        }

        const res = updateSeaState(simTime, Hs, Tp, gamma, spreadingS, headingRad, depth, meshScale);

        // Waverider Buoy follows full 3D Lagrangian closed orbital path
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
// 9. CLEAN UI EVENT LISTENERS
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
    document.getElementById('val-gamma').innerText = (gamma === 1.0) ? 'γ = 1.0 (PM)' : 'γ = ' + gamma.toFixed(1);
    document.getElementById('val-heading').innerText = heading + '°';
    document.getElementById('val-spread').innerText = (sVal === 0) ? 's = 0 (Uni)' : 's = ' + sVal;
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
