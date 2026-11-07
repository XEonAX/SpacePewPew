"""Stylized faceted asteroid renderer (colour + normal sprite).

Adapted from the reference "stylized_asteroid" approach: Voronoi-dual low-poly
facets, tapered flat-floored booleans, painted fake-lit emission materials,
bevel ridges and scattered studs/chunks. Renders a transparent-background sprite
plus a camera-space normal map for the game's 2D shader.

Usage: blender --background --python tools/asteroid-gen/render_asteroid.py
Env: ASTEROID_OUT, ASTEROID_SEED, ASTEROID_SIZE, ASTEROID_PALETTE
"""

import math
import os
import random

import bmesh
import bpy
from mathutils import Euler, Vector, noise

OUT_DIR = os.environ.get("ASTEROID_OUT", ".")
SEED = int(os.environ.get("ASTEROID_SEED", "11"))
SIZE = int(os.environ.get("ASTEROID_SIZE", "1024"))
PALETTE = os.environ.get("ASTEROID_PALETTE", "slate")

# ---- body ----
FACET_COUNT = 72
FACET_SIZE_VARIATION = 0.30
FACET_ROUGH = 0.13
BODY_STRETCH = 1.14
WAIST_PINCH = 0.2
LUMP = 0.26
BEND = 0.05
BODY_LENGTH = 2.9

# ---- craters: (count, (min R, max R), depth/R, min camera dot, pool fraction) ----
CRATERS = [
    (2, (0.20, 0.27), 0.78, 0.40, 0.40),
    (5, (0.09, 0.14), 0.72, 0.10, 0.60),
    (18, (0.026, 0.055), 0.65, -0.10, 1.00),
]
CRATER_SIDES = 8
FLOOR_RATIO = 0.58

# ---- surface bits ----
N_STUDS = 12
N_DOTS = 10
N_CHUNKS = 4
BEVEL_WIDTH = 0.036
PLATES_ENABLED = True

# ---- look ----
LIGHT_DIR = (-0.62, 0.50, 0.60)
ROOT_ROTATION_DEG = (-28, 12, 37)
CREASE_ANGLE_DEG = 112

ROCK_RAMP = [
    (0.00, "#1a2539"),
    (0.18, "#354966"),
    (0.38, "#55718f"),
    (0.56, "#7f99b3"),
    (0.70, "#a5b3bd"),
    (0.82, "#c7c5b4"),
    (0.94, "#e7e1cc"),
]
CHUNK_RAMP = [
    (0.00, "#3a4759"),
    (0.30, "#60748a"),
    (0.55, "#93a6b5"),
    (0.78, "#bfc9cf"),
    (1.00, "#dde0da"),
]

PALETTE_TINT = {
    "slate": {"multiply": (1.0, 1.0, 1.0), "offset": 0.0},
    "ice": {"multiply": (0.84, 0.95, 1.10), "offset": -0.03},
    "limestone": {"multiply": (1.08, 1.04, 0.93), "offset": 0.04},
}

rng = random.Random(SEED)
noise.seed_set(SEED)


def hex_lin(h, alpha=1.0):
    h = h.lstrip("#")
    channels = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    convert = lambda value: value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
    return (convert(channels[0]), convert(channels[1]), convert(channels[2]), alpha)


def link(collection, name, data):
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    return obj


def mesh_from_bm(bm, name):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    mesh.update()
    return mesh


def frame(normal):
    return normal.to_track_quat("Z", "Y").to_matrix()


def rand_dir():
    while True:
        vector = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
        if vector.length > 1e-6:
            return vector.normalized()


# ---- body -------------------------------------------------------------------
def shape_point(p, offset):
    x, y, z = p
    n1 = noise.noise(p * 1.3 + offset)
    n2 = noise.noise(p * 2.9 + offset * 1.7)
    radius = 1.0 + LUMP * n1 + LUMP * 0.45 * n2
    lobe = 1.0 + 0.16 * x
    waist = 1.0 - WAIST_PINCH * math.exp(-((x + 0.05) / 0.42) ** 2)
    yz = radius * lobe * waist
    return Vector(
        (
            x * BODY_STRETCH * math.sqrt(radius),
            y * yz,
            z * yz * 0.85 + BEND * (x * x - 0.3),
        )
    )


