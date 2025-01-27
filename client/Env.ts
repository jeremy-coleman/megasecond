// game environment, not code environment

import {
  AbstractMesh,
  Color3,
  Color4,
  DirectionalLight,
  Effect,
  InstancedMesh,
  Matrix,
  Mesh,
  PBRMaterial,
  Scene,
  SceneLoader,
  ShaderMaterial,
  ShadowGenerator,
  Texture,
  TransformNode,
  Vector3,
} from "babylonjs";
import { GridMaterial, SkyMaterial } from "babylonjs-materials";
import createLogger from "../shared/logsetup";

const log = createLogger("Env");
log.info = () => {};

export enum GraphicsLevel {
  wire,
  grid,
  texture,
}

interface LayoutInstance {
  name: string;
  model: string;
  transform_baby: number[];
}
interface LayoutJson {
  instances: LayoutInstance[];
}

function bakedTx(name: string, scene: Scene): Texture {
  const tx = new Texture(`./asset_build/` + name, scene);
  tx.vScale = -1;
  tx.coordinatesIndex = 0;
  return tx;
}

class Instance {
  constructor(public name: string, public node: TransformNode, public loaded: Promise<void>) {}
  static makeInstanceOf(name: string, node: TransformNode, other: Instance): Instance {
    const me = new Instance(name, node, other.loaded);
    other.loaded.then(() => {
      // race- either other or me could be dead by now
      other.node.instantiateHierarchy(me.node);
    });
    return me;
  }
}

class Collection {
  // 1 blender scene, 1 blender collection, multiple objects, all instanced multiple times in bjs
  private objs: AbstractMesh[] = [];
  private primaryInstName: string | undefined;
  private insts: Map<string, Instance> = new Map();
  constructor(public path: string, public scene: Scene, public graphicsLevel: GraphicsLevel) {}

  private async load(parent: TransformNode) {
    log.info(`    Collection(${this.path}) start load`);
    // if (this.path != "model/env/sign.glb" && this.path != "model/env/gnd.glb" && this.path != "model/env/sun.glb") return;
    const loaded = await SceneLoader.ImportMeshAsync("", "./asset_build/", this.path, this.scene);
    loaded.meshes.forEach((m) => {
      this.objs.push(m);
      if (m.name == "__root__") {
        m.name = m.id = "blender_coords";
        m.parent = parent;
      }
    });
    log.info(`    Collection(${this.path}) done load`);
  }

  async makeInstance(name: string): Promise<TransformNode> {
    log.info(`    Collection(${this.path}).makeInstance(${name})`);
    const node = new TransformNode("inst_" + name, this.scene);

    if (this.insts.size > 0) {
      const existingInst = this.insts.values().next().value as Instance;
      log.info(`      have objs from ${existingInst.name} and their load is`, existingInst.loaded);
      this.insts.set(name, Instance.makeInstanceOf(name, node, existingInst));
      await existingInst.loaded;
    } else {
      this.primaryInstName = name;
      const lp = this.load(node);
      this.insts.set(name, new Instance(name, node, lp));
      await lp;
    }
    if (this.graphicsLevel == GraphicsLevel.texture) {
      this.applyLightmaps(node, name);
    }
    return node;
  }

  private applyLightmaps(node: TransformNode, instanceName: string) {
    // a src/Materials/effect.ts gets to munge the glsl code, so that could be a
    // way to jam in a separate-lightmap-tx-per-instance feature

    for (let m of node.getDescendants() as InstancedMesh[]) {
      const mat = m.material as PBRMaterial | null;
      if (!mat) continue;
      const sourceName = m.sourceMesh ? m.sourceMesh.name : m.name;
      if (instanceName == "gnd" && sourceName != "gnd.023") continue;
      // if (instanceName != "sign.001" && instanceName != "gnd") continue;

      mat.emissiveTexture = bakedTx(`map/bake/${instanceName}/${sourceName}_dif.jpg`, this.scene);
      mat.emissiveTexture.coordinatesIndex = 1; // lightmap
      mat.emissiveColor = Color3.White();

      mat.lightmapTexture = bakedTx(`map/bake/${instanceName}/${sourceName}_shad.jpg`, this.scene);
      if (instanceName == "sign.001") (window as any).lm = mat.lightmapTexture;
      mat.lightmapTexture.coordinatesIndex = 1; // lightmap
      mat.lightmapTexture.gammaSpace = true;

      // https://github.com/BabylonJS/Babylon.js/blob/master/src/Shaders/ShadersInclude/pbrBlockFinalColorComposition.fx
      // false: add lightmapcolor; true: multiply lightmapcolor
      mat.useLightmapAsShadowmap = true;
    }
  }

  getInstance(name: string): TransformNode | undefined {
    const inst = this.insts.get(name);

    if (!inst) return undefined;
    return inst.node;
  }

  disposeInstance(name: string) {
    if (name == this.primaryInstName) throw new Error("todo");
    const inst = this.insts.get(name);
    if (!inst) return;
    inst.node.getDescendants().forEach((obj) => obj.dispose());
    inst.node.dispose();
    this.insts.delete(name);
  }

