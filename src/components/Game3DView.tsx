import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';
type DifficultyMode = 'standard' | 'hyperdrive';

interface Game3DViewProps {
  initialDifficulty?: string;
}

class ArcadeAudioSynth {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensureCtx(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  playLaser(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(760, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(190, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
  }

  playDestroy(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(48, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.19);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }

  playHit(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.24);
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}

function buildInterceptorShip(): THREE.Group {
  const ship = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.85,
    roughness: 0.22,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.75,
    roughness: 0.35,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.2,
  });

  // 1. Fuselage cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.45, 6), hullMat);
  nose.rotation.x = -Math.PI / 2;
  ship.add(nose);

  // 2. Cockpit canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), glowMat);
  canopy.scale.set(0.85, 0.55, 1.45);
  canopy.position.set(0, 0.16, 0.08);
  ship.add(canopy);

  // 3-4. Swept wings
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.06, 0.55), hullMat);
    wing.position.set(side * 0.68, -0.02, 0.24);
    wing.rotation.y = side * -0.35;
    ship.add(wing);

    const stabilizer = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.35), darkMat);
    stabilizer.position.set(side * 1.18, 0.14, 0.36);
    stabilizer.rotation.z = side * -0.25;
    ship.add(stabilizer);
  }

  // 5-6. Twin thruster nozzles
  for (const side of [-1, 1]) {
    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.3, 12), darkMat);
    thruster.rotation.x = Math.PI / 2;
    thruster.position.set(side * 0.22, -0.02, 0.74);
    ship.add(thruster);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 10), glowMat);
    flame.rotation.x = Math.PI / 2;
    flame.position.set(side * 0.22, -0.02, 0.96);
    ship.add(flame);
  }

  return ship;
}

