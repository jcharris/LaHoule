// =========================================================================
// 1. BENCHMARK PHYSICAL PARAMETERS (NREL 5MW / OC3-HYWIND SPAR)
// =========================================================================
const R_rotor = 63.0;            // Rotor Radius (m)
const H_hub = 90.0;              // Hub Height (m)
const Draft_spar = 120.0;        // Spar Draft (m)
const Mass_spar = 7.466e6;       // Spar Structure + Ballast (kg)
const Mass_rna = 3.5e5;          // Rotor-Nacelle Assembly Mass (kg)
const Mass_total = Mass_spar + Mass_rna;
const I_pitch = 1.92e10;         // Total Pitch Inertia around CM (kg*m^2)

// Tower 1st Fore-Aft Elastic Bending
const K_tower = 1.85e6;          // Equivalent Stiffness (N/m)
const M_tower_equiv = 1.2e5;     // Modal Mass (kg)
const Omega_tower_nat = Math.sqrt(K_tower / (M_tower_equiv + Mass_rna)); // ~0.45 Hz (2.8 rad/s)
const C_tower = 0.02 * 2.0 * (M_tower_equiv + Mass_rna) * Omega_tower_nat; // 2% structural damping

// Benchmark Hydrodynamic & Mooring Stiffness (Jonkman et al., NREL/TP-500-38060)
// Total Pitch Stiffness C55 = Hydrostatic (rho*g*V*(zB - zG) + rho*g*Iwp) + Mooring K55
const C55_total = 1.34e9;        // N*m/rad (Benchmark calibrated)
const C55_damping = 2.8e8;       // Radiation + Viscous Damping (N*m*s/rad)
const K_mooring_surge = 41100.0; // Horizontal Surge Stiffness (N/m)

const g = 9.81;
const rho_air = 1.225;
const rho_water = 1025.0;

// Dynamic State Variables
let state = {
    surge: 0.0, surge_dot: 0.0,
    pitch: 0.0, pitch_dot: 0.0,
    q_tower: 0.0, q_tower_dot: 0.0, // Tower Elastic Deflection (m)
    omega_rotor: 1.267,             // 12.1 RPM rated = 1.267 rad/s
    blade_pitch_rad: 0.0,
    integral_err: 0.0
};

let rotorAngle = 0.0;
let isSimulationPaused = false;

// =========================================================================
// 2. THREE.JS SCENE, SKYBOX & LIGHTING
// =========================================================================
const container = document.getElementById('canvas3d');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.5, 4000);
camera.position.set(220, 60, 240);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Directional Sunlight & Sky Ambient
const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.8);
sunLight.position.set(-600, 400, 300);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0xb0e0e6, 0.65));

// Procedural Multi-Gradient Skybox
function buildSkybox() {
    const cubeMap = new THREE.CubeTexture([]);
    const size = 512;
    for (let i = 0; i < 6; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createLinearGradient(0, 0, 0, size);
        if (i === 2) { // Zenith (Top)
            grad.addColorStop(0.0, '#0369a1');
            grad.addColorStop(1.0, '#0284c7');
        } else if (i === 3) { // Nadir (Bottom)
            grad.addColorStop(0.0, '#0c4a6e');
            grad.addColorStop(1.0, '#0284c7');
        } else { // Horizon Sides
            grad.addColorStop(0.0, '#0284c7');
            grad.addColorStop(0.65, '#bae6fd');
            grad.addColorStop(0.85, '#e0f2fe');
            grad.addColorStop(1.0, '#f8fafc');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        // Sun disc on face 0
        if (i === 0) {
            const radGrad = ctx.createRadialGradient(256, 200, 8, 256, 200, 140);
            radGrad.addColorStop(0, '#ffffff');
            radGrad.addColorStop(0.3, '#fef08a');
            radGrad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = radGrad;
            ctx.beginPath();
            ctx.arc(256, 200, 140, 0, Math.PI * 2);
            ctx.fill();
        }
        cubeMap.images[i] = canvas;
    }
    cubeMap.needsUpdate = true;
    return cubeMap;
}
const envSkyMap = buildSkybox();
scene.background = envSkyMap;

// =========================================================================
// 3. FOWT RIGID-BODY & ELASTIC MODEL ASSEMBLY
// =========================================================================
const fowtGroup = new THREE.Group();

// Spar Buoy (-120m to +10m)
const sparMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(4.7, 4.7, 130, 32),
    new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35, metalness: 0.3 })
);
sparMesh.position.y = -55;
fowtGroup.add(sparMesh);

