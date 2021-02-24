import { AbstractMesh, FollowCamera, Scene, TransformNode, Vector3 } from "babylonjs";

export class FollowCam {
  private cam: FollowCamera;
  birds_eye_view = false;
  constructor(scene: Scene) {
    this.cam = new FollowCamera("cam", new Vector3(-1.4, 1.5, -4), scene);
    this.cam.inputs.clear();
    this.cam.radius = 2;
    this.cam.heightOffset = 1;
    this.cam.fov = 1.2;
    this.cam.rotationOffset = 180;
    this.cam.cameraAcceleration = 0.5;
    scene.switchActiveCamera(this.cam);
  }
  setTarget(me: TransformNode) {
    this.cam.lockedTarget = me as AbstractMesh;
  }
  toggleBirdsEyeView() {
    if (!this.birds_eye_view) {
      this.cam.heightOffset += 100;
      this.birds_eye_view = true;
    } else {
      this.cam.heightOffset -= 100;
      this.birds_eye_view = false;
    }
  }
  onMouseY(movementY: number) {
    this.cam.heightOffset += 0.0003 * movementY;
  }
  step(dt: number, pos: Vector3, heading: number) {
    // try to get behind player, don't crash walls
    let r = this.cam.rotationOffset;
    if (Math.abs(r - heading) > 180) {
      if (r < heading) {
        r += 360;
      } else {
        r -= 360;
      }
    }

    this.cam.rotationOffset = (r + dt * 10 * (heading - r)) % 360;
  }
}