  disposeCollection() {
    this.objs.forEach((obj) => obj.dispose());
  }
}

class Instances {
  // owns all the Collections in the scene
  private collsByPath: Map<string, Collection> = new Map();
  //
  private collsByInstance: Map<string, Collection> = new Map();
  constructor(public scene: Scene, public graphicsLevel: GraphicsLevel) {}

  async makeInstance(path: string, instanceName: string): Promise<TransformNode> {
    log.info(`  makeInstance(${path}, ${instanceName})`);

    let col = this.collsByPath.get(path);
    if (!col) {
      col = new Collection(path, this.scene, this.graphicsLevel);
      this.collsByPath.set(path, col);
    }

    this.collsByInstance.set(instanceName, col);
    const node = await col.makeInstance(instanceName);
    return node;
  }

  getInstance(instanceName: string): TransformNode | undefined {
    return this.collsByInstance.get(instanceName)?.getInstance(instanceName);
  }

  allInstanceNames(): string[] {
    return Array.from(this.collsByInstance.keys());
  }

  removeInstance(instanceName: string) {
    this.collsByInstance.get(instanceName)?.disposeInstance(instanceName);
    this.collsByInstance.delete(instanceName);
  }

  reloadFile(path: string) {
    // todo- have the builder tell us (via a colyseus message) that a glb has been updated
  }
}

export class World {
  buildData: any;
  groundBump: Texture;
  instances: Instances;
  constructor(public scene: Scene, public graphicsLevel: GraphicsLevel) {
    this.graphicsLevel = graphicsLevel;
    this.instances = new Instances(scene, this.graphicsLevel);

    SceneLoader.ShowLoadingScreen = false;
    scene.clearColor = new Color4(0.419, 0.517, 0.545, 1);

    this.groundBump = new Texture("./asset_build/map/normal1.png", scene);
    this.groundBump.level = 0.43;
    this.groundBump.uScale = this.groundBump.vScale = 400;

    // not sure why imported sun light doesn't work
    // const sun2 = new SpotLight("sun2", new Vector3(0, 100, 0), new Vector3(0, -1, 0), 2, 0, scene);
    // sun2.shadowEnabled = false;
    // sun2.intensity = 80000;
    // setupSunShadows(scene, "sun2");

    function setupSunShadows(scene: Scene, name = "light_sun_light") {
      const light = scene.getLightByName(name) as DirectionalLight;
      light.autoCalcShadowZBounds = true;
      const gen = new ShadowGenerator(4096, light);
      (window as any).gen = gen;
      gen.bias = 0.001;
      gen.filter = 6;
      gen.filteringQuality = 1;
      scene.meshes.forEach((m) => {
        try {
          m.receiveShadows = true;
        } catch (e) {
          // some objs can't
        }
      });
    }

    // this.setupSkybox(scene);
  }

  async loadNavmesh() {
    await SceneLoader.AppendAsync("./asset_build/", "model/env/navmesh.glb", this.scene);
    this.setupNavMesh();
  }

  async reloadLayoutInstances() {
    // read updates from layout.json but not necessarily from model glb files
    const layout = (await (await fetch("./asset_build/layout.json")).json()) as LayoutJson;
    const noLongerPresent = new Set<string>(this.instances.allInstanceNames());
    for (let inst of layout.instances) {
      let node = this.instances.getInstance(inst.name);
      if (!node) {
        node = await this.instances.makeInstance(inst.model, inst.name);
      }
      noLongerPresent.delete(inst.name);

      const mat = Matrix.FromArray(inst.transform_baby);
      node.setPivotMatrix(mat, false);
    }
    for (let name of noLongerPresent) {
      log.info(`cleaning up collection ${name}`);
      this.instances.removeInstance(name);
    }
    this.postEnvLoad();
  }

  private postEnvLoad() {
    this.scene.meshes.forEach((m) => {
      if (m.name == "rock_arch_obj" || m.name == "stair_base" || m.name == "signpost") {
        const sunCaster = (window as any).gen as ShadowGenerator; // todo
        if (sunCaster) {
          sunCaster.addShadowCaster(m);
        }
      }
    });

    switch (this.graphicsLevel) {
      case GraphicsLevel.wire:
        this.scene.forceWireframe = true;
        break;
      case GraphicsLevel.grid:
        this.gridEverything();
        break;
      case GraphicsLevel.texture:
        // to rewrite // this.loadMaps(Vector3.Zero(), 100);
        (this.scene.getMaterialByName("gnd") as PBRMaterial).bumpTexture = this.groundBump!;
        break;
    }
  }

