'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  createHeroWorkbenchClock,
  createWorkbenchLayerConfigs,
  heroWorkbenchMetrics,
  type WorkbenchLayerConfig,
} from './hero-workbench-scene-model';

type ThreeModule = typeof import('three');
type Disposable = { dispose: () => void };

interface HeroWorkbenchSceneProps {
  className?: string;
}

export function HeroWorkbenchScene({ className }: HeroWorkbenchSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [isReady, setIsReady] = useState(false);
  const layers = useMemo(() => createWorkbenchLayerConfigs(), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const matchesMedia = (query: string) =>
      typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
    const smallViewport = matchesMedia('(max-width: 767px)');
    if (smallViewport) return;

    let disposed = false;
    let animationFrame = 0;
    let renderer: import('three').WebGLRenderer | null = null;
    const disposables: Disposable[] = [];

    const reducedMotion = matchesMedia('(prefers-reduced-motion: reduce)');

    const handlePointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      pointerRef.current = {
        x: (event.clientX - rect.left) / rect.width - 0.5,
        y: (event.clientY - rect.top) / rect.height - 0.5,
      };
    };

    const start = async () => {
      const THREE = await import('three');
      if (disposed || !mountRef.current) return;

      try {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
          34,
          mount.clientWidth / Math.max(mount.clientHeight, 1),
          0.1,
          100
        );
        camera.position.set(0, 0.28, heroWorkbenchMetrics.cameraDistance);

        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        });
        renderer.setClearAlpha(0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.className =
          'h-full w-full opacity-0 transition-opacity duration-700';
        mount.appendChild(renderer.domElement);

        const ambient = new THREE.AmbientLight(0xffffff, 1.9);
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(2.4, 3.2, 4.8);
        const rim = new THREE.DirectionalLight(0x7cf8b3, 1.4);
        rim.position.set(-3, -1, 3);
        scene.add(ambient, key, rim);

        const rig = new THREE.Group();
        scene.add(rig);

        const orbitRings = buildOrbitRings(THREE, rig, disposables);
        const signalRibbons = buildSignalRibbons(THREE, rig, disposables);
        buildParticleField(THREE, rig, disposables);
        const coreGroup = buildCore(THREE, rig, disposables);
        const fileMeshes = buildFileLayers(THREE, rig, layers, disposables);
        const dataBeams = buildDataBeams(THREE, rig, fileMeshes, disposables);

        const resizeScene = (width: number, height: number) => {
          if (!renderer) return;
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        };
        const handleWindowResize = () => {
          const rect = mount.getBoundingClientRect();
          resizeScene(rect.width, rect.height);
        };
        const resizeObserver =
          typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(entries => {
                const entry = entries[0];
                if (!entry) return;
                const { width, height } = entry.contentRect;
                resizeScene(width, height);
              })
            : null;

        if (resizeObserver) {
          resizeObserver.observe(mount);
        } else {
          window.addEventListener('resize', handleWindowResize);
        }

        mount.addEventListener('pointermove', handlePointerMove);
        setIsReady(true);
        requestAnimationFrame(() => {
          if (renderer?.domElement) renderer.domElement.style.opacity = '1';
        });

        const clock = createHeroWorkbenchClock();
        const scheduleNextFrame = () => {
          if (!reducedMotion && !animationFrame) {
            animationFrame = requestAnimationFrame(render);
          }
        };
        const handleVisibilityChange = () => {
          clock.reset(performance.now());
          if (document.visibilityState === 'visible') {
            scheduleNextFrame();
          }
        };
        const render = () => {
          animationFrame = 0;
          const now = performance.now();
          if (document.visibilityState !== 'visible') {
            clock.reset(now);
            scheduleNextFrame();
            return;
          }

          const elapsed = clock.tick(now);
          const pointer = pointerRef.current;

          rig.rotation.y +=
            ((reducedMotion ? -0.22 : elapsed * 0.16 + pointer.x * 0.24) -
              rig.rotation.y) *
            0.035;
          rig.rotation.x +=
            ((reducedMotion ? 0.08 : -pointer.y * 0.16) - rig.rotation.x) *
            0.04;

          const pulse = 1 + Math.sin(elapsed * 2.4) * 0.035;
          coreGroup.scale.setScalar(reducedMotion ? 1.02 : pulse);
          orbitRings.forEach((ring, index) => {
            ring.rotation.z = elapsed * (0.06 + index * 0.018);
          });
          signalRibbons.forEach((ribbon, index) => {
            ribbon.rotation.y = elapsed * (0.22 + index * 0.045);
            ribbon.rotation.z = Math.sin(elapsed * 0.7 + index) * 0.08;
            const material =
              ribbon.material as import('three').MeshBasicMaterial;
            material.opacity = 0.12 + Math.sin(elapsed * 1.4 + index) * 0.04;
          });
          dataBeams.forEach((beam, index) => {
            const material = beam.material as import('three').LineBasicMaterial;
            material.opacity = 0.12 + Math.sin(elapsed * 1.8 + index) * 0.07;
          });

          fileMeshes.forEach(mesh => {
            const lift = Math.sin(elapsed * 0.9 + mesh.userData.phase) * 0.07;
            mesh.position.y = mesh.userData.baseY + lift;
            mesh.lookAt(camera.position);
          });

          renderer?.render(scene, camera);
          scheduleNextFrame();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        render();

        return () => {
          resizeObserver?.disconnect();
          window.removeEventListener('resize', handleWindowResize);
          mount.removeEventListener('pointermove', handlePointerMove);
          document.removeEventListener(
            'visibilitychange',
            handleVisibilityChange
          );
        };
      } catch (error) {
        void error;
        if (renderer?.domElement.parentElement) {
          renderer.domElement.parentElement.removeChild(renderer.domElement);
        }
        renderer?.dispose();
        disposables.forEach(item => item.dispose());
        setIsReady(false);
        return undefined;
      }
    };

    let stopScene: (() => void) | undefined;
    start().then(cleanup => {
      stopScene = cleanup;
    });

    return () => {
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      stopScene?.();
      if (renderer?.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      renderer?.dispose();
      disposables.forEach(item => item.dispose());
      setIsReady(false);
    };
  }, [layers]);

  return (
    <div
      className={cn(
        'relative min-h-[300px] overflow-hidden rounded-md border border-border bg-card/80 shadow-[0_34px_110px_-56px_color-mix(in_oklch,var(--accent)_82%,transparent)] backdrop-blur md:min-h-[430px]',
        className
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_48%_36%,color-mix(in_oklch,var(--accent)_28%,transparent),transparent_48%),radial-gradient(circle_at_72%_72%,oklch(0.72_0.13_210_/_0.16),transparent_42%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:34px_34px]"
      />
      <div
        ref={mountRef}
        aria-hidden
        className="absolute inset-0 hidden md:block"
      />

      <div className="pointer-events-none absolute inset-0 md:hidden">
        <MobileWorkbenchLayers layers={layers} />
      </div>

      <div className="absolute left-4 top-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full bg-accent',
            isReady && 'animate-pulse motion-reduce:animate-none'
          )}
        />
        Processing core
      </div>

      <div className="absolute bottom-4 left-4 right-4 grid grid-cols-3 gap-px overflow-hidden rounded border border-border bg-border font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {['Local', 'Server', 'Preview'].map(item => (
          <div key={item} className="bg-background/70 px-3 py-2 backdrop-blur">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function buildCore(
  THREE: ThreeModule,
  rig: import('three').Group,
  disposables: Disposable[]
) {
  const coreGroup = new THREE.Group();
  const geometry = new THREE.IcosahedronGeometry(0.72, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x6ef5a3,
    emissive: 0x0d5f3b,
    emissiveIntensity: 0.52,
    metalness: 0.28,
    roughness: 0.42,
    transparent: true,
    opacity: 0.78,
  });
  const core = new THREE.Mesh(geometry, material);
  coreGroup.add(core);

  const wireGeometry = new THREE.IcosahedronGeometry(0.86, 1);
  const wireMaterial = new THREE.MeshBasicMaterial({
    color: 0xcfffe2,
    wireframe: true,
    transparent: true,
    opacity: 0.32,
  });
  const wire = new THREE.Mesh(wireGeometry, wireMaterial);
  coreGroup.add(wire);
  rig.add(coreGroup);
  disposables.push(geometry, material, wireGeometry, wireMaterial);
  return coreGroup;
}

