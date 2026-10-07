/**
 * A WebGL 2 stand-in for jsdom: enough for three.js to build its programs, buffers, textures and render
 * targets and to draw (as no-ops), so a real FightRenderer can run in a test. It counts the graphics
 * objects alive on the context, as the rematch scenario does in a real browser, because three's own
 * counters start again at zero with every renderer on a shared context.
 */
export type GlObjectKind = "buffers" | "textures" | "programs" | "shaders" | "framebuffers" | "renderbuffers" | "vertexArrays";

export interface FakeWebGl {
  readonly context: WebGL2RenderingContext;
  /** Objects created and not deleted yet, per kind. */
  live(): Record<GlObjectKind, number>;
  /** Objects created since the context was made, per kind. */
  readonly created: Record<GlObjectKind, number>;
  /** Whether a handle the context gave out is still alive. */
  alive(handle: unknown): boolean;
}

const KINDS: readonly GlObjectKind[] = ["buffers", "textures", "programs", "shaders", "framebuffers", "renderbuffers", "vertexArrays"];
const CREATE: Readonly<Record<string, GlObjectKind>> = {
  createBuffer: "buffers", createTexture: "textures", createProgram: "programs", createShader: "shaders",
  createFramebuffer: "framebuffers", createRenderbuffer: "renderbuffers", createVertexArray: "vertexArrays",
};
const DELETE: Readonly<Record<string, GlObjectKind>> = {
  deleteBuffer: "buffers", deleteTexture: "textures", deleteProgram: "programs", deleteShader: "shaders",
  deleteFramebuffer: "framebuffers", deleteRenderbuffer: "renderbuffers", deleteVertexArray: "vertexArrays",
};
const PARAMETERS: Readonly<Record<string, unknown>> = {
  VERSION: "WebGL 2.0 (test)", SHADING_LANGUAGE_VERSION: "WebGL GLSL ES 3.00 (test)", VENDOR: "test", RENDERER: "test",
  MAX_TEXTURE_IMAGE_UNITS: 16, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
  MAX_TEXTURE_SIZE: 4096, MAX_CUBE_MAP_TEXTURE_SIZE: 4096, MAX_RENDERBUFFER_SIZE: 4096, MAX_3D_TEXTURE_SIZE: 2048,
  MAX_ARRAY_TEXTURE_LAYERS: 256, MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 1024, MAX_VARYING_VECTORS: 30,
  MAX_FRAGMENT_UNIFORM_VECTORS: 1024, MAX_SAMPLES: 4, SAMPLES: 4, MAX_UNIFORM_BUFFER_BINDINGS: 24, MAX_DRAW_BUFFERS: 8,
};

export function fakeWebGl(canvas: HTMLCanvasElement): FakeWebGl {
  const handles = new Map<object, GlObjectKind>();
  const created = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<GlObjectKind, number>;
  // Enum values only need to be distinct and stable; parameters are looked up by name.
  const enums = new Map<string, number>();
  const names = new Map<number, string>();
  const constant = (name: string): number => {
    let value = enums.get(name);
    if (value === undefined) {
      value = 0x10000 + enums.size;
      enums.set(name, value);
      names.set(value, name);
    }
    return value;
  };
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    getParameter: (pname) => {
      const name = names.get(pname as number) ?? "";
      if (name === "SCISSOR_BOX" || name === "VIEWPORT") return new Int32Array([0, 0, canvas.width, canvas.height]);
      return PARAMETERS[name] ?? 0;
    },
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "default", failIfMajorPerformanceCaveat: false }),
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getShaderParameter: () => true,
    // No active uniforms or attributes: three uploads geometry and render targets regardless, and
    // textures a test asks for with renderer.initTexture.
    getProgramParameter: (_program, pname) => {
      const name = names.get(pname as number);
      return name === "ACTIVE_UNIFORMS" || name === "ACTIVE_ATTRIBUTES" ? 0 : true;
    },
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    getShaderSource: () => "",
    checkFramebufferStatus: () => constant("FRAMEBUFFER_COMPLETE"),
    isContextLost: () => false,
    getError: () => 0,
    getUniformLocation: () => null,
    getAttribLocation: () => -1,
  };
  for (const [method, kind] of Object.entries(CREATE)) {
    methods[method] = () => {
      const handle = { kind };
      handles.set(handle, kind);
      created[kind] += 1;
      return handle;
    };
  }
  for (const method of Object.keys(DELETE)) {
    methods[method] = (handle) => {
      if (typeof handle === "object" && handle !== null) handles.delete(handle);
    };
  }
  const noop = (): void => undefined;
  const context = new Proxy({} as WebGL2RenderingContext, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      if (property === "canvas") return canvas;
      if (property === "drawingBufferWidth") return canvas.width;
      if (property === "drawingBufferHeight") return canvas.height;
      const method = methods[property];
      if (method !== undefined) return method;
      if (/^[A-Z][A-Z0-9_]*$/.test(property)) return constant(property);
      return noop;
    },
    set() {
      return true;
    },
  });
  return {
    context,
    created,
    live: () => {
      const counts = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<GlObjectKind, number>;
      for (const kind of handles.values()) counts[kind] += 1;
      return counts;
    },
    alive: (handle) => typeof handle === "object" && handle !== null && handles.has(handle),
  };
}

/** Makes `canvas` hand out the fake context for WebGL 2, and the shared 2D test context otherwise. */
export function attachFakeWebGl(canvas: HTMLCanvasElement): FakeWebGl {
  const gl = fakeWebGl(canvas);
  const other = HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(canvas, "getContext", {
    configurable: true,
    value: (type: string, ...rest: unknown[]) => (type === "webgl2" ? gl.context : Reflect.apply(other, canvas, [type, ...rest])),
  });
  return gl;
}