def surface_frame(u, offset):
    reference = Vector((0, 0, 1)) if abs(u.z) < 0.9 else Vector((1, 0, 0))
    tangent = u.cross(reference).normalized()
    bitangent = u.cross(tangent)
    e = 0.02
    point = shape_point(u, offset)
    point_t = shape_point((u + tangent * e).normalized(), offset)
    point_b = shape_point((u + bitangent * e).normalized(), offset)
    normal = (point_t - point).cross(point_b - point)
    if normal.dot(point) < 0:
        normal = -normal
    return point, normal.normalized(), normal.length / (e * e)


def poisson_points(offset):
    probe = [surface_frame(rand_dir(), offset)[2] for _ in range(500)]
    max_factor = max(probe) * 1.15
    area = 4 * math.pi * sum(probe) / len(probe)
    spacing = math.sqrt(area / FACET_COUNT * 1.1547)
    points = []
    shrink = 0.9
    stall = 0
    while len(points) < FACET_COUNT and shrink > 0.3:
        u = rand_dir()
        point, _normal, factor = surface_frame(u, offset)
        if rng.random() * max_factor > factor:
            continue
        size = 1.0 + rng.uniform(-1, 1) * FACET_SIZE_VARIATION
        if all(
            (point - other[1]).length > 0.5 * (size + other[2]) * shrink * spacing
            for other in points
        ):
            points.append((u, point, size))
            stall = 0
        else:
            stall += 1
            if stall > 2500:
                shrink *= 0.96
                stall = 0
    return points


def build_body():
    offset = Vector((rng.uniform(-9, 9), rng.uniform(-9, 9), rng.uniform(-9, 9)))
    points = poisson_points(offset)

    triangulated = bmesh.new()
    tri_verts = [triangulated.verts.new(u) for u, _, _ in points]
    bmesh.ops.convex_hull(triangulated, input=tri_verts)
    triangulated.verts.ensure_lookup_table()
    triangulated.faces.ensure_lookup_table()
    triangulated.faces.index_update()
    centers = [face.calc_center_median().normalized() for face in triangulated.faces]

    dual = bmesh.new()
    dual_verts = [
        dual.verts.new(shape_point(center, offset) * (1.0 + rng.uniform(-1, 1) * FACET_ROUGH))
        for center in centers
    ]
    for vertex in triangulated.verts:
        normal = vertex.co.normalized()
        reference = Vector((0, 0, 1)) if abs(normal.z) < 0.9 else Vector((1, 0, 0))
        tangent = normal.cross(reference).normalized()
        bitangent = normal.cross(tangent)

        def angle(face):
            center = centers[face.index]
            delta = center - normal * center.dot(normal)
            return math.atan2(delta.dot(bitangent), delta.dot(tangent))

        ring = sorted(vertex.link_faces, key=angle)
        try:
            dual.faces.new([dual_verts[face.index] for face in ring])
        except ValueError:
            pass
    triangulated.free()
    bmesh.ops.recalc_face_normals(dual, faces=dual.faces)

    low = Vector((min(v.co[i] for v in dual.verts) for i in range(3)))
    high = Vector((max(v.co[i] for v in dual.verts) for i in range(3)))
    middle = (low + high) / 2
    scale = BODY_LENGTH / (high.x - low.x)
    for vertex in dual.verts:
        vertex.co = (vertex.co - middle) * scale

    try:
        bmesh.ops.planar_faces(dual, faces=dual.faces[:], iterations=200, factor=1.0)
    except Exception as error:  # noqa: BLE001 - older Blender may not expose it
        print("planar_faces skipped:", error)
    bmesh.ops.recalc_face_normals(dual, faces=dual.faces)
    dual.normal_update()
    return dual


# ---- craters ----------------------------------------------------------------
def edge_gap(face, center):
    return min(
        (center - edge.verts[0].co).cross(
            (edge.verts[1].co - edge.verts[0].co).normalized()
        ).length
        for edge in face.edges
    )


