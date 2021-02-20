import { Scene, Vector3 } from "babylonjs";
import * as Colyseus from "colyseus.js";
import { WorldRoom, WorldState } from "../shared/WorldRoom";
import { setupScene, StatusLine } from "./BrowserWindow";
import * as Env from "./Env";
import { FollowCam } from "./FollowCam";
import { PlayerMotion } from "./PlayerMotion";
import { PlayerView } from "./PlayerView";
import { Actions, UserInput } from "./UserInput";

class Net {
  client: Colyseus.Client;
  world?: Colyseus.Room<WorldRoom>;
  worldState?: WorldState;
  myDisplayName: string;
  private lastSent: { x: number; y: number; z: number } | undefined;
  constructor(private status: StatusLine) {
    this.status.setPlayer("...");
    this.status.setConnection("connecting...");
    this.client = new Colyseus.Client("wss://megasecond.club/");
    this.myDisplayName = "p" + Math.round(Math.random() * 10000);
    this.status.setPlayer(this.myDisplayName);
  }
  async joinWorld() {
    this.world = await this.client.joinOrCreate<WorldRoom>("world", { name: this.myDisplayName });
    this.status.setConnection("connected.");

    (window as any).world = this.world;
    this.worldState = (this.world.state as unknown) as any;
  }
  uploadMe(me: PlayerMotion) {
    if (
      this.lastSent !== undefined && //
      this.lastSent.x == me.pos.x &&
      this.lastSent.y == me.pos.y &&
      this.lastSent.z == me.pos.z
    ) {
      return;
    }
    this.lastSent = { x: me.pos.x, y: me.pos.y, z: me.pos.z };
    // surely this isn't supposed to be a new message, just some kind of set on the room state object
    this.world!.send("playerMove", this.lastSent);
  }
}

class Game {
  playerViews = new Map<string, PlayerView>();
  playerMotions = new Map<string, PlayerMotion>();
  fcam: FollowCam;
  me?: PlayerMotion;
  constructor(private scene: Scene) {
    this.fcam = new FollowCam(scene);
  }

  addPlayer(name: string, me: boolean) {
    const pv = new PlayerView(this.scene, name);
    this.playerViews.set(name, pv);
    const pm = new PlayerMotion(this.scene);
    this.playerMotions.set(name, pm);
    if (me) {
      this.fcam.setTarget(pv.getCamTarget());
      (window as any).me = pv;
      this.me = pm;
      this.me.pos = new Vector3(1.8, 0, -9.5);
      this.me.facing = new Vector3(0, 0, -1);
    }
  }
  removePlayer(name: string) {
    const pv = this.playerViews.get(name);
    if (pv === undefined) {
      return;
    }
    pv.dispose();
    this.playerViews.delete(name);
  }
  getMe(): PlayerMotion {
    return this.me!;
  }
  setPlayerPosFromNet(name: string, pos: Vector3) {
    const pm = this.playerMotions.get(name);
    if (pm === undefined) {
      return;
    }
    pm.pos = pos;
  }
  updatePlayerViews(dt: number) {
    for (let [name, pm] of this.playerMotions.entries()) {
      const pv = this.playerViews.get(name);
      if (pv === undefined) continue; //throw new Error("missing view for " + name);
      pv.step(dt, pm.pos, pm.facing, pm === this.me ? this.fcam : undefined);
    }
  }
}

async function go() {
  const status = new StatusLine();
  const net = new Net(status);

  await net.joinWorld();

  const scene = setupScene("renderCanvas");
  const game = new Game(scene);
  const env = new Env.World(scene);
  await env.load();

  for (let [sess, data] of net.worldState!.players.entries()) {
    game.addPlayer(sess, /*me=*/ sess == net.world?.sessionId);
  }

  net.worldState!.players.onAdd = (player: any, sessionId: any) => {
    if (net.world!.sessionId === sessionId) {
      status.setPlayer(player.name);
      status.setConnection(`connected (${Array.from(net.worldState!.players.keys()).length} players)`);
    } else {
      console.log("It's an opponent", player.name, sessionId);
      status.setConnection(`connected (${Array.from(net.worldState!.players.keys()).length} players)`);
      game.addPlayer(sessionId, /*me=*/ false); // todo: this isnt happening for existing players
    }
  };

  net.worldState!.players.onRemove = function (player: any, sessionId: any) {
    console.log("bye", player, sessionId);
    status.setConnection(`connected (${Array.from(net.worldState!.players.keys()).length} players)`);
    game.removePlayer(sessionId);
  };

  net.world!.onMessage("playerMove", (msg: any) => {
    const pl = game.setPlayerPosFromNet(msg[0], new Vector3(msg[1].x, msg[1].y, msg[1].z));
  });

  const userInput = new UserInput(
    scene,
    function onMouse(dx, dy) {
      // x turns player (and that turns cam); y is cam-only (player doesn't care)
      game.getMe().onMouseX(dx);
      game.fcam.onMouseY(dy);
    },
    function onStick(x, y) {
      game.getMe().onStick(x, y);
    },
    function onAction(name: Actions) {
      if (name == Actions.Jump) {
        game.getMe().requestJump();
      } else if (name == Actions.ToggleNavmeshView) {
        Env.toggleNavmeshView(scene);
      } else if (name == Actions.ToggleBirdsEyeView) {
        game.fcam.toggleBirdsEyeView();
      }
    }
  );

  scene.getEngine().runRenderLoop(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000.0;
    const me = game.getMe();
    me.step(dt);
    net.uploadMe(me);

    game.updatePlayerViews(dt);

    scene.render();
  });
}

go();
