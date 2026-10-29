"use client";

import { useEffect, useRef, useState } from "react";

export type BlazeMood = "idle" | "listening" | "thinking" | "talking" | "happy";

type ChefAvatarProps = {
  mood?: BlazeMood;
  className?: string;
  /** Lower pixel ratio and simpler pointer tracking for small surfaces. */
  compact?: boolean;
  /** Accessible label for the canvas stage. */
  label?: string;
};

const SKIN = 0xf2b287;
const SKIN_SHADE = 0xe29a6d;
const JACKET = 0xfbf7ef;
const JACKET_SHADE = 0xece3d4;
const ACCENT = 0xd63a2f;
const HAIR = 0x41281c;
const MOUTH = 0x5c231d;

type ThreeModule = typeof import("three");

type SceneRefs = {
  THREE: ThreeModule;
  renderer: import("three").WebGLRenderer;
  scene: import("three").Scene;
  camera: import("three").PerspectiveCamera;
  root: import("three").Group;
  head: import("three").Group;
  hat: import("three").Group;
  eyes: import("three").Group[];
  brows: import("three").Mesh[];
  mouth: import("three").Mesh;
  jaw: import("three").Group;
  torso: import("three").Group;
  gaze: { x: number; y: number };
  targetGaze: { x: number; y: number };
  blinkAt: number;
  blinkPhase: number;
  mood: BlazeMood;
  reducedMotion: boolean;
};

function roundedRectTexture(THREE: ThreeModule) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, "rgba(60, 26, 12, 0.38)");
    gradient.addColorStop(0.55, "rgba(60, 26, 12, 0.16)");
    gradient.addColorStop(1, "rgba(60, 26, 12, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function material(THREE: ThreeModule, color: number, roughness = 0.62) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function sphere(
  THREE: ThreeModule,
  radius: number,
  mat: import("three").Material,
  segments = 40
) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(18, segments / 2)), mat);
}