def pick_crater_sites(bm, view_local):
    sites = []
    for count, (r_min, r_max), depth_ratio, min_dot, fraction in CRATERS:
        pool = [face for face in bm.faces if face.normal.dot(view_local) >= min_dot]
        pool.sort(key=lambda face: -face.calc_area())
        pool = pool[: max(count * 4, int(len(pool) * fraction))]
        rng.shuffle(pool)
        placed = 0
        for face in pool:
            radius = rng.uniform(r_min, r_max)
            normal = face.normal
            reference = Vector((0, 0, 1)) if abs(normal.z) < 0.9 else Vector((1, 0, 0))
            tangent = normal.cross(reference).normalized()
            bitangent = normal.cross(tangent)
            nudge = 0.18 * math.sqrt(face.calc_area())
            center = (
                face.calc_center_median()
                + tangent * rng.uniform(-nudge, nudge)
                + bitangent * rng.uniform(-nudge, nudge)
            )
            if radius < 0.18:
                radius = min(radius, edge_gap(face, center) / 1.2)
            if radius < r_min * 0.75:
                continue
            if all((center - site["c"]).length > (radius + site["R"]) * 1.25 for site in sites):
                sites.append(
                    dict(
                        c=center,
                        n=normal.copy(),
                        R=radius,
                        depth=radius * depth_ratio + 0.03,
                        pit=radius < 0.06,
                    )
                )
                placed += 1
                if placed == count:
                    break
    return sites


def build_cutter(site):
    radius = site["R"]
    depth = site["depth"]
    over = radius * 0.7
    height = depth + over
    floor_radius = radius * FLOOR_RATIO
    top_radius = floor_radius + (radius - floor_radius) * height / depth
    yaw = rng.uniform(0, math.tau)
    matrix = frame(site["n"])

    bm = bmesh.new()
    bottom = []
    top = []
    for index in range(CRATER_SIDES):
        angle = yaw + index * math.tau / CRATER_SIDES
        wobble = 1.0 + rng.uniform(-0.06, 0.06)
        cos_angle, sin_angle = math.cos(angle), math.sin(angle)
        bottom.append(
            bm.verts.new(
                matrix @ Vector((floor_radius * wobble * cos_angle, floor_radius * wobble * sin_angle, -depth))
                + site["c"]
            )
        )
        top.append(
            bm.verts.new(
                matrix @ Vector((top_radius * wobble * cos_angle, top_radius * wobble * sin_angle, over))
                + site["c"]
            )
        )
    count = CRATER_SIDES
    for index in range(count):
        following = (index + 1) % count
        bm.faces.new((bottom[index], bottom[following], top[following], top[index]))
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for face in bm.faces:
        face.material_index = 1
    return bm


def cut_craters(rock, sites, collection, materials):
    succeeded = []
    for index, site in enumerate(sites):
        cutter_bm = build_cutter(site)
        cutter_mesh = mesh_from_bm(cutter_bm, f"cutter_{index}")
        cutter_bm.free()
        for material in materials:
            cutter_mesh.materials.append(material)
        cutter = link(collection, f"cutter_{index}", cutter_mesh)
        modifier = rock.modifiers.new("crater", "BOOLEAN")
        modifier.operation = "DIFFERENCE"
        modifier.operand_type = "OBJECT"
        modifier.object = cutter
        modifier.solver = "EXACT"
        try:
            modifier.material_mode = "INDEX"
        except Exception:  # noqa: BLE001
            pass
        bpy.context.view_layer.update()
        evaluated = rock.evaluated_get(bpy.context.evaluated_depsgraph_get())
        new_mesh = bpy.data.meshes.new_from_object(evaluated)
        old_mesh = rock.data
        rock.modifiers.remove(modifier)
        if len(new_mesh.polygons) == 0:
            # A cut that would destroy the rock: keep the current mesh.
            bpy.data.meshes.remove(new_mesh)
        else:
            rock.data = new_mesh
            bpy.data.meshes.remove(old_mesh)
            succeeded.append(index)
        bpy.data.objects.remove(cutter, do_unlink=True)
        bpy.data.meshes.remove(cutter_mesh)
    return succeeded


