import * as THREE from 'three';

/**
 * Building material. One instanced unit box, everything else is procedural:
 * - instanceMatrix carries x/z position and footprint (y scale is always 1)
 * - aHeight is the current animated height (updated from the CPU during the time-lapse)
 * - windows are computed analytically per fragment, and fade into their average glow when
 *   they get smaller than a pixel (the shader's level of detail: no shimmer, constant cost)
 * - buildings smaller than ~1.5px on screen collapse in the vertex shader (geometric LOD)
 */

const common = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash31(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
`;

export function createBuildingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uAccent: { value: new THREE.Color('#ff4f8b') },
      uLodPixels: { value: 1.5 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uDim: { value: 0 },
    },
    fog: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute float aHeight;
      attribute vec3 aColor;
      attribute vec4 aInfo; // x: seed, y: neon, z: lot (0/1), w: highlight
      uniform float uLodPixels;
      uniform vec2 uViewport;
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying vec3 vColor;
      varying vec4 vInfo;
      varying vec2 vSize; // footprint, height
      varying float vDist;
      void main() {
        vec3 sizeXZ = vec3(length(instanceMatrix[0].xyz), 1.0, length(instanceMatrix[2].xyz));
        float h = aInfo.z > 0.5 ? 0.06 : max(aHeight, 0.0);
        vec3 p = position;
        p.y *= h;
        vec4 world = instanceMatrix * vec4(p, 1.0);
        world.y = p.y;
        vec4 mv = viewMatrix * world;
        vDist = -mv.z;
        // Geometric LOD: collapse buildings that would cover less than uLodPixels.
        float proj = projectionMatrix[1][1] * uViewport.y * 0.5;
        float px = max(sizeXZ.x, h) * proj / max(vDist, 0.001);
        gl_Position = projectionMatrix * mv;
        if ((px < uLodPixels && aInfo.w < 0.5) || aHeight < -0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vLocal = vec3(p.x * sizeXZ.x, p.y, p.z * sizeXZ.z);
        vNormalW = normal;
        vColor = aColor;
        vInfo = aInfo;
        vSize = vec2(sizeXZ.x, h);
        vec4 mvPosition = mv;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      ${common}
      uniform vec3 uAccent;
      uniform float uTime;
      uniform float uDim;
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying vec3 vColor;
      varying vec4 vInfo;
      varying vec2 vSize;
      varying float vDist;

      const float FLOOR_H = 0.42;
      const float COL_W = 0.32;

      void main() {
        vec3 n = normalize(vNormalW);
        float seed = vInfo.x;
        float hi = vInfo.w;
        vec3 base = vColor;
        vec3 col;

        if (vInfo.z > 0.5) {
          // Empty lot: dark slab with a faint rim where the building used to be.
          vec2 q = abs(vLocal.xz) / (vSize.x * 0.5);
          float edge = smoothstep(0.86, 0.97, max(q.x, q.y));
          col = vec3(0.0016, 0.0018, 0.0028) + base * 0.012 * edge;
          col += uAccent * hi * 0.5;
        } else if (n.y > 0.5) {
          // Roof: dark, with a neon rim on landmark towers.
          vec2 q = abs(vLocal.xz) / (vSize.x * 0.5);
          float rim = smoothstep(0.88, 0.97, max(q.x, q.y));
          col = base * 0.03 + vec3(0.0025, 0.0027, 0.0042);
          col += base * rim * (0.02 + vInfo.y * 2.2);
          col += uAccent * hi * (0.15 + rim * 1.6);
        } else {
          // Walls: tinted facade, moonlight from the north-west, warm windows.
          float u = (abs(n.x) > 0.5 ? vLocal.z : vLocal.x) + vSize.x * 0.5;
          float v = vLocal.y;
          float face = abs(n.x) > 0.5 ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
          float moon = 0.45 + 0.55 * max(dot(n, normalize(vec3(-0.6, 0.0, -0.4))), 0.0);
          float ground = smoothstep(0.0, 3.0, v);
          float up = v / max(vSize.y, 0.001);
          col = base * (0.02 + 0.03 * ground + 0.035 * up) * moon + vec3(0.0012, 0.0015, 0.003);

          // Window grid.
          float cols = max(1.0, floor(vSize.x / COL_W));
          float cw = vSize.x / cols;
          vec2 cell = vec2(u / cw, v / FLOOR_H);
          vec2 id = floor(cell);
          vec2 f = fract(cell);
          float floors = floor(vSize.y / FLOOR_H);
          float litRatio = 0.18 + 0.32 * hash11(seed * 7.13);
          float r = hash31(vec3(id, seed * 17.0 + face * 3.1));
          float lit = step(r, litRatio);
          // Some floors are dark offices, some are fully lit.
          float floorMood = hash31(vec3(id.y, seed, 9.0));
          lit = floorMood < 0.12 ? 0.0 : (floorMood > 0.93 ? 1.0 : lit);
          float warmth = hash31(vec3(id.yx, seed + 3.0));
          vec3 lightCol = warmth < 0.82 ? vec3(1.0, 0.70, 0.38) : vec3(0.62, 0.80, 1.0);
          lightCol = lightCol * lightCol * (0.55 + 0.75 * hash31(vec3(id, seed + 5.0)));
          vec3 glass = vec3(0.0018, 0.0024, 0.0045) + base * 0.006;
          vec3 winCol = mix(glass, lightCol * 1.25, lit);

          // Analytic AA / LOD: when a window is smaller than ~2px, blend to the facade average.
          vec2 fw = fwidth(cell);
          float lod = smoothstep(0.2, 0.5, max(fw.x, fw.y));
          vec2 win = smoothstep(vec2(0.18, 0.22) - fw, vec2(0.18, 0.22) + fw, f) *
                     (1.0 - smoothstep(vec2(0.82, 0.78) - fw, vec2(0.82, 0.78) + fw, f));
          float inWindow = win.x * win.y;
          float valid = step(0.5, id.y) * step(id.y, floors - 1.0) * step(0.9, vSize.y);
          vec3 detailed = mix(col, winCol, inWindow * valid);
          vec3 averaged = mix(col, mix(glass, lightCol * 1.25, litRatio), 0.36 * valid);
          col = mix(detailed, averaged, lod);

          // Cornice line at the top of the facade.
          col += base * smoothstep(vSize.y - 0.08, vSize.y, v) * (0.03 + vInfo.y * 1.6);
          col += uAccent * hi * (0.12 + 0.08 * sin(uTime * 4.0));
        }

        col *= 1.0 - uDim * 0.7;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  });
}

/** Soft additive glow sprites (contributors, street lights). */
export function createGlowMaterial(opts: { size: number; opacity?: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: opts.size },
      uScale: { value: 1 },
      uOpacity: { value: opts.opacity ?? 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float aAlpha;
      attribute float aSize;
      uniform float uSize;
      uniform float uScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.5, uSize * aSize * uScale / max(-mv.z, 0.1));
        vColor = color;
        vAlpha = aAlpha;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        float core = exp(-d * d * 10.0);
        float halo = exp(-d * d * 2.5) * 0.35;
        float a = (core + halo) * (1.0 - smoothstep(0.85, 1.0, d)) * vAlpha * uOpacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
  });
}

/** Ground: asphalt with district plates and a soft radial glow under downtown. */
export function createGroundMaterial(radius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uRadius: { value: radius },
    },
    fog: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vXZ = world.xz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uRadius;
      varying vec2 vXZ;
      void main() {
        float r = length(vXZ) / uRadius;
        vec3 col = vec3(0.0011, 0.0013, 0.0024);
        col += vec3(0.012, 0.005, 0.011) * exp(-r * r * 1.2);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  });
}

export function createPlateMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAccent: { value: new THREE.Color('#ff4f8b') },
    },
    fog: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute float aHover;
      varying vec2 vUv2;
      varying vec2 vSize;
      varying float vHover;
      void main() {
        vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
        vUv2 = position.xz;
        vHover = aHover;
        vec4 world = instanceMatrix * vec4(position, 1.0);
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uAccent;
      varying vec2 vUv2;
      varying vec2 vSize;
      varying float vHover;
      void main() {
        vec2 d = (0.5 - abs(vUv2)) * vSize; // distance to edge in world units
        float edge = 1.0 - smoothstep(0.0, 0.12, min(d.x, d.y));
        vec3 col = vec3(0.009, 0.0095, 0.015);
        col += uAccent * edge * (0.02 + vHover * 0.9);
        col += uAccent * vHover * 0.006;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }
    `,
  });
}

/** Sky dome: deep navy with a dusty violet glow at the horizon. */
export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 top = vec3(0.0005, 0.0007, 0.0022);
        vec3 mid = vec3(0.0016, 0.0016, 0.0055);
        vec3 horizon = vec3(0.022, 0.0065, 0.016);
        vec3 col = mix(mid, top, smoothstep(0.0, 0.55, y));
        col = mix(col, horizon, exp(-max(y, 0.0) * 9.0) * 0.85);
        col = mix(col, vec3(0.0012, 0.0013, 0.0022), smoothstep(0.0, -0.2, y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