export const Game3DView: React.FC<Game3DViewProps> = ({ initialDifficulty }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<GamePhase>('title');
  const [difficulty, setDifficulty] = useState<DifficultyMode>(
    initialDifficulty === 'hyperdrive' ? 'hyperdrive' : 'standard'
  );
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('scopex_aegis_best') || 0);
    } catch {
      return 0;
    }
  });
  const [combo, setCombo] = useState(1);
  const [shield, setShield] = useState(100);
  const [wave, setWave] = useState(1);
  const [muted, setMuted] = useState(false);

  const phaseRef = useRef<GamePhase>(phase);
  const difficultyRef = useRef<DifficultyMode>(difficulty);
  const synthRef = useRef<ArcadeAudioSynth>(new ArcadeAudioSynth());
  const startMissionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);

  useEffect(() => {
    if (initialDifficulty === 'hyperdrive' || initialDifficulty === 'standard') {
      setDifficulty(initialDifficulty);
    }
  }, [initialDifficulty]);

  useEffect(() => {
    synthRef.current.muted = muted;
  }, [muted]);

  const togglePause = useCallback(() => {
    setPhase((p) => (p === 'playing' ? 'paused' : p === 'paused' ? 'playing' : p));
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let isSoftwareGl = false;
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const name = dbg
          ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
          : String(gl.getParameter(gl.RENDERER) || '');
        isSoftwareGl = /swiftshader|llvmpipe|software/i.test(name);
      }
    } catch {
      isSoftwareGl = false;
    }

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 320);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#040711');
    scene.fog = new THREE.FogExp2(0x040711, 0.016);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    const envTarget = pmrem.fromScene(envScene, 0.04);
    scene.environment = envTarget.texture;
    envScene.dispose();

    const camera = new THREE.PerspectiveCamera(56, width / height, 0.1, 160);
    camera.position.set(0, 3.6, 8.2);
    camera.lookAt(0, 0.4, -14);

    // Lighting
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.1);
    dirLight.position.set(6, 12, 8);
    scene.add(dirLight);
    scene.add(new THREE.HemisphereLight(0x60a5fa, 0x090d16, 0.65));

    // Scrolling wireframe trench grid
    const grid = new THREE.GridHelper(120, 48, 0x2563eb, 0x172554);
    grid.position.y = -2.2;
    scene.add(grid);

    // Starfield particles
    const starPositions = new Float32Array(450 * 3);
    for (let i = 0; i < 450; i++) {
      starPositions[i * 3] = (Math.random() - 0.5) * 65;
      starPositions[i * 3 + 1] = (Math.random() - 0.35) * 34;
      starPositions[i * 3 + 2] = -Math.random() * 95;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.18 });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    const player = buildInterceptorShip();
    player.position.set(0, 0, 1.5);
    scene.add(player);

    // Pooled bolts & asteroids
    interface BoltItem {
      mesh: THREE.Mesh;
      active: boolean;
    }
    const boltGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6);
    boltGeo.rotateX(Math.PI / 2);
    const boltMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.8,
    });
    const bolts: BoltItem[] = Array.from({ length: 24 }, () => {
      const mesh = new THREE.Mesh(boltGeo, boltMat);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, active: false };
    });

    interface EnemyItem {
      mesh: THREE.Mesh;
      active: boolean;
      speed: number;
      hp: number;
      rotSpeed: number;
    }
    const enemyGeo = new THREE.DodecahedronGeometry(0.72, 0);
    const enemyMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0x7c2d12,
      emissiveIntensity: 0.45,
      metalness: 0.45,
      roughness: 0.45,
    });
    const enemies: EnemyItem[] = Array.from({ length: 22 }, () => {
      const mesh = new THREE.Mesh(enemyGeo, enemyMat);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, active: false, speed: 14, hp: 1, rotSpeed: 1 };
    });

    interface SparkItem {
      mesh: THREE.Mesh;
      vx: number;
      vy: number;
      vz: number;
      life: number;
    }
    const sparkGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const sparks: SparkItem[] = Array.from({ length: 40 }, () => {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, vx: 0, vy: 0, vz: 0, life: 0 };
    });

    // Game runtime state inside closure
    const held = new Set<string>();
    const justPressed = new Set<string>();
    let shipX = 0;
    let shipY = 0;
    let fireCooldown = 0;
    let spawnTimer = 0;
    let elapsed = 0;
    let localScore = 0;
    let localCombo = 1;
    let localShield = 100;
    let localWave = 1;
    let shake = 0;
    let hitstop = 0;

    const spawnBurst = (pos: THREE.Vector3, count = 8) => {
      let spawned = 0;
      for (const sp of sparks) {
        if (sp.life <= 0) {
          sp.mesh.position.copy(pos);
          sp.mesh.visible = true;
          sp.vx = (Math.random() - 0.5) * 9;
          sp.vy = (Math.random() - 0.5) * 9;
          sp.vz = (Math.random() - 0.5) * 9;
          sp.life = 0.42;
          spawned++;
          if (spawned >= count) break;
        }
      }
    };

    const resetSession = () => {
      shipX = 0;
      shipY = 0;
      player.position.set(0, 0, 1.5);
      player.rotation.set(0, 0, 0);
      fireCooldown = 0;
      spawnTimer = 0.25;
      elapsed = 0;
      localScore = 0;
      localCombo = 1;
      localShield = 100;
      localWave = 1;
      shake = 0;
      hitstop = 0;
      for (const b of bolts) {
        b.active = false;
        b.mesh.visible = false;
      }
      for (const e of enemies) {
        e.active = false;
        e.mesh.visible = false;
      }
      for (const sp of sparks) {
        sp.life = 0;
        sp.mesh.visible = false;
      }
      setScore(0);
      setCombo(1);
      setShield(100);
      setWave(1);
      setPhase('playing');
    };
    startMissionRef.current = resetSession;

    const fireDualLaser = () => {
      let fired = 0;
      for (const offsetX of [-0.42, 0.42]) {
        const slot = bolts.find((b) => !b.active);
        if (!slot) break;
        slot.active = true;
        slot.mesh.visible = true;
        slot.mesh.position.set(shipX + offsetX, shipY, 0.7);
        fired++;
      }
      if (fired > 0) synthRef.current.playLaser();
    };

    const spawnEnemy = () => {
      const slot = enemies.find((e) => !e.active);
      if (!slot) return;
      const mult = difficultyRef.current === 'hyperdrive' ? 1.38 : 1;
      slot.active = true;
      slot.mesh.visible = true;
      slot.mesh.position.set((Math.random() - 0.5) * 11, (Math.random() - 0.35) * 5.2, -78);
      slot.speed = (16 + localWave * 2.2 + Math.random() * 6) * mult;
      slot.hp = localWave >= 3 && Math.random() > 0.65 ? 2 : 1;
      slot.rotSpeed = (Math.random() - 0.5) * 2.8;
      slot.mesh.scale.setScalar(slot.hp > 1 ? 1.25 : 0.85 + Math.random() * 0.3);
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (
        ev.target instanceof HTMLInputElement ||
        ev.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const code = ev.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
        ev.preventDefault();
      }
      if (!held.has(code)) justPressed.add(code);
      held.add(code);

      if ((code === 'Enter' || code === 'Space') && phaseRef.current === 'title') {
        resetSession();
      } else if (code === 'KeyP' && (phaseRef.current === 'playing' || phaseRef.current === 'paused')) {
        togglePause();
      } else if (code === 'KeyR' && (phaseRef.current === 'playing' || phaseRef.current === 'paused' || phaseRef.current === 'gameover')) {
        resetSession();
      }
    };

    const onKeyUp = (ev: KeyboardEvent) => {
      held.delete(ev.code);
    };

    const onBlur = () => {
      held.clear();
      justPressed.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    let rafId = 0;
    const clock = new THREE.Clock();

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const rawDt = clock.getDelta();
      const dt = Math.min(rawDt, 0.05);

      if (phaseRef.current === 'title') {
        const t = performance.now() * 0.001;
        player.position.set(Math.sin(t * 0.8) * 1.4, Math.cos(t * 1.3) * 0.35, 1.5);
        player.rotation.z = -Math.cos(t * 0.8) * 0.25;
        grid.position.z = (grid.position.z + dt * 14) % 2.5;
        camera.position.set(Math.sin(t * 0.25) * 1.1, 3.6, 8.2);
        camera.lookAt(0, 0.4, -12);
        renderer.render(scene, camera);
        justPressed.clear();
        return;
      }

      if (phaseRef.current === 'paused' || phaseRef.current === 'gameover') {
        renderer.render(scene, camera);
        justPressed.clear();
        return;
      }

      if (hitstop > 0) {
        hitstop -= dt;
        renderer.render(scene, camera);
        justPressed.clear();
        return;
      }

      elapsed += dt;
      const nextWave = Math.floor(elapsed / 18) + 1;
      if (nextWave !== localWave) {
        localWave = nextWave;
        setWave(localWave);
      }

      // Movement
      const moveX =
        (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) -
        (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
      const moveY =
        (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) -
        (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0);

      shipX = THREE.MathUtils.clamp(shipX + moveX * 9.5 * dt, -5.8, 5.8);
      shipY = THREE.MathUtils.clamp(shipY + moveY * 6.8 * dt, -1.3, 3.1);
      player.position.x = shipX;
      player.position.y = shipY;
      player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, -moveX * 0.42, 0.16);
      player.rotation.x = THREE.MathUtils.lerp(player.rotation.x, moveY * 0.22, 0.16);

      // Firing
      fireCooldown -= dt;
      if ((held.has('Space') || justPressed.has('Space')) && fireCooldown <= 0) {
        fireDualLaser();
        fireCooldown = difficultyRef.current === 'hyperdrive' ? 0.12 : 0.16;
      }

      // World scroll
      const worldSpeed = difficultyRef.current === 'hyperdrive' ? 28 : 20;
      grid.position.z = (grid.position.z + dt * worldSpeed) % 2.5;
      const starAttr = starGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < 450; i++) {
        let z = starAttr.getZ(i) + dt * worldSpeed * 1.4;
        if (z > 8) z = -90;
        starAttr.setZ(i, z);
      }
      starAttr.needsUpdate = true;

      // Spawn enemies
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnEnemy();
        const baseInterval = difficultyRef.current === 'hyperdrive' ? 0.45 : 0.68;
        spawnTimer = Math.max(0.22, baseInterval - localWave * 0.045);
      }

      // Move bolts & collide
      for (const b of bolts) {
        if (!b.active) continue;
        b.mesh.position.z -= 58 * dt;
        if (b.mesh.position.z < -84) {
          b.active = false;
          b.mesh.visible = false;
          continue;
        }
        for (const e of enemies) {
          if (!e.active) continue;
          if (b.mesh.position.distanceTo(e.mesh.position) < 1.05) {
            b.active = false;
            b.mesh.visible = false;
            e.hp -= 1;
            if (e.hp <= 0) {
              e.active = false;
              e.mesh.visible = false;
              spawnBurst(e.mesh.position, 9);
              synthRef.current.playDestroy();
              localScore += 100 * localCombo;
              localCombo = Math.min(8, localCombo + 1);
              setScore(localScore);
              setCombo(localCombo);
            } else {
              spawnBurst(b.mesh.position, 4);
            }
            break;
          }
        }
      }

      // Move enemies & player collision
      for (const e of enemies) {
        if (!e.active) continue;
        e.mesh.position.z += e.speed * dt;
        e.mesh.rotation.x += e.rotSpeed * dt;
        e.mesh.rotation.y += e.rotSpeed * 0.7 * dt;

        if (e.mesh.position.distanceTo(player.position) < 1.05) {
          e.active = false;
          e.mesh.visible = false;
          spawnBurst(e.mesh.position, 12);
          synthRef.current.playHit();
          localShield = Math.max(0, localShield - 25);
          localCombo = 1;
          shake = 0.35;
          hitstop = 0.035;
          setShield(localShield);
          setCombo(1);
          if (localShield <= 0) {
            setPhase('gameover');
            setBestScore((prev) => {
              const best = Math.max(prev, localScore);
              try {
                localStorage.setItem('scopex_aegis_best', String(best));
              } catch {
                // Ignore storage errors
              }
              return best;
            });
          }
        } else if (e.mesh.position.z > 6) {
          e.active = false;
          e.mesh.visible = false;
        }
      }

      // Sparks
      for (const sp of sparks) {
        if (sp.life <= 0) continue;
        sp.life -= dt;
        sp.mesh.position.x += sp.vx * dt;
        sp.mesh.position.y += sp.vy * dt;
        sp.mesh.position.z += sp.vz * dt;
        if (sp.life <= 0) sp.mesh.visible = false;
      }

      // Smooth camera follow + subtle shake
      shake = Math.max(0, shake - dt * 1.4);
      const sx = (Math.random() - 0.5) * shake;
      const sy = (Math.random() - 0.5) * shake;
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, shipX * 0.38, 0.1) + sx;
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, 3.3 + shipY * 0.3, 0.1) + sy;
      camera.lookAt(shipX * 0.2, shipY * 0.25, -14);

      renderer.render(scene, camera);
      justPressed.clear();
    };
    tick();

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
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => m?.dispose());
        }
      });
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [togglePause]);

  useEffect(() => {
    const synth = synthRef.current;
    return () => synth.dispose();
  }, []);

  return (
    <div className="relative h-full w-full bg-[#040711] overflow-hidden select-none">
      <div ref={mountRef} className="w-full h-full" />

      {/* Minimal Top HUD during Playing / Paused */}
      {phase !== 'title' && (
        <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-3 pointer-events-none z-10">
          <div className="flex items-center gap-3 px-3.5 py-1.5 rounded-lg bg-[#090F1D]/90 border border-white/10 pointer-events-auto">
            <div className="text-xs font-mono tabular-nums">
              <span className="text-slate-400">SCORE </span>
              <span className="text-white font-bold">{score.toLocaleString()}</span>
            </div>
            <div className="text-xs font-mono tabular-nums">
              <span className="text-slate-400">x</span>
              <span className="text-blue-400 font-bold">{combo}</span>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-300">
              WAVE {wave}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-slate-400">SHIELD</span>
              <svg width="72" height="8" viewBox="0 0 72 8" className="rounded overflow-hidden">
                <rect width="72" height="8" fill="#1e293b" />
                <rect
                  width={(72 * shield) / 100}
                  height="8"
                  fill={shield > 45 ? '#38bdf8' : shield > 25 ? '#f59e0b' : '#ef4444'}
                />
              </svg>
            </div>
          </div>

          <div className="flex items-center gap-1.5 pointer-events-auto">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              title={muted ? 'Unmute SFX' : 'Mute SFX'}
              className="p-2 rounded-lg bg-[#090F1D]/90 border border-white/10 text-slate-200 hover:text-white"
            >
              {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={togglePause}
              title="Pause (P)"
              className="p-2 rounded-lg bg-[#090F1D]/90 border border-white/10 text-slate-200 hover:text-white"
            >
              {phase === 'paused' ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => startMissionRef.current?.()}
              title="Restart (R)"
              className="p-2 rounded-lg bg-[#090F1D]/90 border border-white/10 text-slate-200 hover:text-white"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Title Screen */}
      {phase === 'title' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20">
          <div className="bg-[#090F1D]/92 border border-white/12 rounded-2xl p-6 md:p-8 max-w-md w-full space-y-5">
            <svg width="56" height="56" viewBox="0 0 64 64" className="mx-auto">
              <polygon
                points="32,6 56,50 32,40 8,50"
                fill="#0f172a"
                stroke="#38bdf8"
                strokeWidth="2.5"
              />
              <circle cx="32" cy="30" r="6" fill="#38bdf8" />
            </svg>

            <div className="space-y-1.5">
              <h1 className="font-display text-3xl font-bold tracking-tight text-white">
                AEGIS INTERCEPT
              </h1>
              <p className="text-xs text-slate-400">
                High-velocity 3D orbital trench interceptor
              </p>
            </div>

            {bestScore > 0 && (
              <div className="text-xs font-mono text-blue-300 tabular-nums">
                Personal Best: {bestScore.toLocaleString()}
              </div>
            )}

            <div className="flex items-center justify-center gap-2">
              {(['standard', 'hyperdrive'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDifficulty(mode)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                    difficulty === mode
                      ? 'bg-blue-600 text-white'
                      : 'bg-white/[0.06] text-slate-300 hover:text-white'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => startMissionRef.current?.()}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white transition-colors"
            >
              Launch Mission
            </button>

            <p className="text-[11px] font-mono text-slate-400">
              WASD / Arrows move · Space fire · P pause · R restart
            </p>
          </div>
        </div>
      )}

      {/* Paused Overlay */}
      {phase === 'paused' && (
        <div className="absolute inset-0 flex items-center justify-center p-6 z-20">
          <div className="bg-[#090F1D]/95 border border-white/15 rounded-2xl p-6 w-full max-w-xs text-center space-y-4">
            <h2 className="font-display text-xl font-bold text-white">Mission Paused</h2>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={togglePause}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={() => startMissionRef.current?.()}
                className="w-full py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-sm font-medium text-slate-200"
              >
                Restart
              </button>
              <button
                type="button"
                onClick={() => setPhase('title')}
                className="w-full py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                Return to Title
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Over Overlay */}
      {phase === 'gameover' && (
        <div className="absolute inset-0 flex items-center justify-center p-6 z-20">
          <div className="bg-[#090F1D]/95 border border-rose-500/30 rounded-2xl p-6 w-full max-w-sm text-center space-y-4">
            <h2 className="font-display text-2xl font-bold text-white">Shield Depleted</h2>
            <div className="grid grid-cols-2 gap-3 text-left bg-[#040711] rounded-xl p-3 border border-white/10">
              <div>
                <div className="text-[11px] text-slate-400">Final Score</div>
                <div className="text-lg font-mono font-bold text-white tabular-nums">
                  {score.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Best Score</div>
                <div className="text-lg font-mono font-bold text-blue-400 tabular-nums">
                  {bestScore.toLocaleString()}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => startMissionRef.current?.()}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white"
              >
                Play Again (R)
              </button>
              <button
                type="button"
                onClick={() => setPhase('title')}
                className="px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-slate-200"
              >
                Title
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