def add_plates(rock, sites, view_local, side_material_index=3):
    """Extrude clusters of adjacent facets into overlapping slabs."""
    bm = bmesh.new()
    bm.from_mesh(rock.data)
    bm.faces.ensure_lookup_table()

    max_projected = 0.0
    for vertex in bm.verts:
        projected = vertex.co - view_local * vertex.co.dot(view_local)
        max_projected = max(max_projected, projected.length)

    candidates = []
    for face in bm.faces:
        if face.material_index != 0:
            continue
        area = face.calc_area()
        perimeter = face.calc_perimeter()
        if area < 0.015 or perimeter <= 0:
            continue
        if area / (perimeter * perimeter) < 0.045:
            continue
        if min(edge.calc_length() for edge in face.edges) < 0.07:
            continue
        center = face.calc_center_median()
        projected = center - view_local * center.dot(view_local)
        if projected.length > max_projected * 0.78:
            continue
        candidates.append(face)
    rng.shuffle(candidates)

    used = set()
    plates = 0
    for seed in candidates:
        if plates >= 10 + rng.randrange(5):
            break
        if seed in used:
            continue
        center = seed.calc_center_median()
        if any((center - site["c"]).length < site["R"] * 1.5 for site in sites):
            continue
        plate = {seed}
        frontier = [seed]
        for _level in range(1 + rng.randrange(2)):
            next_frontier = []
            for face in frontier:
                for edge in face.edges:
                    for linked in edge.link_faces:
                        if linked in plate or linked in used:
                            continue
                        if linked.material_index != 0 and linked not in used:
                            continue
                        linked_area = linked.calc_area()
                        linked_perimeter = linked.calc_perimeter()
                        if linked_area < 0.01 or linked_perimeter <= 0:
                            continue
                        if linked_area / (linked_perimeter * linked_perimeter) < 0.04:
                            continue
                        if min(edge2.calc_length() for edge2 in linked.edges) < 0.06:
                            continue
                        plate.add(linked)
                        next_frontier.append(linked)
            frontier = next_frontier
        if len(plate) < 2:
            continue
        for face in plate:
            used.add(face)
        normal = Vector((0.0, 0.0, 0.0))
        for face in plate:
            normal += face.normal * face.calc_area()
        normal.normalize()
        raise_amount = rng.uniform(0.012, 0.028)
        result = bmesh.ops.inset_region(
            bm,
            faces=list(plate),
            thickness=0.01,
            depth=raise_amount,
            use_even_offset=True,
        )
        # The inset ring becomes the dark beveled skirt of the raised plate.
        for skirt_face in result.get("faces", []):
            skirt_face.material_index = side_material_index
        plates += 1
    # Remove degenerate slivers created where plate regions meet at sharp angles.
    try:
        bmesh.ops.dissolve_degenerate(bm, dist=1e-4, edges=bm.edges[:])
    except Exception:
        pass
    bm.to_mesh(rock.data)
    bm.free()
    rock.data.update()


def bevel_weights(mesh, sites):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    weights = []
    for edge in bm.edges:
        weight = 0.0
        if len(edge.link_faces) == 2 and edge.calc_face_angle(0.0) > math.radians(18):
            weight = 1.0
            middle = (edge.verts[0].co + edge.verts[1].co) / 2
            for site in sites:
                offset = middle - site["c"]
                axial = offset.dot(site["n"])
                radial = (offset - site["n"] * axial).length
                if abs(radial - site["R"]) < site["R"] * 0.12 and abs(axial) < site["R"] * 0.12:
                    weight = 1.3
                    break
            if any(site["pit"] and (middle - site["c"]).length < site["R"] * 1.9 for site in sites):
                weight = 0.4
            # Thin plate skirts should not grow wide bright bevel bars.
            if any(face.material_index == 3 for face in edge.link_faces):
                weight = min(weight, 0.5)
        weights.append(weight)
    bm.free()
    attribute = mesh.attributes.new("bevel_weight_edge", "FLOAT", "EDGE")
    attribute.data.foreach_set("value", weights)


def tag_facets(mesh):
    representatives = []
    values = []
    for polygon in mesh.polygons:
        normal = polygon.normal
        distance = polygon.normal.dot(polygon.center)
        value = None
        for rep_normal, rep_distance, rep_value in representatives:
            if normal.dot(rep_normal) > 0.9985 and abs(distance - rep_distance) < 0.01:
                value = rep_value
                break
        if value is None:
            value = rng.random()
            representatives.append((normal.copy(), distance, value))
        values.append(value)
    attribute = mesh.attributes.new("facet_rand", "FLOAT", "FACE")
    attribute.data.foreach_set("value", values)


# ---- bits -------------------------------------------------------------------
def scatter_points(mesh, count, view_local, view_bias, avoid, taken, footprint, gap, min_dot=-1.0, max_projected=None):
    polygons = [
        polygon
        for polygon in mesh.polygons
        if polygon.material_index == 0
        and polygon.area > footprint**2 * 6
        and polygon.normal.dot(view_local) >= min_dot
    ]
    if not polygons:
        return []
    weights = [polygon.area * max(0.04, polygon.normal.dot(view_local) + view_bias) for polygon in polygons]
    output = []
    tries = 0
    while len(output) < count and tries < count * 400:
        tries += 1
        polygon = rng.choices(polygons, weights)[0]
        vertices = [mesh.vertices[index].co for index in polygon.vertices]
        point = polygon.center.lerp(rng.choice(vertices), rng.uniform(0.0, 0.4))
        if max_projected is not None:
            projected = point - view_local * point.dot(view_local)
            if projected.length > max_projected * 0.78:
                continue
        if any((point - center).length < radius * 1.4 + footprint for center, radius in avoid):
            continue
        if any((point - other).length < gap + footprint for other in taken + [item[0] for item in output]):
            continue
        output.append((point, polygon.normal.copy()))
    return output