// Fairlead Ring at -70m
const fairleadRing = new THREE.Mesh(
    new THREE.TorusGeometry(5.0, 0.45, 16, 32),
    new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.25 })
);
fairleadRing.rotation.x = Math.PI / 2;
fairleadRing.position.y = -70.0;
fowtGroup.add(fairleadRing);

// Elastic Tower Group (pivots and deflects at top)
const towerGroup = new THREE.Group();
towerGroup.position.set(0, 10, 0);

const towerMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 3.2, 80, 24),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 })
);
towerMesh.position.y = 40.0;
towerGroup.add(towerMesh);
fowtGroup.add(towerGroup);

// RNA: Nacelle & Hub (Attached to Tower Top)
const rnaGroup = new THREE.Group();
rnaGroup.position.set(0, 80.0, 0); // At H = 90m

const nacelleMesh = new THREE.Mesh(
    new THREE.BoxGeometry(18.0, 4.2, 4.2),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 })
);
nacelleMesh.position.set(2.0, 0, 0);
rnaGroup.add(nacelleMesh);

const hubGroup = new THREE.Group();
hubGroup.position.set(-7.0, 0, 0);

const hubMesh = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 16), nacelleMesh.material);
hubGroup.add(hubMesh);

// 3 Blades with Pitch Articulation
const blades = [];
const bladeGeom = new THREE.BoxGeometry(1.2, R_rotor, 0.4);
bladeGeom.translate(0, R_rotor / 2.0, 0);
const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });

for (let b = 0; b < 3; b++) {
    const bladeRoot = new THREE.Group();
    bladeRoot.rotation.x = (b * 2 * Math.PI) / 3;
    const bladeM = new THREE.Mesh(bladeGeom, bladeMat);
    bladeRoot.add(bladeM);
    hubGroup.add(bladeRoot);
    blades.push(bladeRoot);
}
rnaGroup.add(hubGroup);

// =========================================================================
// 4. DOWNSTREAM WAKE: 3 EXPANDING HELICAL TIP VORTICES
// =========================================================================
// Parented directly to rnaGroup so it automatically inherits nacelle yaw
const wakeGroup = new THREE.Group();
wakeGroup.position.set(0, 0, 0);

const numSpiralPts = 140;
const vortexLines = [];
const vortexMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    linewidth: 2,
    transparent: true,
    opacity: 0.65
});

for (let v = 0; v < 3; v++) {
    const pts = [];
    for (let i = 0; i <= numSpiralPts; i++) pts.push(new THREE.Vector3());
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geom, vortexMat);
    wakeGroup.add(line);
    vortexLines.push(line);
}
rnaGroup.add(wakeGroup);

towerGroup.add(rnaGroup);
scene.add(fowtGroup);

function updateWake(CT, V_wind) {
    const a = 0.5 * (1.0 - Math.sqrt(Math.max(0.04, 1.0 - CT)));
    const expansion = Math.sqrt((1.0 - a) / Math.max(0.15, 1.0 - 2.0 * a));

    // V_wake = V_wind * (1 - 2a)
    const V_wake = Math.max(2.0, V_wind * (1.0 - 2.0 * a));
    // Kinematic spatial pitch: lambda = (2 * pi * V_wake) / Omega (m/turn)
    const spiralPitch = (2.0 * Math.PI * V_wake) / Math.max(0.4, state.omega_rotor);

    for (let v = 0; v < 3; v++) {
        const offset = (v * 2 * Math.PI) / 3;
        const pts = [];
        for (let i = 0; i <= numSpiralPts; i++) {
            const x = (i / numSpiralPts) * 240.0;
            const r = R_rotor * (1.0 + (expansion - 1.0) * (x / 240.0));
            // In local nacelle coordinates: rotor is at x = -7m, wake expands downstream (+X)
            const theta = offset - (x / spiralPitch) * (2.0 * Math.PI) + rotorAngle;
            pts.push(new THREE.Vector3(x - 7.0, r * Math.sin(theta), r * Math.cos(theta)));
        }
        vortexLines[v].geometry.setFromPoints(pts);
    }
}

// =========================================================================
// 5. SEABED & TOUCHDOWN CATENARY MOORING LINES
// =========================================================================
const seabedMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1800, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95, side: THREE.DoubleSide })
);
seabedMesh.rotation.x = -Math.PI / 2;
scene.add(seabedMesh);