export default function ChefAvatar({
  mood = "idle",
  className = "",
  compact = false,
  label = "Blaze, the Pizza Blitz ordering chef",
}: ChefAvatarProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const moodRef = useRef<BlazeMood>(mood);
  const refs = useRef<SceneRefs | null>(null);
  const [failed, setFailed] = useState(false);

  moodRef.current = mood;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let frame = 0;
    let visible = true;
    let listenerCleanup: (() => void) | null = null;

    const start = async () => {
      const THREE = await import("three");
      if (disposed || !hostRef.current) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: !compact,
          powerPreference: "high-performance",
        });
      } catch {
        setFailed(true);
        return;
      }

      const width = host.clientWidth || 360;
      const height = host.clientHeight || 420;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.4 : 1.8));
      renderer.setSize(width, height, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.04;
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 30);
      const frameCamera = (nextWidth: number, nextHeight: number) => {
        const aspect = nextWidth / Math.max(nextHeight, 1);
        if (aspect > 1.55) {
          // Wide hero band: crop to a portrait so the face stays expressive.
          camera.position.set(0, 0.86, 3.55);
          camera.lookAt(0, 0.72, 0);
        } else {
          camera.position.set(0, 0.58, 4.75);
          camera.lookAt(0, 0.52, 0);
        }
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      };
      frameCamera(width, height);

      const root = new THREE.Group();
      root.position.y = -0.02;
      scene.add(root);

      // Lighting: warm key, cool fill, branded rim.
      scene.add(new THREE.HemisphereLight(0xfff1e0, 0xa9522c, 0.72));
      const key = new THREE.DirectionalLight(0xffe2be, 2.5);
      key.position.set(2.6, 3.4, 3.2);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xbdd7ff, 0.85);
      fill.position.set(-3.4, 1.2, 2.4);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xff8a5c, 1.65);
      rim.position.set(-0.6, 2.2, -3.4);
      scene.add(rim);
      const bounce = new THREE.PointLight(0xffb27d, 12, 7, 2);
      bounce.position.set(0, -0.6, 2.4);
      scene.add(bounce);

      const skin = material(THREE, SKIN, 0.55);
      const skinShade = material(THREE, SKIN_SHADE, 0.58);
      const jacket = material(THREE, JACKET, 0.75);
      const jacketShade = material(THREE, JACKET_SHADE, 0.8);
      const accent = material(THREE, ACCENT, 0.5);
      const hair = material(THREE, HAIR, 0.7);
      const eyeWhite = new THREE.MeshStandardMaterial({
        color: 0xfffdf8,
        roughness: 0.28,
        metalness: 0,
      });
      const iris = new THREE.MeshStandardMaterial({
        color: 0x3b2417,
        roughness: 0.25,
        metalness: 0.05,
      });
      const pupil = new THREE.MeshBasicMaterial({ color: 0x160d08 });
      const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mouthMat = new THREE.MeshStandardMaterial({
        color: MOUTH,
        roughness: 0.85,
      });
      const blush = new THREE.MeshStandardMaterial({
        color: 0xea8d74,
        roughness: 1,
        transparent: true,
        opacity: 0.32,
      });

      // Torso: lathed chef jacket with soft shoulders.
      const torso = new THREE.Group();
      const profile: import("three").Vector2[] = [
        new THREE.Vector2(0.02, -1.22),
        new THREE.Vector2(0.62, -1.18),
        new THREE.Vector2(0.76, -0.92),
        new THREE.Vector2(0.82, -0.58),
        new THREE.Vector2(0.74, -0.26),
        new THREE.Vector2(0.55, -0.04),
        new THREE.Vector2(0.3, 0.08),
      ];
      const torsoMesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 56), jacket);
      torsoMesh.scale.z = 0.62;
      torso.add(torsoMesh);

      // Jacket seam and buttons.
      const placket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 0.05), jacketShade);
      placket.position.set(0, -0.63, 0.455);
      placket.rotation.x = -0.12;
      torso.add(placket);
      for (let row = 0; row < 3; row += 1) {
        for (const side of [-1, 1]) {
          const button = sphere(THREE, 0.031, accent, 16);
          button.position.set(side * 0.11, -0.36 - row * 0.22, 0.47 - row * 0.012);
          button.scale.z = 0.6;
          torso.add(button);
        }
      }

      // Shoulders for silhouette.
      for (const side of [-1, 1]) {
        const shoulder = sphere(THREE, 0.3, jacket, 32);
        shoulder.position.set(side * 0.62, -0.24, 0.02);
        shoulder.scale.set(1, 0.86, 0.9);
        torso.add(shoulder);
      }

      // Neckerchief.
      const scarf = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.4, 0.2, 40, 1, true), accent);
      scarf.position.y = -0.02;
      torso.add(scarf);
      const knot = sphere(THREE, 0.085, accent, 24);
      knot.position.set(0.06, -0.02, 0.34);
      torso.add(knot);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.05), accent);
      tail.position.set(0.16, -0.18, 0.34);
      tail.rotation.z = -0.28;
      torso.add(tail);
      const tail2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.05), accent);
      tail2.position.set(-0.03, -0.16, 0.36);
      tail2.rotation.z = 0.16;
      torso.add(tail2);
      root.add(torso);

      // Neck.
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.26, 32), skinShade);
      neck.position.y = 0.14;
      root.add(neck);

      // Head group so it can nod, tilt and track.
      const head = new THREE.Group();
      head.position.set(0, 0.66, 0);
      root.add(head);

      const skull = sphere(THREE, 0.56, skin, 56);
      skull.scale.set(1, 0.95, 0.9);
      head.add(skull);

      // Ears.
      for (const side of [-1, 1]) {
        const ear = sphere(THREE, 0.12, skinShade, 24);
        ear.position.set(side * 0.54, -0.02, 0.02);
        ear.scale.set(0.55, 0.9, 0.8);
        head.add(ear);
      }

      // Nose.
      const nose = sphere(THREE, 0.115, skinShade, 28);
      nose.position.set(0, -0.04, 0.5);
      nose.scale.set(0.95, 0.82, 1.05);
      head.add(nose);

      // Eyes with iris, pupil, glint, and a subtle lid line.
      const eyes: import("three").Group[] = [];
      for (const side of [-1, 1]) {
        const eye = new THREE.Group();
        eye.position.set(side * 0.195, 0.13, 0.435);
        const white = sphere(THREE, 0.098, eyeWhite, 32);
        white.scale.set(1, 1.12, 0.55);
        eye.add(white);
        const irisMesh = sphere(THREE, 0.05, iris, 24);
        irisMesh.position.set(side * 0.006, 0.004, 0.072);
        irisMesh.scale.z = 0.55;
        eye.add(irisMesh);
        const pupilMesh = sphere(THREE, 0.024, pupil, 16);
        pupilMesh.position.set(side * 0.006, 0.004, 0.098);
        pupilMesh.scale.z = 0.5;
        eye.add(pupilMesh);
        const glintMesh = sphere(THREE, 0.013, glint, 12);
        glintMesh.position.set(side * 0.006 + 0.022, 0.028, 0.112);
        eye.add(glintMesh);
        const lid = new THREE.Mesh(
          new THREE.TorusGeometry(0.095, 0.012, 8, 28, Math.PI),
          hair
        );
        lid.rotation.x = Math.PI / 2;
        lid.rotation.z = Math.PI;
        lid.position.set(0, 0.046, 0.058);
        lid.scale.set(1, 1, 0.7);
        eye.add(lid);
        eyes.push(eye);
        head.add(eye);
      }

      // Eyebrows.
      const brows: import("three").Mesh[] = [];
      for (const side of [-1, 1]) {
        const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.11, 6, 12), hair);
        brow.position.set(side * 0.2, 0.29, 0.44);
        brow.rotation.z = side * 0.18;
        brow.rotation.x = -0.18;
        brows.push(brow);
        head.add(brow);
      }

      // Cheeks.
      for (const side of [-1, 1]) {
        const cheek = sphere(THREE, 0.09, blush, 20);
        cheek.position.set(side * 0.3, -0.08, 0.4);
        cheek.scale.set(1, 0.6, 0.3);
        head.add(cheek);
      }

      // Mustache: two soft curls.
      for (const side of [-1, 1]) {
        const curl = sphere(THREE, 0.135, hair, 24);
        curl.position.set(side * 0.115, -0.135, 0.475);
        curl.scale.set(1.28, 0.42, 0.5);
        curl.rotation.z = side * 0.26;
        head.add(curl);
      }

      // Mouth + jaw for talking.
      const jaw = new THREE.Group();
      jaw.position.set(0, -0.22, 0.44);
      const mouth = sphere(THREE, 0.105, mouthMat, 28);
      mouth.scale.set(1.18, 0.26, 0.32);
      jaw.add(mouth);
      const lowerLip = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.1, 6, 10), skinShade);
      lowerLip.rotation.z = Math.PI / 2;
      lowerLip.position.set(0, -0.028, 0.02);
      jaw.add(lowerLip);
      head.add(jaw);

      // Toque.
      const hat = new THREE.Group();
      hat.position.set(0, 0.52, 0);
      hat.rotation.z = -0.05;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.19, 48), jacket);
      band.position.y = 0.0;
      hat.add(band);
      const bandShadow = new THREE.Mesh(new THREE.TorusGeometry(0.425, 0.018, 8, 48), jacketShade);
      bandShadow.rotation.x = Math.PI / 2;
      bandShadow.position.y = -0.085;
      hat.add(bandShadow);
      const puffLayout: [number, number, number, number][] = [
        [0, 0.36, 0, 0.31],
        [-0.24, 0.29, 0.05, 0.23],
        [0.24, 0.29, 0.05, 0.23],
        [-0.14, 0.3, -0.17, 0.22],
        [0.14, 0.32, -0.16, 0.21],
        [0, 0.28, 0.2, 0.23],
      ];
      for (const [x, y, z, radius] of puffLayout) {
        const puff = sphere(THREE, radius, jacket, 32);
        puff.position.set(x, y, z);
        puff.scale.y = 0.88;
        hat.add(puff);
      }
      head.add(hat);

      // Soft contact shadow.
      const shadowTexture = roundedRectTexture(THREE);
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 1.2),
        new THREE.MeshBasicMaterial({
          map: shadowTexture,
          transparent: true,
          depthWrite: false,
          opacity: 0.9,
        })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, -1.24, 0.1);
      root.add(shadow);

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const now = performance.now();
      refs.current = {
        THREE,
        renderer,
        scene,
        camera,
        root,
        head,
        hat,
        eyes,
        brows,
        mouth,
        jaw,
        torso,
        gaze: { x: 0, y: 0 },
        targetGaze: { x: 0, y: 0 },
        blinkAt: now + 2200,
        blinkPhase: -1,
        mood,
        reducedMotion,
      };

      // Pointer tracking.
      const onPointerMove = (event: PointerEvent) => {
        const current = refs.current;
        if (!current) return;
        const rect = host.getBoundingClientRect();
        const nx = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
        const ny = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1;
        current.targetGaze.x = Math.max(-1, Math.min(1, nx)) * 0.32;
        current.targetGaze.y = Math.max(-1, Math.min(1, ny)) * 0.2;
      };
      const onPointerLeave = () => {
        const current = refs.current;
        if (!current) return;
        current.targetGaze.x = 0;
        current.targetGaze.y = 0;
      };
      if (!reducedMotion && !compact) {
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        document.addEventListener("pointerleave", onPointerLeave);
        listenerCleanup = () => {
          window.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerleave", onPointerLeave);
        };
      }

      let resizeTimer = 0;
      const resize = () => {
        if (!refs.current) return;
        const nextWidth = host.clientWidth || width;
        const nextHeight = host.clientHeight || height;
        refs.current.renderer.setSize(nextWidth, nextHeight, false);
        frameCamera(nextWidth, nextHeight);
        refs.current.renderer.render(refs.current.scene, refs.current.camera);
      };
      const observer = new ResizeObserver(() => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(resize, 90);
      });
      observer.observe(host);

      const io = new IntersectionObserver(
        (entries) => {
          visible = entries[0]?.isIntersecting ?? true;
        },
        { threshold: 0.02 }
      );
      io.observe(host);

      const onVisibility = () => {
        if (document.hidden) {
          visible = false;
        }
      };
      document.addEventListener("visibilitychange", onVisibility);

      let last = performance.now();
      const animate = (time: number) => {
        if (disposed) return;
        frame = requestAnimationFrame(animate);
        const current = refs.current;
        if (!current) return;
        const delta = Math.min((time - last) / 1000, 0.05);
        last = time;
        if (!visible || document.hidden) {
          return;
        }
        if (current.reducedMotion) {
          head.rotation.set(0, 0, 0);
          mouth.scale.set(1.18, 0.26, 0.32);
          renderer.render(scene, camera);
          cancelAnimationFrame(frame);
          return;
        }

        const t = time / 1000;
        const activeMood = moodRef.current;
        const listening = activeMood === "listening";
        const thinking = activeMood === "thinking";
        const talking = activeMood === "talking";
        const happy = activeMood === "happy";

        // Gaze easing, plus idle drift.
        const gazeTargetX = thinking ? 0.22 : listening ? 0.04 : current.targetGaze.x;
        const gazeTargetY = thinking ? -0.26 : current.targetGaze.y;
        current.gaze.x += (gazeTargetX - current.gaze.x) * Math.min(delta * 7, 1);
        current.gaze.y += (gazeTargetY - current.gaze.y) * Math.min(delta * 7, 1);
        const drift = Math.sin(t * 0.42) * 0.035;
        head.rotation.y = current.gaze.x * 0.75 + drift;
        head.rotation.x = -current.gaze.y * 0.45 + (thinking ? -0.06 : 0);
        const tilt = listening ? 0.08 : thinking ? -0.07 : happy ? 0.03 : Math.sin(t * 0.6) * 0.012;
        head.rotation.z += (tilt - head.rotation.z) * Math.min(delta * 4, 1);

        // Breathing.
        const breath = 1 + Math.sin(t * 1.35) * 0.012;
        torso.scale.set(1, breath, 1);
        head.position.y = 0.66 + Math.sin(t * 1.35 + 0.6) * 0.012;
        hat.rotation.z = -0.05 + Math.sin(t * 1.1) * 0.02 + (happy ? 0.05 : 0);

        // Eyes: blink cycle, widening while listening.
        const nowMs = time;
        if (current.blinkPhase < 0 && nowMs >= current.blinkAt) {
          current.blinkPhase = 0;
        }
        let eyeScaleY = 1;
        if (current.blinkPhase >= 0) {
          current.blinkPhase += delta;
          const progress = current.blinkPhase / 0.16;
          if (progress >= 1) {
            current.blinkPhase = -1;
            current.blinkAt = nowMs + 2400 + Math.random() * 3400;
          } else {
            eyeScaleY = progress < 0.5 ? 1 - progress * 1.84 : 0.08 + (progress - 0.5) * 1.84;
          }
        }
        if (happy) eyeScaleY *= 0.78;
        if (listening) eyeScaleY *= 1.06;
        for (const eye of eyes) {
          eye.scale.y += (eyeScaleY - eye.scale.y) * Math.min(delta * 18, 1);
        }

        // Eyebrows: raised for listening, quizzical for thinking.
        const browLift = listening ? 0.022 : thinking ? 0.028 : talking ? 0.008 : 0;
        brows[0].position.y = 0.29 + browLift;
        brows[1].position.y = 0.29 + browLift;
        brows[0].rotation.z = 0.18 + (thinking ? 0.12 : 0);
        brows[1].rotation.z = -0.18 - (thinking ? 0.04 : 0);

        // Mouth: lip-sync while talking, warm smile otherwise.
        const talkEnvelope = talking
          ? 0.35 + 0.65 * Math.abs(Math.sin(t * 12.5) * Math.sin(t * 6.7 + 1.1))
          : 0;
        const smile = happy ? 1.22 : listening ? 1.05 : 1;
        const mouthTargetY = talking ? 0.24 + talkEnvelope * 0.72 : happy ? 0.34 : 0.26;
        mouth.scale.y += (mouthTargetY - mouth.scale.y) * Math.min(delta * 16, 1);
        mouth.scale.x += (1.18 * smile - mouth.scale.x) * Math.min(delta * 8, 1);
        jaw.position.y = -0.22 - (talking ? talkEnvelope * 0.02 : 0);
        jaw.position.z = 0.44 + Math.sin(t * 1.2) * 0.001;

        // Occasional playful nod while talking, slow nod while listening.
        head.position.y += talking ? Math.sin(t * 3.4) * 0.008 : 0;
        if (listening) {
          head.position.y += Math.sin(t * 2.2) * 0.006;
        }

        renderer.render(scene, camera);
      };
      frame = requestAnimationFrame(animate);

      listenerCleanup = (() => {
        const previous = listenerCleanup;
        return () => {
          previous?.();
          observer.disconnect();
          io.disconnect();
          document.removeEventListener("visibilitychange", onVisibility);
          window.clearTimeout(resizeTimer);
        };
      })();
    };

    start().catch(() => {
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      listenerCleanup?.();
      const current = refs.current;
      if (current) {
        current.scene.traverse((object) => {
          const mesh = object as import("three").Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const meshMaterial = mesh.material as import("three").Material | import("three").Material[];
          if (Array.isArray(meshMaterial)) {
            meshMaterial.forEach((entry) => {
              const mapped = entry as import("three").Material & { map?: import("three").Texture | null };
              mapped.map?.dispose();
              entry.dispose();
            });
          } else if (meshMaterial) {
            const mapped = meshMaterial as import("three").Material & {
              map?: import("three").Texture | null;
            };
            mapped.map?.dispose();
            meshMaterial.dispose();
          }
        });
        current.renderer.dispose();
        if (current.renderer.domElement.parentElement === host) {
          host.removeChild(current.renderer.domElement);
        }
        refs.current = null;
      }
    };
  }, [compact]);

  if (failed) {
    return <ChefPortrait className={className} label={label} />;
  }

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={label}
      className={`relative h-full w-full ${className}`}
    />
  );
}