  async loadObj(name: string): Promise<Mesh> {
    const fn = `model/prop/${name}.glb`;
    await SceneLoader.AppendAsync("./asset_build/", fn, this.scene);
    const ret = this.scene.getMeshByName(name);
    if (!ret) {
      throw new Error(`file ${fn} did not provide object ${name}`);
    }
    const junkRoot = ret.parent;
    ret.parent = null;
    junkRoot?.dispose();
    return ret as Mesh;
  }
  gridEverything() {
    const grid = new GridMaterial("grid", this.scene);
    grid.gridRatio = 0.1;
    grid.majorUnitFrequency = 5;
    grid.mainColor = new Color3(0.3, 0.3, 0.3);
    grid.backFaceCulling = false;

    for (let m of this.scene.meshes) {
      try {
        m.material = grid;
      } catch (err) {}
    }
  }

  loadMaps(center: Vector3, maxDist: number) {
    let objsInRange = 0,
      objsTooFar = 0;

    for (let m of Object.keys(this.buildData.objs)) {
      if (m == "navmesh" || m == "__root__" || m == "player") {
        continue;
      }
      const obj = this.scene.getMeshByName(m);
      if (!obj) {
        log.info(`data said ${m} but no mesh found in scene`);
        continue;
      }
      const d = this.distToObject(obj, center);
      if (d > maxDist) {
        objsTooFar += 1;
        continue;
      }
      objsInRange += 1;

      try {
        this.assignTx(m);
      } catch (err) {
        log.info("no tx for mesh", m, err);
        continue;
      }
      if (m.startsWith("gnd.")) {
        (obj.material as PBRMaterial).bumpTexture = this.groundBump!;
      }
    }
    log.info(`loaded textures for ${objsInRange}, skipped ${objsTooFar} objs`);
  }

  private distToObject(m: AbstractMesh, center: Vector3) {
    const bb = this.buildData.objs[m.name].worldBbox;
    const objCenter = Vector3.FromArray(bb.center);
    return Math.max(0, objCenter.subtract(center).length() - bb.radius);
  }

  private setupSkybox(scene: Scene) {
    var skyboxMaterial = new SkyMaterial("skyMaterial", scene);
    skyboxMaterial.backFaceCulling = false;

    var skybox = Mesh.CreateBox("skyBox", 1000.0, scene);
    skybox.material = skyboxMaterial;
    skyboxMaterial.inclination = 0;
    skyboxMaterial.luminance = 1;
    skyboxMaterial.turbidity = 40;
  }

  assignTx(objName: string) {
    const obj = this.scene.getMeshByName(objName);
    if (!obj) {
      return;
    }
    if (!obj.material) {
      // couldn't take the grid material earlier
      return;
    }
    const mat = new PBRMaterial("pbr_" + objName, this.scene); //obj.material as PBRMaterial;
    mat.unlit = true;
    mat.albedoTexture = bakedTx(`bake/${objName}_dif.jpg`, this.scene);
    mat.albedoTexture.coordinatesIndex = 1; // lightmap
    // mat.lightmapTexture = bakedTx(`bake_${objName}_shad.jpg`);
    // mat.useLightmapAsShadowmap = true;
    Texture.WhenAllReady([mat.albedoTexture], () => {
      // log.info("objname", objName);
      try {
        obj.material = mat;
      } catch (e) {
        log.error(e); // another instance of a repeated object?
      }
    });
  }

  private setupNavMesh() {
    const nav = this.scene.getMeshByName("navmesh") as Mesh;
    nav.updateFacetData();

    nav.isVisible = false;

    const grid = new GridMaterial("grid", this.scene);
    grid.gridRatio = 0.1;
    grid.majorUnitFrequency = 5;
    grid.mainColor = new Color3(0.3, 0.3, 0.3);
    grid.backFaceCulling = false;
    grid.wireframe = true; // maybe
    nav.material = grid;
  }
}

export function toggleNavmeshView(scene: Scene) {
  const n = scene.getMeshByName("navmesh")!;
  n.isVisible = !n.isVisible;

  for (let m of scene.meshes) {
    if (["gnd.023", "stair", "buildings"].indexOf(m.name) != -1) {
      m.isVisible = !n.isVisible;
    }
  }
}

function checkerboardMaterial(scene: Scene) {
  Effect.ShadersStore["aVertexShader"] = `
        precision highp float;

        attribute vec3 position;
        attribute vec2 uv;

        uniform mat4 world;
        uniform mat4 worldViewProjection;

        varying vec2 v_uv;

        void main(void) {
            vec4 output1 = world * vec4(position, 1.0);
            vec4 output0 = worldViewProjection * output1;
            gl_Position = output0;
            v_uv = position.xz;
        }
        `;

  Effect.ShadersStore["aFragmentShader"] = `
        precision highp float;

        uniform mat4 world;
        uniform mat4 worldViewProjection;

        varying vec2 v_uv;

        void main(void) {
            float sz= 3.;
            float v  = (mod(v_uv.x, sz) > sz/2. ^^ mod(v_uv.y, sz) > sz/2.) ? .3 : .5;
            gl_FragColor = vec4(v, v, v, 1.0);
        }
    `;

  var shaderMaterial = new ShaderMaterial("a", scene, "a", {
    attributes: ["position", "uv"],
    uniforms: ["world", "worldViewProjection"],
  });

  shaderMaterial.backFaceCulling = false;
  return shaderMaterial;
}
