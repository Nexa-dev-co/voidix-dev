'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SUN_VERTEX_SHADER, SUN_FRAGMENT_SHADER } from './sunShaders';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT } from '@/components/sections/ServicesDeck/deckEvents';

const SUN_RADIUS     = 0.76;
const CAMERA_FOV     = 35;
const CAMERA_Z       = 3;
const ROTATION_SPEED = 0.0018;

// ── Services-only energy ──────────────────────────────────────────────
// In the services section the sun keeps its normal size, but its spin follows a rhythm: calm for
// SUN_IDLE_SECONDS, then a quick fast spin for SUN_SPIN_SECONDS, repeating. `intensity` ramps
// 0→1 on DECK_REVEAL_EVENT and back on DECK_HIDE_EVENT; everywhere else the sun stays calm.
const INTENSITY_LERP        = 0.05; // how fast it eases into / out of the energised state
const SUN_IDLE_SECONDS      = 10;   // calm stretch before each fast spin
const SUN_SPIN_SECONDS      = 2;    // length of the fast spin
const SUN_SPIN_SPEEDUP      = 9;    // how much faster it spins/churns during the spin window
const SUN_SPIN_RAMP_SECONDS = 0.35; // ease in/out of the spin so it isn't a hard switch
const SERVICES_RENDER_SCALE = 1;    // backing-resolution multiplier in services (raise only if the sun is swelled again — at normal size 1 is enough)
const MAX_FRAME_SECONDS     = 0.05; // clamp dt so a tab-restore doesn't fling the surface

// Procedural plasma-star surface (see sunShaders.ts). A hot star is genuinely
// photorealistic in this blue/cyan range, so this stays on-brand while reading
// as a real, churning star. Swap these three for warm tones (e.g. core 0xfff2c8 /
// mid 0xff8a2b / deep 0x6e1f02) to make it a classic orange sun instead.
const SUN_COLOR_CORE = 0xd8f6ff; // white-hot brightest granules
const SUN_COLOR_MID  = 0x00d9ff; // electric-cyan plasma body (brand accent)
const SUN_COLOR_DEEP = 0x012b52; // deep-blue convection troughs
const NOISE_SCALE      = 2.4;
const FLOW_SPEED       = 0.5;
const SURFACE_CONTRAST = 1.35;

export default function SunCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // The surface is procedural, so it stays sharp at any scale without texture
    // supersampling — a plain DPR clamp keeps the fragment shader affordable when
    // the scroll expansion blows the sun up to fill the hero.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const initialWidth  = canvas.clientWidth  || canvas.offsetWidth  || 900;
    const initialHeight = canvas.clientHeight || canvas.offsetHeight || 300;
    renderer.setSize(initialWidth, initialHeight, false);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, initialWidth / initialHeight, 0.1, 100);
    camera.position.z = CAMERA_Z;

    // ── Sun sphere — procedural plasma surface ─────────────────────
    const sunUniforms = {
      uTime:       { value: 0 },
      uColorCore:  { value: new THREE.Color(SUN_COLOR_CORE) },
      uColorMid:   { value: new THREE.Color(SUN_COLOR_MID) },
      uColorDeep:  { value: new THREE.Color(SUN_COLOR_DEEP) },
      uNoiseScale: { value: NOISE_SCALE },
      uFlowSpeed:  { value: FLOW_SPEED },
      uContrast:   { value: SURFACE_CONTRAST },
      uIntensity:  { value: 0 },
    };

    const sunGeo = new THREE.SphereGeometry(SUN_RADIUS, 64, 64);
    const sunMat = new THREE.ShaderMaterial({
      vertexShader:   SUN_VERTEX_SHADER,
      fragmentShader: SUN_FRAGMENT_SHADER,
      uniforms:       sunUniforms,
    });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    scene.add(sunMesh);

    // ── Resize (also re-applied on services enter/leave to change the render resolution) ──
    let renderScale = 1; // 1 = calm/low-res; SERVICES_RENDER_SCALE in services so the big sun is crisp
    const applySize = () => {
      const width  = canvas.clientWidth  || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      // Backing store = CSS size × DPR × renderScale. In services the layer is CSS-scaled up, so
      // the extra backing resolution keeps the enlarged sun sharp instead of upscaling a small one.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * renderScale);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(applySize);
    observer.observe(canvas.parentElement ?? canvas);

    // ── Services energy state ──────────────────────────────────────
    let targetIntensity = 0;
    const energise = () => {
      targetIntensity = 1;
      renderScale = SERVICES_RENDER_SCALE; // render at high res so the enlarged sun stays sharp
      applySize();
    };
    const deEnergise = () => {
      targetIntensity = 0;
      renderScale = 1;
      applySize();
    };
    window.addEventListener(DECK_REVEAL_EVENT, energise);
    window.addEventListener(DECK_HIDE_EVENT, deEnergise);

    // ── Render loop ────────────────────────────────────────────────
    const clock = new THREE.Clock();
    let flowTime = 0;   // "surface time"; sprints during the fast-spin window so the plasma churns faster
    let intensity = 0;  // eased toward targetIntensity each frame
    let cycleTime = 0;  // position within the idle→spin rhythm (only advances while energised)
    let rafId: number;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const deltaSeconds = Math.min(clock.getDelta(), MAX_FRAME_SECONDS);

      intensity += (targetIntensity - intensity) * INTENSITY_LERP;

      // Spin rhythm: calm through the idle stretch, then a fast spin, repeating. Reset the cycle
      // whenever we're not energised so services always opens with the calm stretch.
      if (intensity > 0.001) {
        cycleTime += deltaSeconds;
      } else {
        cycleTime = 0;
      }
      const cyclePosition = cycleTime % (SUN_IDLE_SECONDS + SUN_SPIN_SECONDS);
      let spinEnvelope = 0;
      if (cyclePosition > SUN_IDLE_SECONDS) {
        const intoSpin = cyclePosition - SUN_IDLE_SECONDS; // 0..SUN_SPIN_SECONDS
        // trapezoid: ramp up over RAMP, hold fast, ramp down over RAMP
        spinEnvelope = Math.max(
          0,
          Math.min(1, Math.min(intoSpin, SUN_SPIN_SECONDS - intoSpin) / SUN_SPIN_RAMP_SECONDS),
        );
      }

      // At rest (intensity 0, or the idle stretch) the multiplier is 1, so the hero/intro sun is
      // unchanged and the services sun only sprints during the spin window.
      const speedMultiplier = 1 + intensity * spinEnvelope * SUN_SPIN_SPEEDUP;
      // Freeze BOTH the surface churn AND the sphere's spin once energised, so the sun reads as
      // perfectly STILL in the services / works / flight section (a look-around in the field never
      // moves it). Only the calm hero sun animates. `stillness` eases 1 → 0 as the sun energises.
      const stillness = Math.max(0, 1 - intensity * 1.5);
      flowTime += deltaSeconds * speedMultiplier * stillness;
      sunMesh.rotation.y += ROTATION_SPEED * speedMultiplier * stillness;

      sunUniforms.uTime.value = flowTime;
      sunUniforms.uIntensity.value = intensity;
      // The sun is on screen for the whole journey (it's the hero centrepiece, and it stays visible
      // behind the fleet/field), so it only skips drawing when the tab is backgrounded.
      if (!document.hidden) renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener(DECK_REVEAL_EVENT, energise);
      window.removeEventListener(DECK_HIDE_EVENT, deEnergise);
      renderer.dispose();
      sunGeo.dispose();
      sunMat.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="sun-canvas" />;
}