function buildOrbitRings(
  THREE: ThreeModule,
  rig: import('three').Group,
  disposables: Disposable[]
) {
  const material = new THREE.MeshBasicMaterial({
    color: 0x9afac0,
    transparent: true,
    opacity: 0.18,
  });

  const rings = [0, Math.PI / 2.7, -Math.PI / 3.4].map((rotation, index) => {
    const geometry = new THREE.TorusGeometry(
      heroWorkbenchMetrics.orbitRadius - index * 0.22,
      0.006,
      8,
      160
    );
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.y = rotation;
    rig.add(ring);
    disposables.push(geometry);
    return ring;
  });
  disposables.push(material);
  return rings;
}

function buildSignalRibbons(
  THREE: ThreeModule,
  rig: import('three').Group,
  disposables: Disposable[]
) {
  return [138, 186, 48].map((hue, ribbonIndex) => {
    const points: import('three').Vector3[] = [];
    const radius = 1.18 + ribbonIndex * 0.26;
    const phase = ribbonIndex * 0.82;

    for (let index = 0; index < 96; index += 1) {
      const t = (index / 95) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          Math.cos(t + phase) * radius,
          Math.sin(t * 2 + phase) * (0.32 + ribbonIndex * 0.03),
          Math.sin(t + phase) * radius * 0.62
        )
      );
    }

    const curve = new THREE.CatmullRomCurve3(points, true);
    const geometry = new THREE.TubeGeometry(curve, 96, 0.009, 6, true);
    const color = new THREE.Color().setHSL(hue / 360, 0.72, 0.62);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ribbon = new THREE.Mesh(geometry, material);
    ribbon.rotation.x = Math.PI / 2.5 - ribbonIndex * 0.18;
    rig.add(ribbon);
    disposables.push(geometry, material);
    return ribbon;
  });
}

