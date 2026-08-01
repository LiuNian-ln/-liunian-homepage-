(() => {
  "use strict";

  const root = document.documentElement;
  const params = new URLSearchParams(window.location.search);
  const desktopGlass = window.matchMedia("(min-width: 861px) and (hover: hover) and (pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);
  const addMediaListener = (query, listener) => {
    if (typeof query.addEventListener === "function") query.addEventListener("change", listener);
    else if (typeof query.addListener === "function") query.addListener(listener);
  };
  const removeMediaListener = (query, listener) => {
    if (typeof query.removeEventListener === "function") query.removeEventListener("change", listener);
    else if (typeof query.removeListener === "function") query.removeListener(listener);
  };

  if (
    params.get("glass") === "off" ||
    !desktopGlass.matches ||
    reducedMotion.matches ||
    saveData ||
    !("WebGL2RenderingContext" in window)
  ) {
    root.dataset.liquidGlass = "css";
    return;
  }

  const surfaces = [
    {
      element: document.querySelector(".liquid-card"),
      radius: 30,
      refraction: 11,
      edge: 26,
      dispersion: 1.15,
      tint: 0.105,
      highlight: 1.0
    },
    {
      element: document.querySelector(".floating-nav"),
      radius: 999,
      refraction: 8,
      edge: 18,
      dispersion: 1.35,
      tint: 0.08,
      highlight: 1.16
    }
  ].filter((surface) => surface.element);

  if (!surfaces.length) {
    root.dataset.liquidGlass = "css";
    return;
  }

  const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;

uniform vec2 uResolution;
uniform vec4 uRect;

out vec2 vLocalPx;
out vec2 vHalfSize;

void main() {
  vec2 halfSize = uRect.zw * 0.5;
  vec2 center = uRect.xy + halfSize;
  vec2 pixel = center + aPosition * halfSize;
  vec2 clip = pixel / uResolution * 2.0 - 1.0;

  vLocalPx = aPosition * halfSize;
  vHalfSize = halfSize;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

  const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vLocalPx;
in vec2 vHalfSize;

out vec4 fragColor;

uniform sampler2D uBackground;
uniform vec2 uResolution;
uniform vec2 uBackgroundSize;
uniform vec2 uPointer;
uniform float uRadius;
uniform float uRefraction;
uniform float uEdgeThickness;
uniform float uDispersion;
uniform float uTint;
uniform float uHighlight;

float roundedBoxSdf(vec2 point, vec2 halfSize, float radius) {
  vec2 q = abs(point) - halfSize + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}

vec2 coverUv(vec2 pixel) {
  float coverScale = max(
    uResolution.x / uBackgroundSize.x,
    uResolution.y / uBackgroundSize.y
  );
  vec2 renderedSize = uBackgroundSize * coverScale;
  vec2 offset = (uResolution - renderedSize) * 0.5;
  return clamp((pixel - offset) / renderedSize, vec2(0.001), vec2(0.999));
}

void main() {
  float radius = min(uRadius, min(vHalfSize.x, vHalfSize.y));
  float sdf = roundedBoxSdf(vLocalPx, vHalfSize - vec2(1.0), radius);
  float antialias = max(fwidth(sdf), 0.72);
  float shapeAlpha = 1.0 - smoothstep(-antialias, antialias, sdf);
  vec2 normal = normalize(vec2(dFdx(sdf), dFdy(sdf)) + vec2(0.0001));
  float innerDistance = max(-sdf, 0.0);
  float edge = 1.0 - smoothstep(0.0, uEdgeThickness, innerDistance);
  float effectAlpha = shapeAlpha * edge;

  // Redraw only the physical edge. The center remains transparent so the
  // original full-resolution artwork stays sharp and most fragments exit
  // before any texture sampling.
  if (effectAlpha <= 0.002) discard;

  float lens = edge * edge * (3.0 - 2.0 * edge);
  vec2 refractedPixel = gl_FragCoord.xy - normal * uRefraction * lens;

  vec2 baseUv = coverUv(gl_FragCoord.xy);
  vec3 baseColor = texture(uBackground, baseUv).rgb;
  vec3 color = baseColor;

  vec2 dispersionOffset = normal * uDispersion * lens;
  float red = texture(uBackground, coverUv(refractedPixel + dispersionOffset)).r;
  float green = texture(uBackground, coverUv(refractedPixel)).g;
  float blue = texture(uBackground, coverUv(refractedPixel - dispersionOffset)).b;
  color = vec3(red, green, blue);

  float luminance = dot(baseColor, vec3(0.2126, 0.7152, 0.0722));
  vec3 environmentTint = mix(vec3(1.0, 0.925, 0.95), baseColor, 0.42);
  color = mix(color, environmentTint, uTint * (0.72 + luminance * 0.38));

  float outerRim = 1.0 - smoothstep(0.0, antialias * 1.75 + 0.75, abs(sdf));
  float innerRim = 1.0 - smoothstep(0.0, antialias * 1.35 + 0.55, abs(sdf + 3.6));
  vec2 lightVector = normalize(uPointer - gl_FragCoord.xy + vec2(0.001));
  float facingLight = 0.5 + 0.5 * dot(normal, lightVector);
  float environmentLight = mix(0.66, 1.12, luminance);
  float highlight = (outerRim * 0.82 + innerRim * 0.36)
    * mix(0.48, 1.0, facingLight)
    * environmentLight
    * uHighlight;

  color += vec3(1.0, 0.965, 0.98) * highlight;
  color -= vec3(0.018, 0.010, 0.015) * edge * (1.0 - facingLight) * 0.42;
  color = clamp(color, 0.0, 1.0);

  fragColor = vec4(color, effectAlpha);
}
`;

  class LiquidGlassRenderer {
    constructor(items) {
      this.surfaces = items;
      this.canvas = document.createElement("canvas");
      this.canvas.id = "liquid-glass-webgl";
      this.canvas.setAttribute("aria-hidden", "true");
      this.canvas.dataset.renderer = "viewport-refraction";
      document.body.appendChild(this.canvas);

      this.gl = this.canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
        premultipliedAlpha: true
      });

      if (!this.gl) throw new Error("webgl2-unavailable");

      this.program = null;
      this.vao = null;
      this.buffer = null;
      this.texture = null;
      this.uniforms = {};
      this.backgroundSize = [1, 1];
      this.textureReady = false;
      this.active = true;
      this.failed = false;
      this.destroyed = false;
      this.loading = false;
      this.loadGeneration = 0;
      this.pendingFrame = null;
      this.lastFrameTime = 0;
      this.minimumFrameInterval = 1000 / 30;
      this.needsResize = true;
      this.middleScrollStable = false;
      this.pointerX = window.innerWidth * 0.5;
      this.pointerY = window.innerHeight * 0.15;

      const cores = navigator.hardwareConcurrency || 8;
      const memory = navigator.deviceMemory || 8;
      this.baseRenderScale = cores <= 4 || memory <= 4 ? 0.52 : 0.68;

      this.onPointerMove = this.onPointerMove.bind(this);
      this.onScroll = this.onScroll.bind(this);
      this.onResize = this.onResize.bind(this);
      this.onVisibilityChange = this.onVisibilityChange.bind(this);
      this.onMediaChange = this.onMediaChange.bind(this);
      this.onContextLost = this.onContextLost.bind(this);
      this.onContextRestored = this.onContextRestored.bind(this);
      this.tick = this.tick.bind(this);

      this.canvas.addEventListener("webglcontextlost", this.onContextLost, false);
      this.canvas.addEventListener("webglcontextrestored", this.onContextRestored, false);

      this.createResources();
      this.observe();
    }

    compileShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        throw new Error("shader-compile-failed");
      }
      return shader;
    }

    createResources() {
      const gl = this.gl;
      const vertexShader = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        throw new Error("shader-link-failed");
      }

      const vao = gl.createVertexArray();
      const buffer = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          -1, -1,
           1, -1,
          -1,  1,
           1,  1
        ]),
        gl.STATIC_DRAW
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      );

      this.program = program;
      this.vao = vao;
      this.buffer = buffer;
      this.texture = texture;
      this.uniforms = {
        resolution: gl.getUniformLocation(program, "uResolution"),
        rect: gl.getUniformLocation(program, "uRect"),
        background: gl.getUniformLocation(program, "uBackground"),
        backgroundSize: gl.getUniformLocation(program, "uBackgroundSize"),
        pointer: gl.getUniformLocation(program, "uPointer"),
        radius: gl.getUniformLocation(program, "uRadius"),
        refraction: gl.getUniformLocation(program, "uRefraction"),
        edgeThickness: gl.getUniformLocation(program, "uEdgeThickness"),
        dispersion: gl.getUniformLocation(program, "uDispersion"),
        tint: gl.getUniformLocation(program, "uTint"),
        highlight: gl.getUniformLocation(program, "uHighlight")
      };
    }

    observe() {
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("scroll", this.onScroll, { passive: true });
      window.addEventListener("resize", this.onResize, { passive: true });
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      addMediaListener(desktopGlass, this.onMediaChange);
      addMediaListener(reducedMotion, this.onMediaChange);

      if ("ResizeObserver" in window) {
        this.resizeObserver = new ResizeObserver(() => this.requestRender());
        this.surfaces.forEach((surface) => this.resizeObserver.observe(surface.element));
      }
    }

    async loadBackground() {
      if (this.destroyed || this.loading) return;
      this.loading = true;
      const generation = ++this.loadGeneration;
      const image = new Image();
      image.decoding = "async";
      image.src = "assets/pastel-homepage-background.webp";

      if (typeof image.decode === "function") {
        await image.decode();
      } else {
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        });
      }

      if (this.destroyed || generation !== this.loadGeneration) return;
      if (!this.gl || this.gl.isContextLost()) {
        this.loading = false;
        return;
      }
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      this.backgroundSize = [image.naturalWidth, image.naturalHeight];
      this.textureReady = true;
      this.loading = false;
      const shouldShow = this.active && desktopGlass.matches && !reducedMotion.matches;
      root.classList.toggle("webgl-liquid-ready", shouldShow);
      root.dataset.liquidGlass = shouldShow ? "webgl" : "css";
      this.canvas.dataset.renderScale = String(this.baseRenderScale);
      if (shouldShow) this.requestRender(true);
    }

    resizeCanvas() {
      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);
      const pixelBudget = 1150000;
      const budgetScale = Math.sqrt(pixelBudget / (viewportWidth * viewportHeight));
      const pixelRatio = Math.max(
        0.35,
        Math.min(this.baseRenderScale * Math.min(window.devicePixelRatio || 1, 1), budgetScale)
      );
      const width = Math.max(1, Math.round(viewportWidth * pixelRatio));
      const height = Math.max(1, Math.round(viewportHeight * pixelRatio));

      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }

      this.scaleX = width / viewportWidth;
      this.scaleY = height / viewportHeight;
      this.canvas.dataset.pixelRatio = pixelRatio.toFixed(3);
      this.needsResize = false;
    }

    requestRender(forceResize = false) {
      if (!this.active || document.hidden) return;
      if (forceResize) this.needsResize = true;
      if (this.pendingFrame === null) {
        this.pendingFrame = requestAnimationFrame(this.tick);
      }
    }

    tick(time) {
      this.pendingFrame = null;
      if (!this.active || document.hidden || !this.textureReady) return;

      const elapsed = time - this.lastFrameTime;
      if (elapsed < this.minimumFrameInterval - 1) {
        this.pendingFrame = requestAnimationFrame(this.tick);
        return;
      }

      this.lastFrameTime = time;
      this.draw();
    }

    draw() {
      const gl = this.gl;
      if (!gl || gl.isContextLost()) return;
      if (this.needsResize) this.resizeCanvas();

      const width = this.canvas.width;
      const height = this.canvas.height;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);

      gl.uniform1i(this.uniforms.background, 0);
      gl.uniform2f(this.uniforms.resolution, width, height);
      gl.uniform2f(this.uniforms.backgroundSize, this.backgroundSize[0], this.backgroundSize[1]);
      gl.uniform2f(
        this.uniforms.pointer,
        this.pointerX * this.scaleX,
        (window.innerHeight - this.pointerY) * this.scaleY
      );

      for (const surface of this.surfaces) {
        const rect = surface.element.getBoundingClientRect();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.right < -surface.edge ||
          rect.left > window.innerWidth + surface.edge ||
          rect.bottom < -surface.edge ||
          rect.top > window.innerHeight + surface.edge
        ) {
          continue;
        }

        const scale = Math.min(this.scaleX, this.scaleY);
        const x = rect.left * this.scaleX;
        const y = (window.innerHeight - rect.bottom) * this.scaleY;
        const rectWidth = rect.width * this.scaleX;
        const rectHeight = rect.height * this.scaleY;

        gl.uniform4f(this.uniforms.rect, x, y, rectWidth, rectHeight);
        gl.uniform1f(this.uniforms.radius, surface.radius * scale);
        gl.uniform1f(this.uniforms.refraction, surface.refraction * scale);
        gl.uniform1f(this.uniforms.edgeThickness, surface.edge * scale);
        gl.uniform1f(this.uniforms.dispersion, surface.dispersion * scale);
        gl.uniform1f(this.uniforms.tint, surface.tint);
        gl.uniform1f(this.uniforms.highlight, surface.highlight);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      gl.bindVertexArray(null);
    }

    onPointerMove(event) {
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.requestRender();
    }

    onScroll() {
      const cardSurface = this.surfaces.find((surface) =>
        surface.element.classList.contains("liquid-card")
      );
      if (cardSurface) {
        const rect = cardSurface.element.getBoundingClientRect();
        const stableMiddle = rect.top <= -cardSurface.edge
          && rect.bottom >= window.innerHeight + cardSurface.edge;
        if (stableMiddle) {
          if (!this.middleScrollStable) {
            this.middleScrollStable = true;
            this.requestRender();
          }
          return;
        }
      }
      this.middleScrollStable = false;
      this.requestRender();
    }

    onResize() {
      this.requestRender(true);
    }

    onVisibilityChange() {
      if (!document.hidden) this.requestRender(true);
    }

    onMediaChange() {
      if (this.destroyed || this.failed) return;
      const shouldRun = desktopGlass.matches && !reducedMotion.matches;
      this.active = shouldRun;
      this.canvas.hidden = !shouldRun;
      root.classList.toggle("webgl-liquid-ready", shouldRun && this.textureReady);
      root.dataset.liquidGlass = shouldRun && this.textureReady ? "webgl" : "css";
      if (shouldRun && this.textureReady) this.requestRender(true);
      else if (shouldRun && !this.loading) this.loadBackground().catch(() => this.fallback());
    }

    onContextLost(event) {
      event.preventDefault();
      this.textureReady = false;
      root.classList.remove("webgl-liquid-ready");
      root.dataset.liquidGlass = "css";
    }

    onContextRestored() {
      if (this.destroyed || this.failed) return;
      try {
        this.createResources();
        this.loadBackground().catch(() => this.fallback());
      } catch (_error) {
        this.fallback();
      }
    }

    fallback() {
      this.failed = true;
      this.destroy();
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.active = false;
      this.textureReady = false;
      this.loading = false;
      this.loadGeneration += 1;
      if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;

      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("scroll", this.onScroll);
      window.removeEventListener("resize", this.onResize);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      removeMediaListener(desktopGlass, this.onMediaChange);
      removeMediaListener(reducedMotion, this.onMediaChange);
      if (this.resizeObserver) this.resizeObserver.disconnect();

      this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
      this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);

      if (this.gl && !this.gl.isContextLost()) {
        if (this.texture) this.gl.deleteTexture(this.texture);
        if (this.buffer) this.gl.deleteBuffer(this.buffer);
        if (this.vao) this.gl.deleteVertexArray(this.vao);
        if (this.program) this.gl.deleteProgram(this.program);
      }

      this.canvas.remove();
      root.classList.remove("webgl-liquid-ready");
      root.dataset.liquidGlass = "css";
      if (window.liquidGlassRenderer === this) delete window.liquidGlassRenderer;
    }
  }

  try {
    const renderer = new LiquidGlassRenderer(surfaces);
    window.liquidGlassRenderer = renderer;
    renderer.loadBackground().catch(() => renderer.fallback());
  } catch (_error) {
    const canvas = document.getElementById("liquid-glass-webgl");
    if (canvas) canvas.remove();
    root.classList.remove("webgl-liquid-ready");
    root.dataset.liquidGlass = "css";
  }
})();
