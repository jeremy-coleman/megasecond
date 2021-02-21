import contextlib
import logging
import json
import os
import sys
from typing import Union

import bmesh
import bpy
import numpy
from mathutils import Vector

sys.path.append(os.path.dirname(__file__))
from blender_async import later
from dirs import dest, src
from selection import select_object, all_mesh_objects

logging.basicConfig(stream=sys.stderr, level=logging.DEBUG)
log = logging.getLogger()


@contextlib.contextmanager
def editmode():
    if bpy.context.edit_object:
        bpy.ops.object.editmode_toggle()
    bpy.ops.object.editmode_toggle()
    yield
    bpy.ops.object.editmode_toggle()


def separate_rect(obj_name, xlo, xhi, ylo, yhi) -> Union[str, None]:
    names_before = set(o.name for o in bpy.data.objects)
    select_object(obj_name)
    with editmode():
        bpy.ops.mesh.select_mode(use_extend=False,
                                 use_expand=False,
                                 type='VERT')
        bpy.ops.mesh.select_all(action='DESELECT')
        mesh = bmesh.from_edit_mesh(bpy.data.objects[obj_name].data)
        sel_verts = set()
        for i, v in enumerate(mesh.verts):
            if xlo <= v.co.x < xhi and ylo <= v.co.y < yhi:
                sel_verts.add(i)
                v.select = True
        for e in mesh.edges:
            if all(i in sel_verts for i in e.verts):
                e.select = True
        for f in mesh.faces:
            if all(i in sel_verts for i in f.verts):
                f.select = True
        mesh.select_flush(True)
        bpy.ops.mesh.separate()

    names_after = set(o.name for o in bpy.data.objects)
    new_names = names_after.difference(names_before)

    if not new_names:
        return None
    new_name = new_names.pop()

    select_object(new_name)
    with editmode():
        bpy.ops.mesh.select_mode(use_extend=False,
                                 use_expand=False,
                                 type='FACE')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.cube_project(
            cube_size=1, scale_to_bounds=True
        )  # todo needs to go to a separate uv, to not break the big ground dif texture
    return new_name


def make_lightmap_uv_layer(obj, outData):
    # arrange for lightmap to always be 3rd
    uvs = obj.data.uv_layers
    lightmap_uv = uvs.new()
    lightmap_uv.name = 'lightmap'
    obj_uv = outData['objs'][obj.name]
    obj_uv['lightmap_uv'] = lightmap_uv.name
    return lightmap_uv


def objectBbox(obj):
    ptsObject = obj.bound_box
    ptsWorld = numpy.array([obj.matrix_world @ Vector(pt) for pt in ptsObject])
    centerWorld = numpy.average(ptsWorld, axis=0)
    centerToPts = ptsWorld - centerWorld
    radius = numpy.linalg.norm(centerToPts, axis=1).max()
    return {
        'center': [round(x, 3) for x in centerWorld],
        'radius': round(radius, 3)
    }

def storeExistingUvLayer(outData, obj):
    obj_uv = outData['objs'][obj.name]
    try:
        render_uv_layer = obj.data.uv_layers.active.name
        obj_uv['render_uv'] = render_uv_layer
    except AttributeError:
        pass


def main():
    outData = {}
    try:
        with open(dest / 'world.json') as worldJsonPrev:
            outData = json.load(worldJsonPrev)
    except IOError:
        pass

    bpy.ops.wm.open_mainfile(filepath=str(src / 'wrap/wrap.blend'))

    def done():
        with open(dest / 'world.json', 'w') as worldJson:
            json.dump(outData, worldJson, indent=2, sort_keys=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(dest / 'edit.blend'))
        bpy.ops.wm.quit_blender()

    def dice_ground(cb):
        for xsplit in range(-750, 750, 250):
            for ysplit in range(-750, 750, 250):
                separate_rect('gnd.001', -750, xsplit + 250, -750,
                              ysplit + 250)
        cb()

    def separate_materials(cb):
        for obj_name in all_mesh_objects(bpy.data.objects['env']):
            if len(bpy.data.objects[obj_name].material_slots) > 1:
                select_object(obj_name)
                bpy.ops.mesh.separate(type='MATERIAL')
        cb()

    def lightmaps(cb):
        for obj_name in all_mesh_objects(bpy.data.objects['env']):
            # if not obj_name.startswith('sign_board'): continue

            obj = select_object(obj_name)
            outData.setdefault('objs', {}).setdefault(obj_name, {})['worldBbox'] = objectBbox(obj)

            storeExistingUvLayer(outData, obj)            
            lyr = make_lightmap_uv_layer(obj, outData)
            obj.data.uv_layers.active = lyr

            log.info(f'start lightmap_pack on {obj_name}; active uv is {obj.data.uv_layers.active.name}')
            try:
                bpy.ops.uv.lightmap_pack(
                    PREF_CONTEXT='ALL_FACES',
                    PREF_PACK_IN_ONE=True,
                    PREF_NEW_UVLAYER=False,
                )
            except Exception as exc:
                log.warning(f'lightmap_pack failed on {obj_name}: {exc!r}')
        cb()

    later(2, dice_ground, lambda: separate_materials(lambda: lightmaps(done)))
    # also, delete player and other setup stuff, maybe save a non-env scene with props and chars


main()
