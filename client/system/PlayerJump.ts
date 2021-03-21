import { AbstractEntitySystem } from "@trixt0r/ecs";
import { InitJump, Transform, UsesNav } from "../../shared/Components";
import { removeComponent } from "../../shared/EcsOps";
import { IdEntity } from "../../shared/IdEntity";
import createLogger from "../../shared/logsetup";
import { ClientWorldRunOptions } from "../../shared/types";
const log = createLogger("system");

export class PlayerJump extends AbstractEntitySystem<IdEntity> {
  constructor(priority: number) {
    super(priority, [Transform, InitJump]);
  }

  processEntity(entity: IdEntity, _index: number, _entities: unknown, _options: ClientWorldRunOptions) {
    const pt = entity.components.get(Transform);
    const un = entity.components.get(UsesNav);
    if (un.grounded) {
      pt.vel.y = 3;
    }

    removeComponent(entity, InitJump);
  }
}