def add_prism(bm, matrix, position, bottom_radius, top_radius, z0, z1, sides, yaw, material_index=0):
    bottom = []
    top = []
    for index in range(sides):
        angle = yaw + index * math.tau / sides
        cos_angle, sin_angle = math.cos(angle), math.sin(angle)
        bottom.append(
            bm.verts.new(matrix @ Vector((bottom_radius * cos_angle, bottom_radius * sin_angle, z0)) + position)
        )
        top.append(
            bm.verts.new(matrix @ Vector((top_radius * cos_angle, top_radius * sin_angle, z1)) + position)
        )
    faces = []
    for index in range(sides):
        following = (index + 1) % sides
        faces.append(bm.faces.new((bottom[index], bottom[following], top[following], top[index])))
    faces.append(bm.faces.new(list(reversed(bottom))))
    faces.append(bm.faces.new(top))
    for face in faces:
        face.material_index = material_index
    return faces


def add_chunk(bm, matrix, position, size):
    result = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    scale_x = size * rng.uniform(0.8, 1.3)
    scale_y = size * rng.uniform(0.7, 1.2)
    scale_z = size * rng.uniform(0.7, 1.2)
    spin = Euler(
        (rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), rng.uniform(0, math.tau))
    ).to_matrix()
    for vertex in result["verts"]:
        vertex.co = Vector((vertex.co.x * scale_x, vertex.co.y * scale_y, vertex.co.z * scale_z))
        vertex.co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * size * 0.22
        vertex.co = matrix @ (spin @ vertex.co) + position
    for face in {face for vertex in result["verts"] for face in vertex.link_faces}:
        face.material_index = 1


def build_bits(mesh, sites, view_local, collection, materials):
    bm = bmesh.new()
    avoid = [(site["c"], site["R"]) for site in sites]
    taken = []
    max_projected = 0.0
    for vertex in mesh.vertices:
        projected = vertex.co - view_local * vertex.co.dot(view_local)
        max_projected = max(max_projected, projected.length)

    for point, normal in scatter_points(
        mesh, N_CHUNKS, view_local, 0.60, avoid, taken, 0.10, 0.30, min_dot=0.65, max_projected=max_projected
    ):
        taken.append(point)
        size = rng.uniform(0.13, 0.2)
        add_chunk(bm, frame(normal), point + normal * size * 0.35, size)

    for point, normal in scatter_points(
        mesh, N_STUDS, view_local, 0.35, avoid, taken, 0.08, 0.17, min_dot=0.25, max_projected=max_projected
    ):
        taken.append(point)
        stud_radius = rng.uniform(0.05, 0.085)
        height = stud_radius * rng.uniform(1.0, 1.5)
        add_prism(
            bm,
            frame(normal),
            point,
            stud_radius,
            stud_radius * 0.82,
            -height * 0.6,
            height * 0.45,
            8,
            rng.uniform(0, math.tau),
            0,
        )

    for point, normal in scatter_points(
        mesh, N_DOTS, view_local, 0.25, avoid, taken, 0.03, 0.08, min_dot=0.0, max_projected=max_projected
    ):
        taken.append(point)
        dot_radius = rng.uniform(0.016, 0.026)
        add_prism(
            bm,
            frame(normal),
            point,
            dot_radius,
            dot_radius * 0.8,
            -dot_radius * 0.4,
            dot_radius * 0.7,
            8,
            rng.uniform(0, math.tau),
            0,
        )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bits_mesh = bpy.data.meshes.new("asteroid_bits")
    bm.to_mesh(bits_mesh)
    bm.free()
    bits = link(collection, "Asteroid_Bits", bits_mesh)
    bits.data.polygons.foreach_set("use_smooth", [False] * len(bits.data.polygons))
    for material in materials:
        bits_mesh.materials.append(material)
    return bits