const numCatenarySegs = 40;
const mooringLines = [];
const mooringMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 3 });

for (let m = 0; m < 3; m++) {
    const pts = [];
    for (let i = 0; i <= numCatenarySegs; i++) pts.push(new THREE.Vector3());
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geom, mooringMat);
    scene.add(line);
    mooringLines.push(line);
}

function updateCatenary(depth) {
    seabedMesh.position.y = -depth;
    const fairleadWorld = new THREE.Vector3();

    for (let m = 0; m < 3; m++) {
        const angle = (m * 2 * Math.PI) / 3;
        const localFairlead = new THREE.Vector3(5.0 * Math.cos(angle), -70.0, 5.0 * Math.sin(angle));
        fairleadWorld.copy(localFairlead);
        fowtGroup.localToWorld(fairleadWorld);

        const anchorX = 850.0 * Math.cos(angle);
        const anchorZ = 850.0 * Math.sin(angle);
        const anchorY = -depth;

        const pts = [];
        for (let i = 0; i <= numCatenarySegs; i++) {
            const t = i / numCatenarySegs;
            const x = THREE.MathUtils.lerp(fairleadWorld.x, anchorX, t);
            const z = THREE.MathUtils.lerp(fairleadWorld.z, anchorZ, t);

            // Catenary sag with floor touchdown clamp
            const sag = (depth * 0.32) * Math.sin(Math.PI * t) * (1.0 - 0.22 * t);
            const y = Math.max(anchorY, THREE.MathUtils.lerp(fairleadWorld.y, anchorY, t) - sag);
            pts.push(new THREE.Vector3(x, y, z));
        }
        mooringLines[m].geometry.setFromPoints(pts);
    }
}

// =========================================================================
// 6. IRREGULAR MONTE CARLO JONSWAP SEA STATE WITH SURFACE SCATTERING
// =========================================================================
const waterGeom = new THREE.PlaneGeometry(850, 850, 80, 80);
waterGeom.rotateX(-Math.PI / 2);
const waterMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.25,      // Eliminates flat mirror effect
    metalness: 0.65,      // Softens direct specular glints into ocean sheen
    envMap: envSkyMap,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide
});
const waterMesh = new THREE.Mesh(waterGeom, waterMat);
scene.add(waterMesh);

// 36 Monte Carlo JONSWAP Components with Non-Repeating Partitions
const numComps = 36;
const waveComps = [];
for (let i = 0; i < numComps; i++) {
    const fNorm = (i + Math.random()) / numComps;
    const freqFactor = 0.5 + fNorm * 1.5;
    const sigma = freqFactor <= 1.0 ? 0.07 : 0.09;
    const peakEnhance = Math.exp(-Math.pow(freqFactor - 1.0, 2) / (2 * sigma * sigma));
    const ampWeight = Math.pow(freqFactor, -5) * Math.exp(-1.25 * Math.pow(freqFactor, -4)) * Math.pow(3.3, peakEnhance);

    waveComps.push({
        freqFactor: freqFactor,
        ampWeight: Math.sqrt(Math.max(1e-4, ampWeight)),
        randomHeadingOffset: (Math.random() - 0.5) * Math.PI,
        phase: Math.random() * Math.PI * 2.0
    });
}

function updateOcean(time, Hs, Tp, spreadingS, waveHeadingRad) {
    const pos = waterGeom.attributes.position;
    const normals = waterGeom.attributes.normal;
    const omega_p = (2 * Math.PI) / Math.max(1.0, Tp);

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        let eta = 0.0;
        let grad_x = 0.0;
        let grad_z = 0.0;

        for (let c = 0; c < numComps; c++) {
            const comp = waveComps[c];
            const omega = omega_p * comp.freqFactor;
            const k = (omega ** 2) / g;

            // Spreading: s = 0 -> purely long-crested
            let theta = waveHeadingRad;
            let dirWeight = 1.0;
            if (spreadingS > 0) {
                theta = waveHeadingRad + comp.randomHeadingOffset / (1.0 + spreadingS * 0.5);
                dirWeight = Math.pow(Math.cos((theta - waveHeadingRad) * 0.5), spreadingS * 2);
            }

            const amp = (Hs / 6.0) * comp.ampWeight * dirWeight;
            const k_x = k * Math.cos(theta);
            const k_z = k * Math.sin(theta);
            const phase = k_x * x + k_z * z - omega * time + comp.phase;

            eta += amp * Math.cos(phase);

            const slope = amp * -Math.sin(phase);
            grad_x += slope * k_x;
            grad_z += slope * k_z;
        }

        // High-frequency micro-capillary slope scattering
        const microJitterX = Math.sin(x * 0.4 + time * 2.0) * Math.cos(z * 0.3) * 0.04;
        const microJitterZ = Math.cos(x * 0.3 - time * 1.7) * Math.sin(z * 0.4) * 0.04;

        pos.setY(i, eta);

        const nx = -(grad_x + microJitterX);
        const nz = -(grad_z + microJitterZ);
        const invLen = 1.0 / Math.sqrt(nx * nx + 1.0 + nz * nz);
        normals.setXYZ(i, nx * invLen, invLen, nz * invLen);
    }
    pos.needsUpdate = true;
    normals.needsUpdate = true;
}

