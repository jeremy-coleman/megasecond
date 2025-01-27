import { AbstractEntitySystem } from "@trixt0r/ecs";
import { Sim, Transform, UsesNav } from "../../shared/Components";
import { IdEntity } from "../../shared/IdEntity";
import createLogger from "../../shared/logsetup";
import { ClientWorldRunOptions } from "../../shared/types";
import { Action, LocallyDriven } from "../Components";
const log = createLogger("system");

export class PlayerJump extends AbstractEntitySystem<IdEntity> {
  constructor(priority: number) {
    super(priority, [Transform, LocallyDriven]);
  }

  processEntity(entity: IdEntity, _index: number, _entities: unknown, _options: ClientWorldRunOptions) {
    const ld = entity.components.get(LocallyDriven);
    ld.forAction(Action.Jump, () => {
      const si = entity.components.get(Sim);
      const un = entity.components.get(UsesNav);
      if (un.grounded) {
        si.vel.y = 3;
      }
    });
  }
}
