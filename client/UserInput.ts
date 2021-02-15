import { ActionManager, ExecuteCodeAction, PickingInfo, PointerEventTypes, ActionEvent, Scene } from "babylonjs";

export enum Actions {
  Jump,
  Activate,
  ToggleNavmeshView,
  ToggleBirdsEyeView,
}

export class UserInput {
  private stickX = 0;
  private stickY = 0;
  private stickPressFunc: { [keyName: string]: () => void };
  private stickReleaseFunc: { [keyName: string]: () => void };

  constructor(
    private scene: Scene,
    private onMouse: (dx: number, dy: number) => void,
    private onStick: (x: number, y: number) => void,
    private onAction: (name: Actions) => void
  ) {
    this.stickPressFunc = {
      ArrowUp: () => (this.stickY = -1), // these could have a little analog ramp-up
      w: () => (this.stickY = -1),
      ArrowDown: () => (this.stickY = 1),
      s: () => (this.stickY = 1),
      ArrowLeft: () => (this.stickX = -1),
      a: () => (this.stickX = -1),
      ArrowRight: () => (this.stickX = 1),
      d: () => (this.stickX = 1),
    };
    this.stickReleaseFunc = {
      ArrowUp: () => (this.stickY = 0),
      w: () => (this.stickY = 0),
      ArrowDown: () => (this.stickY = 0),
      s: () => (this.stickY = 0),
      ArrowLeft: () => (this.stickX = 0),
      a: () => (this.stickX = 0),
      ArrowRight: () => (this.stickX = 0),
      d: () => (this.stickX = 0),
    };
    scene.actionManager = new ActionManager(scene);
    scene.actionManager.registerAction(new ExecuteCodeAction({ trigger: ActionManager.OnKeyDownTrigger }, this.onKeyDown.bind(this)));
    scene.actionManager.registerAction(new ExecuteCodeAction({ trigger: ActionManager.OnKeyUpTrigger }, this.onKeyUp.bind(this)));
    scene.onPointerMove = this.onMove.bind(this);
  }
  onMove(ev: PointerEvent, pickInfo: PickingInfo, type: PointerEventTypes) {
    if (!document.pointerLockElement) {
      return;
    }
    this.onMouse(ev.movementX, ev.movementY);
  }
  onKeyDown(ev: ActionEvent) {
    const func = this.stickPressFunc[ev.sourceEvent.key as string];
    if (func) {
      func();
      this.onStick(this.stickX, this.stickY);
    }
    switch (ev.sourceEvent.key) {
      case " ":
        this.onAction(Actions.Jump);
        break;
      case "e":
        this.onAction(Actions.Activate);
        break;
      case "n":
        this.onAction(Actions.ToggleNavmeshView);
        break;
      case "b":
        this.onAction(Actions.ToggleBirdsEyeView);
        break;
    }
  }
  onKeyUp(ev: ActionEvent) {
    const func = this.stickReleaseFunc[ev.sourceEvent.key as string];
    if (func) {
      func();
      this.onStick(this.stickX, this.stickY);
    }
  }
}
