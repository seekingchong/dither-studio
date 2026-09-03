/**
 * WebGL2 上下文封装：在 Worker 里用 OffscreenCanvas 创建，全屏三角形 + 片元着色器做逐像素计算，
 * readPixels 读回。readPixels 自底向上返回行，片元里直接用 gl_FragCoord.y - 0.5 作为图像行号，
 * 读回的缓冲就是自上而下的行主序。
 */

const VERTEX = `#version 300 es
void main() {
  // 覆盖全屏的单个三角形
  float x = float((gl_VertexID & 1) << 2) - 1.0;
  float y = float((gl_VertexID & 2) << 1) - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
}`;

export class GpuContext {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: OffscreenCanvas;
  private programs = new Map<string, WebGLProgram>();
  private textures = new Map<string, WebGLTexture>();
  private vao: WebGLVertexArrayObject | null;

  private constructor(canvas: OffscreenCanvas, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.vao = gl.createVertexArray();
  }

  private static instance: GpuContext | null | undefined;

  /** 单例；创建失败返回 null 并记住结果 */
  static get(): GpuContext | null {
    if (GpuContext.instance !== undefined) return GpuContext.instance;
    try {
      if (typeof OffscreenCanvas === 'undefined') {
        GpuContext.instance = null;
        return null;
      }
      const canvas = new OffscreenCanvas(16, 16);
      const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: false });
      GpuContext.instance = gl ? new GpuContext(canvas, gl) : null;
    } catch {
      GpuContext.instance = null;
    }
    return GpuContext.instance;
  }

  program(key: string, fragment: string): WebGLProgram {
    const hit = this.programs.get(key);
    if (hit) return hit;
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('无法创建着色器');
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`着色器编译失败：${log}`);
      }
      return shader;
    };
    const prog = gl.createProgram();
    if (!prog) throw new Error('无法创建程序');
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`程序链接失败：${log}`);
    }
    this.programs.set(key, prog);
    return prog;
  }

  /** 上传 RGBA8 纹理（NEAREST，无重复） */
  textureRgba(key: string, width: number, height: number, data: Uint8ClampedArray | Uint8Array): WebGLTexture {
    const gl = this.gl;
    const tex = this.getTexture(key);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return tex;
  }

  /** 上传单通道 32 位浮点纹理 */
  textureR32F(key: string, width: number, height: number, data: Float32Array): WebGLTexture {
    const gl = this.gl;
    const tex = this.getTexture(key);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
    return tex;
  }

  private getTexture(key: string): WebGLTexture {
    const gl = this.gl;
    let tex = this.textures.get(key);
    if (!tex) {
      tex = gl.createTexture()!;
      this.textures.set(key, tex);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return tex;
  }

  /** 以 width × height 运行程序并读回 RGBA8 */
  run(program: WebGLProgram, width: number, height: number, bind: (gl: WebGL2RenderingContext, program: WebGLProgram) => void): Uint8ClampedArray {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    bind(gl, program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) throw new Error(`WebGL 错误 ${err}`);
    return out;
  }

  uniform(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(program, name);
  }
}