/** Lightweight SVG Blaze used when WebGL is unavailable or in tiny surfaces. */
export function ChefPortrait({
  className = "",
  label = "Blaze, the Pizza Blitz ordering chef",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={`relative flex items-center justify-center ${className}`} role="img" aria-label={label}>
      <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden="true">
        <defs>
          <radialGradient id="blaze-glow" cx="50%" cy="38%" r="62%">
            <stop offset="0%" stopColor="#fff3d6" />
            <stop offset="55%" stopColor="#ffd9a0" />
            <stop offset="100%" stopColor="#f0a45f" />
          </radialGradient>
          <linearGradient id="blaze-jacket" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fffdf8" />
            <stop offset="100%" stopColor="#eadfce" />
          </linearGradient>
          <linearGradient id="blaze-skin" x1="20%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stopColor="#f8c39a" />
            <stop offset="100%" stopColor="#e5a071" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="98" fill="url(#blaze-glow)" />
        <circle cx="100" cy="100" r="88" fill="#17130f" opacity="0.06" />
        {/* jacket */}
        <path d="M40 200c2-38 22-54 60-54s58 16 60 54Z" fill="url(#blaze-jacket)" />
        <path d="M100 148v52" stroke="#e2d6c4" strokeWidth="4" />
        <circle cx="86" cy="170" r="3" fill="#d63a2f" />
        <circle cx="114" cy="170" r="3" fill="#d63a2f" />
        <circle cx="86" cy="184" r="3" fill="#d63a2f" />
        <circle cx="114" cy="184" r="3" fill="#d63a2f" />
        {/* neckerchief */}
        <path d="M66 152c10 8 20 11 34 11s24-3 34-11l6 12c-12 9-25 13-40 13s-28-4-40-13Z" fill="#d63a2f" />
        <path d="M96 163h12l6 20-12-5-12 5Z" fill="#b02a22" />
        {/* ears */}
        <ellipse cx="48" cy="88" rx="9" ry="12" fill="#e5a071" />
        <ellipse cx="152" cy="88" rx="9" ry="12" fill="#e5a071" />
        {/* head */}
        <ellipse cx="100" cy="88" rx="52" ry="50" fill="url(#blaze-skin)" />
        {/* hat */}
        <path d="M56 56c0-8 8-13 44-13s44 5 44 13v10H56Z" fill="#fffdf8" />
        <circle cx="74" cy="36" r="19" fill="#fffdf8" />
        <circle cx="100" cy="27" r="23" fill="#fffdf8" />
        <circle cx="127" cy="37" r="18" fill="#fffdf8" />
        <circle cx="55" cy="45" r="11" fill="#fffdf8" />
        <circle cx="145" cy="45" r="11" fill="#fffdf8" />
        <path d="M56 57h88" stroke="#e7dccb" strokeWidth="5" />
        {/* brows */}
        <path d="M68 74c6-4 14-4 20 0" stroke="#41281c" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d="M112 74c6-4 14-4 20 0" stroke="#41281c" strokeWidth="5" strokeLinecap="round" fill="none" />
        {/* eyes */}
        <ellipse cx="79" cy="89" rx="8" ry="9" fill="#fffdf8" />
        <ellipse cx="121" cy="89" rx="8" ry="9" fill="#fffdf8" />
        <circle cx="80" cy="90" r="4.4" fill="#3b2417" />
        <circle cx="122" cy="90" r="4.4" fill="#3b2417" />
        <circle cx="81.4" cy="88.4" r="1.5" fill="#fff" />
        <circle cx="123.4" cy="88.4" r="1.5" fill="#fff" />
        {/* nose */}
        <ellipse cx="100" cy="103" rx="8" ry="6.5" fill="#e29a6d" />
        {/* mustache */}
        <path d="M100 112c-8-6-18-6-24 0 4 6 12 7 24 2 12 5 20 4 24-2-6-6-16-6-24 0Z" fill="#41281c" />
        {/* mouth */}
        <path d="M90 118c3 6 7 9 10 9s7-3 10-9c-6 3-14 3-20 0Z" fill="#5c231d" />
        {/* cheeks */}
        <ellipse cx="64" cy="103" rx="9" ry="5" fill="#ea8d74" opacity="0.4" />
        <ellipse cx="136" cy="103" rx="9" ry="5" fill="#ea8d74" opacity="0.4" />
      </svg>
    </div>
  );
}