function buildParticleField(
  THREE: ThreeModule,
  rig: import('three').Group,
  disposables: Disposable[]
) {
  const count = 190;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.399963;
    const radius = 1.5 + ((index * 37) % 100) / 48;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(index * 1.7) * 1.18;
    positions[index * 3 + 2] = Math.sin(angle) * radius * 0.62;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xdafbe8,
    size: 0.02,
    transparent: true,
    opacity: 0.52,
  });
  rig.add(new THREE.Points(geometry, material));
  disposables.push(geometry, material);
}

function buildDataBeams(
  THREE: ThreeModule,
  rig: import('three').Group,
  fileMeshes: import('three').Mesh[],
  disposables: Disposable[]
) {
  return fileMeshes.slice(0, 6).map((mesh, index) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(
        mesh.position.x * 0.74,
        mesh.position.y,
        mesh.position.z
      ),
    ]);
    const material = new THREE.LineBasicMaterial({
      color: index % 2 === 0 ? 0x8bf7b6 : 0x80d9ff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beam = new THREE.Line(geometry, material);
    rig.add(beam);
    disposables.push(geometry, material);
    return beam;
  });
}

function buildFileLayers(
  THREE: ThreeModule,
  rig: import('three').Group,
  layers: WorkbenchLayerConfig[],
  disposables: Disposable[]
) {
  const geometry = new THREE.PlaneGeometry(1.18, 0.74);
  disposables.push(geometry);

  return layers.map((config, index) => {
    const texture = createLayerTexture(THREE, config);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const angle = (index / layers.length) * Math.PI * 2;
    const radius = heroWorkbenchMetrics.orbitRadius;
    const baseY = Math.sin(config.phase) * 0.42;

    mesh.position.set(
      Math.cos(angle) * radius,
      baseY,
      Math.sin(angle) * radius * 0.58
    );
    mesh.userData.baseY = baseY;
    mesh.userData.phase = config.phase;
    mesh.scale.setScalar(config.label.length > 3 ? 0.86 : 1);
    rig.add(mesh);
    disposables.push(texture, material);
    return mesh;
  });
}

function createLayerTexture(THREE: ThreeModule, config: WorkbenchLayerConfig) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawRoundedRect(ctx, 18, 18, 348, 204, 18);
  ctx.fillStyle = 'rgba(8, 18, 14, 0.72)';
  ctx.fill();
  ctx.strokeStyle = `hsla(${config.hue}, 72%, 72%, 0.58)`;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = `hsla(${config.hue}, 72%, 62%, 0.95)`;
  ctx.fillRect(42, 48, 84, 8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.fillRect(42, 74, 180, 6);
  ctx.fillRect(42, 96, 132, 6);
  ctx.fillRect(42, 118, 210, 6);

  ctx.font = '700 58px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = 'rgba(245, 255, 250, 0.94)';
  ctx.fillText(config.label, 42, 188);

  ctx.font = '500 22px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = `hsla(${config.hue}, 72%, 72%, 0.9)`;
  ctx.fillText(config.type.toUpperCase(), 220, 188);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function MobileWorkbenchLayers({ layers }: { layers: WorkbenchLayerConfig[] }) {
  return (
    <div className="relative h-full">
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/40 bg-accent/10 shadow-[0_0_48px_color-mix(in_oklch,var(--accent)_32%,transparent)]" />
      {layers.slice(0, 5).map((layer, index) => (
        <div
          key={layer.label}
          className="absolute rounded border border-border bg-background/75 px-3 py-2 font-mono text-xs text-foreground shadow-sm backdrop-blur"
          style={{
            left: `${18 + ((index * 19) % 62)}%`,
            top: `${24 + ((index * 23) % 48)}%`,
          }}
        >
          {layer.label}
        </div>
      ))}
    </div>
  );
}