// =========================================================================
// 7. AERO-HYDRO-SERVO-ELASTIC NUMERICAL SOLVER
// =========================================================================
function solvePhysicsSubStep(dt, V_wind, windHeadingRad, waveHeadingRad, Hs, Tp, Kp, Ki, detuneEnabled, time) {
    // Yaw Nacelle into Wind
    rnaGroup.rotation.y = -windHeadingRad;

    // Relative Wind Speed at Hub
    const V_surge = state.surge_dot * Math.cos(windHeadingRad);
    const V_pitch = (H_hub * (state.pitch_dot * Math.PI / 180.0) + state.q_tower_dot) * Math.cos(windHeadingRad);
    const V_rel = Math.max(0.1, V_wind - (V_surge + V_pitch));

    // Rated Rotor Speed: 12.1 RPM = 1.267 rad/s
    const Omega_rated = 1.267;
    const speed_error = state.omega_rotor - Omega_rated;

    // Gain Scheduling & Floating Detuning
    let eff_Kp = Kp;
    let eff_Ki = Ki;
    if (detuneEnabled) {
        eff_Kp *= 0.5; // Avoid negative damping resonance at platform natural period (~30s)
        eff_Ki *= 0.35;
    }

    if (V_rel > 11.4) {
        state.integral_err += speed_error * dt;
        state.blade_pitch_rad = Math.max(0.0, Math.min(25.0 * Math.PI / 180.0, eff_Kp * speed_error + eff_Ki * state.integral_err));
    } else {
        state.blade_pitch_rad = Math.max(0.0, state.blade_pitch_rad - 1.5 * dt * (Math.PI / 180.0));
        state.integral_err = 0.0;
    }

    // Aerodynamic Coefficients
    const C_T = Math.max(0.05, 0.82 * Math.cos(state.blade_pitch_rad));
    const C_P = Math.max(0.02, 0.48 * Math.pow(Math.cos(state.blade_pitch_rad), 2));

    const F_thrust = 0.5 * rho_air * (Math.PI * R_rotor ** 2) * C_T * (V_rel ** 2);
    const P_aero = 0.5 * rho_air * (Math.PI * R_rotor ** 2) * C_P * (V_rel ** 3);

    // Rotor Acceleration: J_drivetrain dOmega/dt = Q_aero - Q_gen
    const Q_aero = P_aero / Math.max(0.1, state.omega_rotor);
    const Q_gen = Math.min(P_aero, 5.0e6 / Omega_rated);
    const J_rotor = 3.5e7;
    state.omega_rotor += ((Q_aero - Q_gen) / J_rotor) * dt;
    state.omega_rotor = Math.max(0.3, Math.min(1.35, state.omega_rotor));

    // Depth-decayed 1st-Order Wave Pitch Moment on Slender Spar
    const omega_wave = (2 * Math.PI) / Math.max(1.0, Tp);
    const k_wave = (omega_wave ** 2) / g;
    // Wave dynamic pressure decays as exp(-k*z) near effective action center (-45m)
    const depth_decay = Math.exp(-k_wave * 45.0);
    const M_wave = 0.5 * rho_water * g * (Math.PI * 4.7 ** 2 / 4) * (Hs / 2.0) * depth_decay * 45.0 * Math.sin(omega_wave * time) * Math.cos(waveHeadingRad);

    // Coupled Equations of Motion:
    // 1. Platform Pitch (Calibrated against OC3 Benchmark C55)
    const pitch_rad = state.pitch * Math.PI / 180.0;
    const pitch_acc = (F_thrust * Math.cos(windHeadingRad) * H_hub + M_wave - C55_total * pitch_rad - C55_damping * state.pitch_dot) / I_pitch;
    state.pitch_dot += pitch_acc * dt;
    state.pitch += (state.pitch_dot * 180.0 / Math.PI) * dt;

    // 2. Platform Surge
    const surge_acc = (F_thrust * Math.cos(windHeadingRad) - K_mooring_surge * state.surge - 2.5e5 * state.surge_dot) / Mass_total;
    state.surge_dot += surge_acc * dt;
    state.surge += state.surge_dot * dt;

    // 3. Elastic Tower Fore-Aft Bending Mode ODE
    const q_acc = (F_thrust - K_tower * state.q_tower - C_tower * state.q_tower_dot - Mass_rna * H_hub * pitch_acc) / (M_tower_equiv + Mass_rna);
    state.q_tower_dot += q_acc * dt;
    state.q_tower += state.q_tower_dot * dt;

    return { F_thrust, P_aero, V_rel, C_T };
}

