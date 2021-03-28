import { Engine } from "@trixt0r/ecs";
import { Mesh, Scene } from "babylonjs";
import * as Colyseus from "colyseus.js";
import { InitJump } from "../shared/Components";
import { dump } from "../shared/EcsOps";
import { IdEntity } from "../shared/IdEntity";
import { InitSystems as InitWorld } from "../shared/InitSystems";
import createLogger from "../shared/logsetup";
import { TrackServerEntities } from "../shared/SyncColyseusToEcs";
import { ClientWorldRunOptions, playerSessionId } from "../shared/types";
import { Player as NetPlayer, WorldState } from "../shared/WorldRoom";
import { setupScene, StatusLine } from "./BrowserWindow";
import { LocalCam } from "./Components";
import * as Env from "./Env";
import { getOrCreateNick } from "./nick";
import { Actions, UserInput } from "./UserInput";

const log = createLogger("WorldRoom");

class Game {
  client: Colyseus.Client;
  worldRoom?: Colyseus.Room<WorldState>;
  me?: IdEntity;
  constructor(private status: StatusLine, private world: Engine, private scene: Scene, private nick: string) {
    this.status.setPlayer("...");
    this.status.setConnection("connecting...");
    this.client = new Colyseus.Client("wss://megasecond.club/");
  }
  async joinWorld(nav: Mesh) {
    const worldRoom = await this.client.joinOrCreate<WorldState>("world", {});
    this.worldRoom = worldRoom;
    (window as any).room = worldRoom;
    this.status.setConnection("connected...");
    worldRoom.send("setNick", this.nick);

    return new Promise<void>((resolve, _reject) => {
      worldRoom.onStateChange.once((state) => {
        const tse = new TrackServerEntities(this.world);
        tse.trackEntities(state, this.worldRoom!.sessionId, this.worldRoom!);
        resolve();
      });
    });
  }

  // global component of status line? system that updates num players and your nick
  //     this.status.setConnection(`connected (${Array.from(this.worldRoom!.state.players.keys()).length} players)`);
}

async function go() {
  const nick = getOrCreateNick();
  const world = InitWorld(/*isClient=*/ true);

  (window as any).ecsDump = () => {
    dump(world);
    return world;
  };
  const debug = document.querySelector("#debug")!;

  const write = (line: string) => {
    const div = document.createElement("div");
    div.innerText = line;
    debug.appendChild(div);
  };
  const updateDebug = () => {
    debug.innerHTML = "";
    world.entities.forEach((e) => {
      write(`entity ${e.id}`);
      e.components.sort((a, b) => (a.constructor.name < b.constructor.name ? -1 : 1));
      e.components.forEach((comp) => {
        write(`  component ${comp.constructor.name}`);
        for (let prop in comp) {
          let v;
          try {
            v = comp[prop].toString();
          } catch (err) {
            v = "" + comp[prop];
          }
          if (v.match(/\[object/)) {
            write(`    ${prop} (obj)`); //, comp[prop]);
          } else {
            write(`    ${prop} ${v}`);
          }
        }
      });
    });
  };
  setInterval(updateDebug, 2000);

  const status = new StatusLine();
  const scene = setupScene("renderCanvas");
  const game = new Game(status, world, scene, nick);

  const env = new Env.World(scene, Env.GraphicsLevel.texture);
  await env.load();
  await env.reloadLayoutInstances();

  {
    const nav = scene.getMeshByName("navmesh") as Mesh;
    nav.updateFacetData();
    status.setPlayer(nick);
    await game.joinWorld(nav);
    // game.me is not guaranteed yet (or maybe if it's missing then the server is borked)
  }
  const userInput = new UserInput(scene, function onAction(name: Actions) {
    if (name == Actions.Jump) {
      game.me!.components.add(new InitJump());
    } else if (name == Actions.ToggleNavmeshView) {
      Env.toggleNavmeshView(scene);
    } else if (name == Actions.ToggleBirdsEyeView) {
      game.me!.components.get(LocalCam).toggleBirdsEyeView();
    } else if (name == Actions.ReloadEnv) {
      env.reloadLayoutInstances();
    }
  });

  const slowStep = false;

  const gameStep = (dt: number) => {
    world.run({
      dt,
      scene,
      userInput, // todo get this out of here
    } as ClientWorldRunOptions);

    userInput.step(dt);
  };
  if (slowStep) {
    setInterval(() => gameStep(0.1), 100);
  }
  scene.getEngine().runRenderLoop(() => {
    if (!slowStep) {
      const dt = scene.getEngine().getDeltaTime() / 1000.0;
      gameStep(dt);
    }
    if (scene.activeCamera) {
      scene.render();
    }
  });
}

go();
