import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Camera, Eye, EyeOff, RotateCcw } from 'lucide-react';

export type Studio3DPreset = 'observatory' | 'sentinel' | 'resonator' | 'terrarium';
type LightingMood = 'studio' | 'cobalt' | 'warm';

interface Studio3DViewProps {
  initialPreset?: string;
}

const PRESET_LIST: Array<{ id: Studio3DPreset; label: string }> = [
  { id: 'observatory', label: 'Orbital Observatory' },
  { id: 'sentinel', label: 'Chrono Sentinel' },
  { id: 'resonator', label: 'Harmonic Resonator' },
  { id: 'terrarium', label: 'Geometric Terrarium' },
];

function createProceduralTexture(kind: 'metal' | 'grid' | 'amber'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  if (kind === 'metal') {
    ctx.fillStyle = '#1b2434';
    ctx.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 2) {
      const shade = 24 + ((y * 7) % 16);
      ctx.fillStyle = `rgb(${shade}, ${shade + 8}, ${shade + 22})`;
      ctx.fillRect(0, y, 512, 1);
    }
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(16, 16, 480, 480);
  } else if (kind === 'grid') {
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 512; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
  } else {
    const grad = ctx.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(0.5, '#0f172a');
    grad.addColorStop(1, '#312e81');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.28)';
    for (let r = 32; r < 256; r += 32) {
      ctx.beginPath();
      ctx.arc(256, 256, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildPresetModel(
  preset: Studio3DPreset,
  metalTex: THREE.CanvasTexture,
  panelTex: THREE.CanvasTexture,
  wireframe: boolean
): { group: THREE.Group; animateParts: THREE.Object3D[] } {
  const group = new THREE.Group();
  const animateParts: THREE.Object3D[] = [];

  const darkAlloy = new THREE.MeshStandardMaterial({
    map: metalTex,
    metalness: 0.85,
    roughness: 0.28,
    wireframe,
  });
  const brushedSilver = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.9,
    roughness: 0.2,
    wireframe,
  });
  const azureAccent = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    emissive: 0x1d4ed8,
    emissiveIntensity: 0.45,
    metalness: 0.5,
    roughness: 0.25,
    wireframe,
  });
  const glassCore = new THREE.MeshPhysicalMaterial({
    color: 0x60a5fa,
    emissive: 0x0f172a,
    metalness: 0.1,
    roughness: 0.12,
    clearcoat: 1,
    wireframe,
  });
  const etchedPlate = new THREE.MeshStandardMaterial({
    map: panelTex,
    metalness: 0.65,
    roughness: 0.35,
    wireframe,
  });

  if (preset === 'observatory') {
    // 1. Turned pedestal via LatheGeometry
    const lathePts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(1.5, 0),
      new THREE.Vector2(1.42, 0.2),
      new THREE.Vector2(1.05, 0.38),
      new THREE.Vector2(1.05, 0.52),
      new THREE.Vector2(0, 0.52),
    ];
    const base = new THREE.Mesh(new THREE.LatheGeometry(lathePts, 40), darkAlloy);
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // 2. Plinth deck ring
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.12, 32), brushedSilver);
    deck.position.y = 0.58;
    group.add(deck);

    // 3. Three curved support struts via TubeGeometry
    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(ang) * 0.95, 0.6, Math.sin(ang) * 0.95),
        new THREE.Vector3(Math.cos(ang) * 1.15, 1.35, Math.sin(ang) * 1.15),
        new THREE.Vector3(Math.cos(ang) * 0.72, 2.05, Math.sin(ang) * 0.72),
      ]);
      const strut = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.055, 12, false), brushedSilver);
      strut.castShadow = true;
      group.add(strut);
    }

    // 4. Outer gimbal ring
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.055, 16, 64), etchedPlate);
    outerRing.position.y = 1.68;
    outerRing.rotation.x = 0.45;
    group.add(outerRing);
    animateParts.push(outerRing);

    // 5. Inner gyroscope ring
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.045, 16, 56), azureAccent);
    innerRing.position.y = 1.68;
    innerRing.rotation.z = 0.7;
    group.add(innerRing);
    animateParts.push(innerRing);

    // 6. Central planetary core
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 2), glassCore);
    core.position.y = 1.68;
    core.castShadow = true;
    group.add(core);
    animateParts.push(core);

    // 7. Equatorial fin ring
    const equator = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.04, 32, 1, true), brushedSilver);
    equator.material.side = THREE.DoubleSide;
    equator.position.y = 1.68;
    equator.rotation.x = 0.25;
    group.add(equator);
  } else if (preset === 'sentinel') {
    // 1. Hexagonal plinth
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 0.3, 6), darkAlloy);
    plinth.position.y = 0.15;
    plinth.receiveShadow = true;
    group.add(plinth);

    // 2. Extruded bevel fin column
    const shape = new THREE.Shape();
    shape.moveTo(-0.35, -0.35);
    shape.lineTo(0.35, -0.35);
    shape.lineTo(0.45, 0);
    shape.lineTo(0.35, 0.35);
    shape.lineTo(-0.35, 0.35);
    shape.lineTo(-0.45, 0);
    shape.closePath();
    const torso = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 1.35, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05 }),
      etchedPlate
    );
    torso.rotation.x = -Math.PI / 2;
    torso.position.y = 0.32;
    torso.castShadow = true;
    group.add(torso);

    // 3. Armor collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.52, 0.26, 12), brushedSilver);
    collar.position.y = 1.75;
    group.add(collar);

    // 4. Optic visor head
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 1), darkAlloy);
    head.position.y = 2.25;
    head.castShadow = true;
    group.add(head);
    animateParts.push(head);

    // 5. Glowing visor band
    const visor = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 12, 32), azureAccent);
    visor.position.y = 2.25;
    visor.rotation.x = Math.PI / 2;
    group.add(visor);

    // 6. Floating shoulder vanes
    for (const side of [-1, 1]) {
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.95, 0.55), brushedSilver);
      vane.position.set(side * 0.88, 1.48, 0);
      vane.rotation.z = side * -0.18;
      vane.castShadow = true;
      group.add(vane);
    }

    // 7. Halo energy ring
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.03, 12, 48), azureAccent);
    halo.position.y = 1.75;
    halo.rotation.x = Math.PI / 2.4;
    group.add(halo);
    animateParts.push(halo);
  } else if (preset === 'resonator') {
    // 1. Dish base
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.55, 0.22, 40), darkAlloy);
    dish.position.y = 0.11;
    group.add(dish);

    // 2. Twin harmonic pillars
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 2.2, 20), brushedSilver);
      pillar.position.set(side * 0.88, 1.25, 0);
      pillar.castShadow = true;
      group.add(pillar);
    }

    // 3. Crossbridge arch
    const bridgeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.88, 2.35, 0),
      new THREE.Vector3(0, 2.75, 0),
      new THREE.Vector3(0.88, 2.35, 0),
    ]);
    const arch = new THREE.Mesh(new THREE.TubeGeometry(bridgeCurve, 28, 0.08, 12, false), brushedSilver);
    group.add(arch);

    // 4-6. Stacked harmonic rings
    [0.95, 1.45, 1.95].forEach((yPos, i) => {
      const r = new THREE.Mesh(
        new THREE.TorusGeometry(0.65 - i * 0.1, 0.045, 14, 48),
        i === 1 ? azureAccent : etchedPlate
      );
      r.position.y = yPos;
      r.rotation.x = Math.PI / 2 + (i - 1) * 0.22;
      group.add(r);
      animateParts.push(r);
    });

    // 7. Levitating knot core
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.32, 0.09, 96, 16), glassCore);
    knot.position.y = 1.45;
    knot.castShadow = true;
    group.add(knot);
    animateParts.push(knot);
  } else {
    // Geometric Terrarium
    // 1. Stone rim base
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.48, 0.34, 8), darkAlloy);
    rim.position.y = 0.17;
    group.add(rim);

    // 2. Faceted basin
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.22, 0.12, 8), etchedPlate);
    basin.position.y = 0.38;
    group.add(basin);

    // 3-5. Crystalline spires
    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x0c4a6e,
      metalness: 0.15,
      roughness: 0.15,
      clearcoat: 1,
      wireframe,
    });
    const spireConfigs = [
      { x: 0, z: 0, r: 0.34, h: 1.55, tilt: 0 },
      { x: -0.52, z: 0.32, r: 0.22, h: 1.05, tilt: 0.24 },
      { x: 0.48, z: -0.28, r: 0.24, h: 1.18, tilt: -0.2 },
      { x: 0.28, z: 0.54, r: 0.17, h: 0.78, tilt: 0.16 },
    ];
    spireConfigs.forEach((c) => {
      const spire = new THREE.Mesh(new THREE.ConeGeometry(c.r, c.h, 6), crystalMat);
      spire.position.set(c.x, 0.42 + c.h / 2, c.z);
      spire.rotation.z = c.tilt;
      spire.castShadow = true;
      group.add(spire);
    });

    // 6. Geodesic lattice dome ribs
    const cage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.42, 1),
      new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.8,
        roughness: 0.3,
        wireframe: true,
      })
    );
    cage.position.y = 1.22;
    group.add(cage);
    animateParts.push(cage);

    // 7. Orbiting satellite orb
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 20), azureAccent);
    orb.position.set(0.95, 1.85, 0);
    group.add(orb);
    animateParts.push(orb);
  }

  return { group, animateParts };
}