// =========================================================================
// 8. PLOTLY TIME-SERIES MONITOR
// =========================================================================
const timeHist = [], powerHist = [], pitchHist = [];
function initPlot() {
    const traceP = { x: timeHist, y: powerHist, name: 'Power (MW)', line: { color: '#22c55e', width: 2 } };
    const tracePitch = { x: timeHist, y: pitchHist, name: 'Pitch (deg)', line: { color: '#eab308', width: 2 }, yaxis: 'y2' };

    const layout = {
        margin: { t: 25, b: 35, l: 45, r: 45 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        showlegend: true,
        legend: { font: { color: '#f8fafc' }, x: 0.05, y: 1.15, orientation: 'h' },
        xaxis: { title: 'Time (s)', tickfont: { color: '#f8fafc' }, gridcolor: '#334155' },
        yaxis: { title: 'Power (MW)', tickfont: { color: '#22c55e' }, gridcolor: '#334155' },
        yaxis2: { title: 'Platform Pitch (deg)', tickfont: { color: '#eab308' }, overlaying: 'y', side: 'right' },
        height: 250
    };
    Plotly.newPlot('plot-container', [traceP, tracePitch], layout, { responsive: true });
}
initPlot();

// =========================================================================
// 9. ANIMATION & FIXED-SUBSTEP INTEGRATION LOOP
// =========================================================================
const clock = new THREE.Clock();
let physicsAccumulator = 0.0;
const FIXED_DT = 0.01; // 100 Hz fixed physics sub-step
let simTime = 0.0;

function togglePause() {
    isSimulationPaused = !isSimulationPaused;
    document.getElementById('btn-pause').innerText = isSimulationPaused ? '▶ Run' : '⏸ Pause';
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    let frameDelta = clock.getDelta();
    // Tab throttling guard: clamp delta to prevent numerical explosions when switching tabs
    if (frameDelta > 0.1) frameDelta = 0.02;

    const V_wind = parseFloat(document.getElementById('slider-wind').value);
    const windHeadingDeg = parseFloat(document.getElementById('slider-wind-dir').value);
    const Hs = parseFloat(document.getElementById('slider-hs').value);
    const Tp = parseFloat(document.getElementById('slider-tp').value);
    const waveHeadingDeg = parseFloat(document.getElementById('slider-wave-dir').value);
    const spreadingS = parseInt(document.getElementById('slider-spread').value);
    const depth = parseFloat(document.getElementById('slider-depth').value);
    const Kp = parseFloat(document.getElementById('slider-kp').value);
    const Ki = parseFloat(document.getElementById('slider-ki').value);
    const detuneEnabled = document.getElementById('check-detune').checked;

    const windRad = (windHeadingDeg * Math.PI) / 180.0;
    const waveRad = (waveHeadingDeg * Math.PI) / 180.0;

    let res = { F_thrust: 0, P_aero: 0, V_rel: V_wind, C_T: 0.8 };

    if (!isSimulationPaused) {
        physicsAccumulator += frameDelta;
        while (physicsAccumulator >= FIXED_DT) {
            res = solvePhysicsSubStep(FIXED_DT, V_wind, windRad, waveRad, Hs, Tp, Kp, Ki, detuneEnabled, simTime);
            simTime += FIXED_DT;
            physicsAccumulator -= FIXED_DT;
        }

        // Rotate Rotor Blades
        rotorAngle += state.omega_rotor * frameDelta;
        hubGroup.rotation.x = rotorAngle;

        // Apply Blade Pitch Articulation
        blades.forEach(b => { b.children[0].rotation.y = state.blade_pitch_rad; });

        // Update Platform Position & Rotations
        fowtGroup.position.x = state.surge;
        fowtGroup.rotation.z = -state.pitch * Math.PI / 180.0;

        // Elastic Tower Fore-Aft Deflection
        towerGroup.rotation.z = -state.q_tower / 80.0;

        // Graphics Updates
        updateCatenary(depth);
        updateWake(res.C_T, V_wind);
        updateOcean(simTime, Hs, Tp, spreadingS, waveRad);

        // Dashboard Readouts
        const power_MW = Math.min(5.0, res.P_aero / 1e6);
        document.getElementById('dash-power').innerText = power_MW.toFixed(2) + ' MW';
        document.getElementById('dash-pitch').innerText = (state.blade_pitch_rad * 180.0 / Math.PI).toFixed(1) + '°';
        document.getElementById('dash-platpitch').innerText = state.pitch.toFixed(1) + '°';
        document.getElementById('dash-thrust').innerText = (res.F_thrust / 1e3).toFixed(0) + ' kN';

        const rpm = (state.omega_rotor * 60.0 / (2 * Math.PI));
        document.getElementById('overlay-rpm').innerText = rpm.toFixed(1) + ' RPM';
        document.getElementById('overlay-flex').innerText = state.q_tower.toFixed(2) + ' m';
        document.getElementById('overlay-misalign').innerText = Math.abs(windHeadingDeg - waveHeadingDeg).toFixed(0) + '°';

        // Time Series Plot (rolling 1,200 points ≈ 120s)
        if (timeHist.length > 1200) { timeHist.shift(); powerHist.shift(); pitchHist.shift(); }
        timeHist.push(simTime.toFixed(1));
        powerHist.push(power_MW);
        pitchHist.push(state.pitch);
        Plotly.update('plot-container', { x: [timeHist, timeHist], y: [powerHist, pitchHist] });
    }

    renderer.render(scene, camera);
}
animate();

// =========================================================================
// 10. UI & "SNAP TO WIND" EQUILIBRIUM EVENT LISTENERS
// =========================================================================
function updateUI() {
    const V = parseFloat(document.getElementById('slider-wind').value);
    const windDir = document.getElementById('slider-wind-dir').value;
    const isEquilibrium = document.getElementById('check-equilibrium').checked;

    if (isEquilibrium) {
        // Pierson-Moskowitz fully-developed sea equilibrium
        const Hs_eq = (0.0246 * Math.pow(V, 2)).toFixed(1);
        const Tp_eq = (0.714 * V).toFixed(1);

        document.getElementById('slider-hs').value = Math.min(9.0, Math.max(0.5, Hs_eq));
        document.getElementById('slider-tp').value = Math.min(20.0, Math.max(4.0, Tp_eq));
        document.getElementById('slider-wave-dir').value = windDir;
    }

    document.getElementById('val-wind').innerText = V + ' m/s';
    document.getElementById('val-wind-dir').innerText = windDir + '°';
    document.getElementById('val-hs').innerText = document.getElementById('slider-hs').value + ' m';
    document.getElementById('val-tp').innerText = document.getElementById('slider-tp').value + ' s';
    document.getElementById('val-wave-dir').innerText = document.getElementById('slider-wave-dir').value + '°';

    const sVal = parseInt(document.getElementById('slider-spread').value);
    document.getElementById('val-spread').innerText = (sVal === 0) ? 's = 0 (Unidirectional)' : 's = ' + sVal;

    document.getElementById('val-depth').innerText = document.getElementById('slider-depth').value + ' m';
    document.getElementById('val-kp').innerText = document.getElementById('slider-kp').value;
    document.getElementById('val-ki').innerText = document.getElementById('slider-ki').value;
}

[
    'slider-wind', 'slider-wind-dir', 'slider-hs', 'slider-tp',
    'slider-wave-dir', 'slider-spread', 'slider-depth', 'slider-kp', 'slider-ki'
].forEach(id => {
    document.getElementById(id).addEventListener('input', updateUI);
});
document.getElementById('check-equilibrium').addEventListener('change', updateUI);

window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    Plotly.Plots.resize('plot-container');
});