# ---- materials --------------------------------------------------------------
def paint_material(name, stops, t_offset=0.0, multiply=(1.0, 1.0, 1.0), rand_amt=0.42,
                   blotch=0.17, streak=0.11, scratches=0.24, pits=0.70):
    old = bpy.data.materials.get(name)
    if old:
        bpy.data.materials.remove(old)
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    def node(kind, **kwargs):
        created = nodes.new(kind)
        for key, value in kwargs.items():
            setattr(created, key, value)
        return created

    def put(target, index, value):
        if isinstance(value, bpy.types.NodeSocket):
            links.new(value, target.inputs[index])
        else:
            target.inputs[index].default_value = value

    def math_node(operation, a=None, b=None, c=None, clamp=False):
        created = node("ShaderNodeMath", operation=operation, use_clamp=clamp)
        for index, value in enumerate((a, b, c)):
            if value is not None:
                put(created, index, value)
        return created.outputs[0]

    def mix_node(factor, a, b, blend="MIX"):
        created = node("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        put(created, 0, factor)
        put(created, 6, a)
        put(created, 7, b)
        return created.outputs[2]

    def noise_tex(coordinate, scale_vector, noise_scale, detail=5.0, roughness=0.55):
        mapping = node("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = scale_vector
        links.new(coordinate, mapping.inputs["Vector"])
        texture = node("ShaderNodeTexNoise", noise_dimensions="3D")
        texture.inputs["Scale"].default_value = noise_scale
        texture.inputs["Detail"].default_value = detail
        texture.inputs["Roughness"].default_value = roughness
        links.new(mapping.outputs[0], texture.inputs["Vector"])
        return texture.outputs["Fac"]

    def threshold(value, low, high):
        ramp = node("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = low
        ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
        ramp.color_ramp.elements[1].position = high
        ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
        links.new(value, ramp.inputs[0])
        return ramp.outputs[0]

    geometry = node("ShaderNodeNewGeometry")
    coordinates = node("ShaderNodeTexCoord")
    object_coordinates = coordinates.outputs["Object"]

    dot = node("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    links.new(geometry.outputs["Normal"], dot.inputs[0])
    dot.inputs[1].default_value = tuple(Vector(LIGHT_DIR).normalized())
    value = math_node("MULTIPLY_ADD", dot.outputs["Value"], 0.95, 0.02 + t_offset)
    value = math_node("MAXIMUM", value, 0.15 + t_offset * 0.6)

    facet_attribute = node("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name="facet_rand")
    value = math_node(
        "ADD",
        value,
        math_node("MULTIPLY", math_node("SUBTRACT", facet_attribute.outputs["Fac"], 0.5), rand_amt),
    )

    blotch_noise = noise_tex(object_coordinates, (1.0, 1.0, 1.0), 2.2, 6.0)
    value = math_node("ADD", value, math_node("MULTIPLY", math_node("SUBTRACT", blotch_noise, 0.5), blotch * 2))
    streak_noise = noise_tex(object_coordinates, (1.0, 9.0, 1.0), 3.0, 4.0)
    value = math_node("ADD", value, math_node("MULTIPLY", math_node("SUBTRACT", streak_noise, 0.5), streak * 2))
    value = math_node("ADD", value, 0.0, clamp=True)
    value = math_node("POWER", value, 1.15)

    ramp = node("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "LINEAR"
    elements = ramp.color_ramp.elements
    elements[0].position = stops[0][0]
    elements[1].position = stops[-1][0]
    for position, _ in stops[1:-1]:
        elements.new(position)
    for element, (_, color) in zip(elements, stops):
        element.color = hex_lin(color)
    links.new(value, ramp.inputs[0])
    color = ramp.outputs[0]

    for direction in ((40.0, 3.0, 3.0), (3.0, 34.0, 3.0)):
        mask = threshold(noise_tex(object_coordinates, direction, 1.0, 2.0, 0.5), 0.665, 0.685)
        sparse = threshold(noise_tex(object_coordinates, (1.0, 1.0, 1.0), 1.3, 2.0), 0.50, 0.60)
        color = mix_node(
            math_node("MULTIPLY", math_node("MULTIPLY", mask, sparse), scratches),
            color,
            hex_lin("#e9e7dc"),
        )

    voronoi = node("ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="F1")
    voronoi.inputs["Scale"].default_value = 30.0
    links.new(object_coordinates, voronoi.inputs["Vector"])
    dots = math_node("SUBTRACT", 1.0, threshold(voronoi.outputs["Distance"], 0.0, 0.07))
    sparse = threshold(noise_tex(object_coordinates, (1.0, 1.0, 1.0), 1.7, 2.0), 0.58, 0.64)
    color = mix_node(math_node("MULTIPLY", math_node("MULTIPLY", dots, sparse), pits), color, hex_lin("#1a2434"))

    if tuple(multiply) != (1.0, 1.0, 1.0):
        color = mix_node(1.0, color, (multiply[0], multiply[1], multiply[2], 1.0), "MULTIPLY")

    emission = node("ShaderNodeEmission")
    links.new(color, emission.inputs[0])
    output = node("ShaderNodeOutputMaterial")
    links.new(emission.outputs[0], output.inputs[0])
    return material


# ---- render passes -----------------------------------------------------------
def render_normal_map(scene, output_path):
    material = bpy.data.materials.new("normal")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    geometry = nodes.new("ShaderNodeNewGeometry")
    transform = nodes.new("ShaderNodeVectorTransform")
    transform.vector_type = "NORMAL"
    transform.convert_from = "WORLD"
    transform.convert_to = "CAMERA"
    separate = nodes.new("ShaderNodeSeparateXYZ")
    combine = nodes.new("ShaderNodeCombineXYZ")
    flip = nodes.new("ShaderNodeMath")
    flip.operation = "MULTIPLY"
    flip.inputs[1].default_value = -1.0
    encode = nodes.new("ShaderNodeVectorMath")
    encode.operation = "MULTIPLY_ADD"
    encode.inputs[1].default_value = (0.5, 0.5, 0.5)
    encode.inputs[2].default_value = (0.5, 0.5, 0.5)
    links.new(geometry.outputs["Normal"], transform.inputs["Vector"])
    links.new(transform.outputs["Vector"], separate.inputs["Vector"])
    links.new(separate.outputs["X"], combine.inputs["X"])
    links.new(separate.outputs["Y"], flip.inputs[0])
    links.new(flip.outputs[0], combine.inputs["Y"])
    links.new(separate.outputs["Z"], combine.inputs["Z"])
    links.new(combine.outputs["Vector"], encode.inputs[0])
    links.new(encode.outputs["Vector"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    scene.view_layers[0].material_override = material
    scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True)


def main():
    tint = PALETTE_TINT.get(PALETTE, PALETTE_TINT["slate"])

    bpy.ops.wm.read_homefile(use_empty=True, use_factory_startup=True)
    scene = bpy.context.scene

    collection = bpy.data.collections.new("Asteroid")
    scene.collection.children.link(collection)

    rock_material = paint_material(
        "AST_rock", ROCK_RAMP, multiply=tint["multiply"], t_offset=tint["offset"]
    )
    crater_material = paint_material(
        "AST_crater",
        ROCK_RAMP,
        t_offset=tint["offset"] - 0.2,
        multiply=(0.5 * tint["multiply"][0], 0.6 * tint["multiply"][1], 0.8 * tint["multiply"][2]),
        scratches=0.2,
        pits=0.25,
    )
    edge_material = paint_material(
        "AST_edge",
        ROCK_RAMP,
        t_offset=tint["offset"] + 0.12,
        rand_amt=0.06,
        blotch=0.05,
        streak=0.04,
        scratches=0.0,
        pits=0.0,
        multiply=tint["multiply"],
    )
    stud_material = paint_material(
        "AST_stud",
        ROCK_RAMP,
        t_offset=0.12,
        rand_amt=0.12,
        multiply=(1.04 * tint["multiply"][0], 1.02 * tint["multiply"][1], 0.98 * tint["multiply"][2]),
        scratches=0.15,
        pits=0.0,
    )
    chunk_material = paint_material("AST_chunk", CHUNK_RAMP, scratches=0.3, pits=0.0)
    side_material = paint_material(
        "AST_side",
        ROCK_RAMP,
        t_offset=tint["offset"] - 0.1,
        multiply=(0.6 * tint["multiply"][0], 0.68 * tint["multiply"][1], 0.82 * tint["multiply"][2]),
        scratches=0.15,
        pits=0.2,
    )
    wall_material = paint_material(
        "AST_wall",
        ROCK_RAMP,
        t_offset=tint["offset"] - 0.35,
        multiply=(0.4 * tint["multiply"][0], 0.48 * tint["multiply"][1], 0.66 * tint["multiply"][2]),
        scratches=0.1,
        pits=0.1,
    )
    rock_materials = [rock_material, crater_material, edge_material]

    rotation = Euler([math.radians(angle) for angle in ROOT_ROTATION_DEG], "XYZ").to_matrix()
    view_local = rotation.inverted() @ Vector((0, 0, 1))

    body = build_body()
    sites = pick_crater_sites(body, view_local)
    rock_mesh = mesh_from_bm(body, "asteroid_mesh")
    body.free()
    for material in rock_materials:
        rock_mesh.materials.append(material)
    rock = link(collection, "Asteroid", rock_mesh)

    succeeded = cut_craters(rock, sites, collection, rock_materials)
    rock.data.materials.append(side_material)
    rock.data.materials.append(wall_material)

    # Crater walls are darker than the flat floors.
    for polygon in rock.data.polygons:
        if polygon.material_index != 1:
            continue
        center = polygon.center
        for site in sites:
            offset = center - site["c"]
            axial = offset.dot(site["n"])
            radial = (offset - site["n"] * axial).length
            if -site["depth"] * 1.6 < axial < site["R"] * 0.15 and radial < site["R"] * 1.1:
                if site["R"] >= 0.075 and axial > -site["depth"] * 0.55:
                    polygon.material_index = 4
                break

    if PLATES_ENABLED:
        add_plates(rock, sites, view_local, 3)
    mesh = rock.data
    mesh.polygons.foreach_set("use_smooth", [False] * len(mesh.polygons))
    bevel_weights(mesh, sites)
    tag_facets(mesh)
    mesh.update()

    bits = build_bits(mesh, sites, view_local, collection, [stud_material, chunk_material])

    bevel = rock.modifiers.new("Bevel", "BEVEL")
    bevel.width = BEVEL_WIDTH
    bevel.segments = 1
    bevel.limit_method = "WEIGHT"
    bevel.material = 2

    bits_bevel = bits.modifiers.new("Bevel", "BEVEL")
    bits_bevel.width = BEVEL_WIDTH * 0.45
    bits_bevel.segments = 1
    bits_bevel.limit_method = "ANGLE"
    bits_bevel.angle_limit = math.radians(20)

    for obj in (rock, bits):
        obj.rotation_euler = Euler([math.radians(angle) for angle in ROOT_ROTATION_DEG], "XYZ")

    bpy.context.view_layer.update()

    # Camera looks down on the posed rock; frame it tightly like a sprite.
    points = [obj.matrix_world @ vertex.co for obj in (rock, bits) for vertex in obj.data.vertices]
    low = Vector((min(point[i] for point in points) for i in range(3)))
    high = Vector((max(point[i] for point in points) for i in range(3)))
    width = high.x - low.x
    height = high.y - low.y
    camera_data = bpy.data.cameras.new("AsteroidCam")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(width * 1.16, height * 1.16)
    camera = link(collection, "AsteroidCam", camera_data)
    camera.location = ((low.x + high.x) / 2, (low.y + high.y) / 2, high.z + 20.0)
    scene.camera = camera

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.dither_intensity = 0.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    scene.render.filepath = os.path.join(OUT_DIR, "color.png")
    bpy.ops.render.render(write_still=True)

    # Ambient occlusion pass: white diffuse override lit only by a white world.
    world = bpy.data.worlds.new("AmbientWorld")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    background.inputs["Strength"].default_value = 1.0
    scene.world = world

    ao_material = bpy.data.materials.new("ambient")
    ao_material.use_nodes = True
    ao_nodes = ao_material.node_tree.nodes
    ao_links = ao_material.node_tree.links
    ao_nodes.clear()
    ao_output = ao_nodes.new("ShaderNodeOutputMaterial")
    ao_diffuse = ao_nodes.new("ShaderNodeBsdfDiffuse")
    ao_diffuse.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    ao_links.new(ao_diffuse.outputs["BSDF"], ao_output.inputs["Surface"])
    scene.view_layers[0].material_override = ao_material
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.filepath = os.path.join(OUT_DIR, "ambient.png")
    bpy.ops.render.render(write_still=True)

    render_normal_map(scene, os.path.join(OUT_DIR, "normal.png"))

    import json

    result = {
        "color": os.path.join(OUT_DIR, "color.png"),
        "normal": os.path.join(OUT_DIR, "normal.png"),
        "craters": len(sites),
        "craterRadii": [round(sites[index]["R"], 3) for index in succeeded],
        "craterPolys": sum(1 for p in rock.data.polygons if p.material_index == 1),
        "edgePolys": sum(1 for p in rock.data.polygons if p.material_index == 2),
        "materialSlots": [mat.name for mat in rock.data.materials],
        "polys": len(mesh.polygons),
    }
    with open(os.path.join(OUT_DIR, "stats.json"), "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)


main()