export const Studio3DView: React.FC<Studio3DViewProps> = ({ initialPreset }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [preset, setPreset] = useState<Studio3DPreset>(
    PRESET_LIST.some((p) => p.id === initialPreset)
      ? (initialPreset as Studio3DPreset)
      : 'observatory'
  );
  const [mood, setMood] = useState<LightingMood>('studio');
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [zenMode, setZenMode] = useState(false);

  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const autoRotateRef = useRef(autoRotate);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  useEffect(() => {
    if (initialPreset && PRESET_LIST.some((p) => p.id === initialPreset)) {
      setPreset(initialPreset as Studio3DPreset);
    }
  }, [initialPreset]);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (
        ev.target instanceof HTMLInputElement ||
        ev.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (ev.key === 'h' || ev.key === 'H') {
        setZenMode((z) => !z);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Detect software WebGL rasterizer cleanly before allocating renderer
    let isSoftwareGl = false;
    try {
      const probeCanvas = document.createElement('canvas');
      const gl =
        probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const rendererName = dbg
          ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
          : String(gl.getParameter(gl.RENDERER) || '');
        isSoftwareGl = /swiftshader|llvmpipe|software/i.test(rendererName);
      }
    } catch {
      isSoftwareGl = false;
    }

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 320);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090d16');
    scene.fog = new THREE.FogExp2(0x090d16, 0.045);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(4.1, 2.7, 4.4);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.target.set(0, 1.3, 0);
    controls.minDistance = 2.2;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.autoRotate = autoRotateRef.current;
    controls.autoRotateSpeed = 0.7;
    controlsRef.current = controls;

    // Ground stage
    const gridTex = createProceduralTexture('grid');
    gridTex.repeat.set(6, 6);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({
        map: gridTex,
        metalness: 0.4,
        roughness: 0.75,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Three-point studio rig
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(5, 8, 5);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);
    keyLightRef.current = keyLight;

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 1.0);
    fillLight.position.set(-5, 4, -4);
    scene.add(fillLight);
    fillLightRef.current = fillLight;

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.55);
    scene.add(hemiLight);

    const metalTex = createProceduralTexture('metal');
    const panelTex = createProceduralTexture('amber');
    const { group, animateParts } = buildPresetModel(preset, metalTex, panelTex, wireframe);
    scene.add(group);

    let rafId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      animateParts.forEach((part, idx) => {
        part.rotation.y += dt * (0.35 + idx * 0.14);
        if (idx % 2 === 1) {
          part.rotation.z += dt * 0.18;
        }
      });
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m?.dispose());
        }
      });
      gridTex.dispose();
      metalTex.dispose();
      panelTex.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [preset, wireframe]);

  useEffect(() => {
    const key = keyLightRef.current;
    const fill = fillLightRef.current;
    if (!key || !fill) return;
    if (mood === 'cobalt') {
      key.color.setHex(0xdbeafe);
      fill.color.setHex(0x3b82f6);
    } else if (mood === 'warm') {
      key.color.setHex(0xfff1d6);
      fill.color.setHex(0xf59e0b);
    } else {
      key.color.setHex(0xffffff);
      fill.color.setHex(0x93c5fd);
    }
  }, [mood]);

  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(4.1, 2.7, 4.4);
      controlsRef.current.target.set(0, 1.3, 0);
      controlsRef.current.update();
    }
  };

  const handleSnapshot = () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `scopex-3d-${preset}.png`;
    a.click();
  };

  return (
    <div className="relative h-full w-full bg-[#090d16] overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />

      {/* Top Left Minimal Title / Toggle */}
      <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
        {!zenMode && (
          <div className="px-3 py-1.5 rounded-lg bg-[#0B101B]/90 border border-white/10 text-xs text-slate-200">
            <span className="font-display font-semibold text-white">3D Studio</span>
            <span className="text-slate-400"> · Drag to orbit · Scroll to zoom</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setZenMode((z) => !z)}
          title="Toggle HUD (H)"
          className="p-2 rounded-lg bg-[#0B101B]/90 border border-white/10 text-slate-300 hover:text-white"
        >
          {zenMode ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Compact Bottom Control Dock (no backdrop-blur over WebGL) */}
      {!zenMode && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[96%] z-10 bg-[#0B101B]/95 border border-white/10 rounded-xl px-3 py-2 flex flex-wrap items-center justify-center gap-2">
          <div className="flex items-center gap-1 border-r border-white/10 pr-2">
            {PRESET_LIST.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  preset === p.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 border-r border-white/10 pr-2">
            {(['studio', 'cobalt', 'warm'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMood(m)}
                className={`px-2 py-1 rounded-md text-xs capitalize transition-colors whitespace-nowrap shrink-0 ${
                  mood === m
                    ? 'bg-white/[0.14] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setWireframe((w) => !w)}
            className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors whitespace-nowrap shrink-0 ${
              wireframe
                ? 'bg-violet-600 text-white'
                : 'bg-white/[0.06] text-slate-300 hover:text-white'
            }`}
          >
            Wireframe
          </button>

          <button
            type="button"
            onClick={() => setAutoRotate((a) => !a)}
            className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors whitespace-nowrap shrink-0 ${
              autoRotate
                ? 'bg-blue-600/25 text-blue-300 border border-blue-500/30'
                : 'bg-white/[0.06] text-slate-300 hover:text-white'
            }`}
          >
            Auto-Orbit
          </button>

          <button
            type="button"
            onClick={handleResetCamera}
            title="Reset Camera"
            className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleSnapshot}
            title="Save PNG Snapshot"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 whitespace-nowrap shrink-0"
          >
            <Camera className="w-3.5 h-3.5" />
            PNG
          </button>
        </div>
      )}
    </div>
  );
};
