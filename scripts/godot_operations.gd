@tool
extends SceneTree

## Godot Operations Script for MCP Server
## This script is executed in headless mode to perform operations requested by the MCP server.
## Communication happens via command line arguments and stdout markers.

func _init():
	# Parse command line arguments
	var args = OS.get_cmdline_user_args()
	
	if args.size() < 1:
		_output_error("No operation specified")
		quit(1)
		return
	
	var operation = args[0]
	var params = {}
	
	if args.size() > 1:
		var json = JSON.new()
		var parse_result = json.parse(args[1])
		if parse_result == OK:
			params = json.data
		else:
			_output_error("Failed to parse parameters: " + json.get_error_message())
			quit(1)
			return
	
	# Execute the operation
	var result = _execute_operation(operation, params)
	_output_result(result)
	quit(0)


func _execute_operation(operation: String, params: Dictionary) -> Dictionary:
	match operation:
		"create_scene":
			return _create_scene(params)
		"add_node":
			return _add_node(params)
		"remove_node":
			return _remove_node(params)
		"modify_node":
			return _modify_node(params)
		"read_scene":
			return _read_scene(params)
		"list_nodes":
			return _list_nodes(params)
		"create_script":
			return _create_script(params)
		"attach_script":
			return _attach_script(params)
		"create_animation":
			return _create_animation(params)
		"add_animation_track":
			return _add_animation_track(params)
		"create_resource":
			return _create_resource(params)
		"get_project_info":
			return _get_project_info(params)
		"list_scenes":
			return _list_scenes(params)
		"list_scripts":
			return _list_scripts(params)
		_:
			return {"success": false, "error": "Unknown operation: " + operation}


# ============== Scene Operations ==============

func _create_scene(params: Dictionary) -> Dictionary:
	var scene_path = params.get("scene_path", "")
	var root_type = params.get("root_type", "Node2D")
	var root_name = params.get("root_name", "Root")
	
	if scene_path.is_empty():
		return {"success": false, "error": "scene_path is required"}
	
	# Create the root node
	var root_node = _create_node_of_type(root_type)
	if root_node == null:
		return {"success": false, "error": "Unknown node type: " + root_type}
	
	root_node.name = root_name
	
	# Create a packed scene
	var packed_scene = PackedScene.new()
	var result = packed_scene.pack(root_node)
	
	if result != OK:
		root_node.queue_free()
		return {"success": false, "error": "Failed to pack scene"}
	
	# Ensure directory exists
	var dir_path = scene_path.get_base_dir()
	if not dir_path.is_empty():
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir_path))
	
	# Save the scene
	result = ResourceSaver.save(packed_scene, scene_path)
	root_node.queue_free()
	
	if result != OK:
		return {"success": false, "error": "Failed to save scene: " + str(result)}
	
	return {
		"success": true,
		"message": "Created scene at " + scene_path,
		"scene_path": scene_path,
		"root_type": root_type,
		"root_name": root_name
	}


func _add_node(params: Dictionary) -> Dictionary:
	var scene_path = params.get("scene_path", "")
	var parent_path = params.get("parent_path", ".")
	var node_type = params.get("node_type", "Node")
	var node_name = params.get("node_name", "NewNode")
	var properties = params.get("properties", {})
	
	if scene_path.is_empty():
		return {"success": false, "error": "scene_path is required"}
	
	# Load the scene
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	
	var scene_root = packed_scene.instantiate()
	
	# Find the parent node
	var parent_node = scene_root if parent_path == "." else scene_root.get_node_or_null(parent_path)
	if parent_node == null:
		scene_root.queue_free()
		return {"success": false, "error": "Parent node not found: " + parent_path}
	
	# Create the new node
	var new_node = _create_node_of_type(node_type)
	if new_node == null:
		scene_root.queue_free()
		return {"success": false, "error": "Unknown node type: " + node_type}
	
	new_node.name = node_name
	
	# Set properties
	for prop_name in properties:
		if new_node.get(prop_name) != null or prop_name in new_node.get_property_list().map(func(p): return p.name):
			new_node.set(prop_name, properties[prop_name])
	
	# Add to parent
	parent_node.add_child(new_node)
	new_node.owner = scene_root
	
	# Save the scene
	var new_packed_scene = PackedScene.new()
	new_packed_scene.pack(scene_root)
	var result = ResourceSaver.save(new_packed_scene, scene_path)
	scene_root.queue_free()
	
	if result != OK:
		return {"success": false, "error": "Failed to save scene"}
	
	return {
		"success": true,
		"message": "Added " + node_type + " node '" + node_name + "' to " + parent_path,
		"node_path": parent_path + "/" + node_name if parent_path != "." else node_name
	}


func _remove_node(params: Dictionary) -> Dictionary:
	var scene_path = params.get("scene_path", "")
	var node_path = params.get("node_path", "")
	
	if scene_path.is_empty() or node_path.is_empty():
		return {"success": false, "error": "scene_path and node_path are required"}
	
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	
	var scene_root = packed_scene.instantiate()
	var node = scene_root.get_node_or_null(node_path)
	
	if node == null:
		scene_root.queue_free()
		return {"success": false, "error": "Node not found: " + node_path}
	
	if node == scene_root:
		scene_root.queue_free()
		return {"success": false, "error": "Cannot remove root node"}
	
	node.get_parent().remove_child(node)
	node.queue_free()
	
	var new_packed_scene = PackedScene.new()
	new_packed_scene.pack(scene_root)
	var result = ResourceSaver.save(new_packed_scene, scene_path)
	scene_root.queue_free()
	
	if result != OK:
		return {"success": false, "error": "Failed to save scene"}
	
	return {"success": true, "message": "Removed node: " + node_path}


func _modify_node(params: Dictionary) -> Dictionary:
	var scene_path = params.get("scene_path", "")
	var node_path = params.get("node_path", "")
	var properties = params.get("properties", {})
	
	if scene_path.is_empty() or node_path.is_empty():
		return {"success": false, "error": "scene_path and node_path are required"}
	
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	
	var scene_root = packed_scene.instantiate()
	var node = scene_root.get_node_or_null(node_path) if node_path != "." else scene_root
	
	if node == null:
		scene_root.queue_free()
		return {"success": false, "error": "Node not found: " + node_path}
	
	var modified_props = []
	for prop_name in properties:
		var value = properties[prop_name]
		# Convert special types
		value = _convert_property_value(value)
		node.set(prop_name, value)
		modified_props.append(prop_name)
	
	var new_packed_scene = PackedScene.new()
	new_packed_scene.pack(scene_root)
	var result = ResourceSaver.save(new_packed_scene, scene_path)
	scene_root.queue_free()
	
	if result != OK:
		return {"success": false, "error": "Failed to save scene"}
	
	return {
		"success": true,
		"message": "Modified properties on " + node_path,
		"modified_properties": modified_props
	}


func _read_scene(params: Dictionary) -> Dictionary:
	var scene_path = params.get("scene_path", "")
	
	if scene_path.is_empty():
		return {"success": false, "error": "scene_path is required"}
	
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	
	var scene_root = packed_scene.instantiate()
	var tree_structure = _serialize_node_tree(scene_root)
	scene_root.queue_free()
	
	return {
		"success": true,
		"scene_path": scene_path,
		"tree": tree_structure
	}


func _list_nodes(params: Dictionary) -> Dictionary:
	var scene_path = params.get("scene_path", "")
	
	if scene_path.is_empty():
		return {"success": false, "error": "scene_path is required"}
	
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	
	var scene_root = packed_scene.instantiate()
	var nodes = []
	_collect_node_paths(scene_root, scene_root, nodes)
	scene_root.queue_free()
	
	return {"success": true, "nodes": nodes}


# ============== Script Operations ==============

func _create_script(params: Dictionary) -> Dictionary:
	var script_path = params.get("script_path", "")
	var extends_type = params.get("extends", "Node")
	var class_name_str = params.get("class_name", "")
	var content = params.get("content", "")
	var template = params.get("template", "default")
	
	if script_path.is_empty():
		return {"success": false, "error": "script_path is required"}
	
	var script_content = ""
	
	if not content.is_empty():
		script_content = content
	else:
		# Generate from template
		script_content = _generate_script_template(extends_type, class_name_str, template)
	
	# Ensure directory exists
	var dir_path = script_path.get_base_dir()
	if not dir_path.is_empty():
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir_path))
	
	# Write the script file
	var file = FileAccess.open(script_path, FileAccess.WRITE)
	if file == null:
		return {"success": false, "error": "Failed to create script file"}
	
	file.store_string(script_content)
	file.close()
	
	return {
		"success": true,
		"message": "Created script at " + script_path,
		"script_path": script_path
	}


func _attach_script(params: Dictionary) -> Dictionary:
	var scene_path = params.get("scene_path", "")
	var node_path = params.get("node_path", ".")
	var script_path = params.get("script_path", "")
	
	if scene_path.is_empty() or script_path.is_empty():
		return {"success": false, "error": "scene_path and script_path are required"}
	
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	
	var script = load(script_path) as GDScript
	if script == null:
		return {"success": false, "error": "Failed to load script: " + script_path}
	
	var scene_root = packed_scene.instantiate()
	var node = scene_root.get_node_or_null(node_path) if node_path != "." else scene_root
	
	if node == null:
		scene_root.queue_free()
		return {"success": false, "error": "Node not found: " + node_path}
	
	node.set_script(script)
	
	var new_packed_scene = PackedScene.new()
	new_packed_scene.pack(scene_root)
	var result = ResourceSaver.save(new_packed_scene, scene_path)
	scene_root.queue_free()
	
	if result != OK:
		return {"success": false, "error": "Failed to save scene"}
	
	return {
		"success": true,
		"message": "Attached script " + script_path + " to " + node_path
	}


# ============== Animation Operations ==============

func _create_animation(params: Dictionary) -> Dictionary:
	var scene_path = params.get("scene_path", "")
	var node_path = params.get("node_path", ".")
	var animation_name = params.get("animation_name", "default")
	var duration = params.get("duration", 1.0)
	var loop = params.get("loop", false)
	
	if scene_path.is_empty():
		return {"success": false, "error": "scene_path is required"}
	
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	
	var scene_root = packed_scene.instantiate()
	var target_node = scene_root.get_node_or_null(node_path) if node_path != "." else scene_root
	
	if target_node == null:
		scene_root.queue_free()
		return {"success": false, "error": "Node not found: " + node_path}
	
	# Find or create AnimationPlayer
	var anim_player: AnimationPlayer = null
	for child in target_node.get_children():
		if child is AnimationPlayer:
			anim_player = child
			break
	
	if anim_player == null:
		anim_player = AnimationPlayer.new()
		anim_player.name = "AnimationPlayer"
		target_node.add_child(anim_player)
		anim_player.owner = scene_root
	
	# Create the animation
	var animation = Animation.new()
	animation.length = duration
	animation.loop_mode = Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE
	
	# Add to animation library
	var library: AnimationLibrary
	if anim_player.has_animation_library(""):
		library = anim_player.get_animation_library("")
	else:
		library = AnimationLibrary.new()
		anim_player.add_animation_library("", library)
	
	library.add_animation(animation_name, animation)
	
	var new_packed_scene = PackedScene.new()
	new_packed_scene.pack(scene_root)
	var result = ResourceSaver.save(new_packed_scene, scene_path)
	scene_root.queue_free()
	
	if result != OK:
		return {"success": false, "error": "Failed to save scene"}
	
	return {
		"success": true,
		"message": "Created animation '" + animation_name + "' with duration " + str(duration) + "s"
	}


func _add_animation_track(params: Dictionary) -> Dictionary:
	var scene_path = params.get("scene_path", "")
	var animation_player_path = params.get("animation_player_path", "")
	var animation_name = params.get("animation_name", "default")
	var target_node_path = params.get("target_node_path", "")
	var property = params.get("property", "")
	var keyframes = params.get("keyframes", [])
	
	if scene_path.is_empty() or animation_player_path.is_empty():
		return {"success": false, "error": "scene_path and animation_player_path are required"}
	
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	
	var scene_root = packed_scene.instantiate()
	var anim_player = scene_root.get_node_or_null(animation_player_path) as AnimationPlayer
	
	if anim_player == null:
		scene_root.queue_free()
		return {"success": false, "error": "AnimationPlayer not found: " + animation_player_path}
	
	var animation = anim_player.get_animation(animation_name)
	if animation == null:
		scene_root.queue_free()
		return {"success": false, "error": "Animation not found: " + animation_name}
	
	# Create the track
	var track_path = target_node_path + ":" + property
	var track_idx = animation.add_track(Animation.TYPE_VALUE)
	animation.track_set_path(track_idx, track_path)
	
	# Add keyframes
	for kf in keyframes:
		var time = kf.get("time", 0.0)
		var value = _convert_property_value(kf.get("value"))
		animation.track_insert_key(track_idx, time, value)
	
	var new_packed_scene = PackedScene.new()
	new_packed_scene.pack(scene_root)
	var result = ResourceSaver.save(new_packed_scene, scene_path)
	scene_root.queue_free()
	
	if result != OK:
		return {"success": false, "error": "Failed to save scene"}
	
	return {
		"success": true,
		"message": "Added animation track for " + property + " on " + target_node_path
	}


# ============== Resource Operations ==============

func _create_resource(params: Dictionary) -> Dictionary:
	var resource_path = params.get("resource_path", "")
	var resource_type = params.get("resource_type", "")
	var properties = params.get("properties", {})
	
	if resource_path.is_empty() or resource_type.is_empty():
		return {"success": false, "error": "resource_path and resource_type are required"}
	
	var resource = _create_resource_of_type(resource_type)
	if resource == null:
		return {"success": false, "error": "Unknown resource type: " + resource_type}
	
	# Set properties
	for prop_name in properties:
		var value = _convert_property_value(properties[prop_name])
		resource.set(prop_name, value)
	
	# Ensure directory exists
	var dir_path = resource_path.get_base_dir()
	if not dir_path.is_empty():
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir_path))
	
	var result = ResourceSaver.save(resource, resource_path)
	
	if result != OK:
		return {"success": false, "error": "Failed to save resource"}
	
	return {
		"success": true,
		"message": "Created " + resource_type + " at " + resource_path
	}


# ============== Project Operations ==============

func _get_project_info(params: Dictionary) -> Dictionary:
	var config = ConfigFile.new()
	var err = config.load("res://project.godot")
	
	if err != OK:
		return {"success": false, "error": "Failed to load project.godot"}
	
	return {
		"success": true,
		"project_name": config.get_value("application", "config/name", "Unknown"),
		"main_scene": config.get_value("application", "run/main_scene", ""),
		"godot_version": Engine.get_version_info(),
		"project_path": ProjectSettings.globalize_path("res://")
	}


func _list_scenes(params: Dictionary) -> Dictionary:
	var scenes = []
	_scan_for_files("res://", [".tscn", ".scn"], scenes)
	return {"success": true, "scenes": scenes}


func _list_scripts(params: Dictionary) -> Dictionary:
	var scripts = []
	_scan_for_files("res://", [".gd"], scripts)
	return {"success": true, "scripts": scripts}


# ============== Helper Functions ==============

func _create_node_of_type(type_name: String) -> Node:
	match type_name:
		"Node": return Node.new()
		"Node2D": return Node2D.new()
		"Node3D": return Node3D.new()
		"Sprite2D": return Sprite2D.new()
		"Sprite3D": return Sprite3D.new()
		"Camera2D": return Camera2D.new()
		"Camera3D": return Camera3D.new()
		"CharacterBody2D": return CharacterBody2D.new()
		"CharacterBody3D": return CharacterBody3D.new()
		"RigidBody2D": return RigidBody2D.new()
		"RigidBody3D": return RigidBody3D.new()
		"StaticBody2D": return StaticBody2D.new()
		"StaticBody3D": return StaticBody3D.new()
		"Area2D": return Area2D.new()
		"Area3D": return Area3D.new()
		"CollisionShape2D": return CollisionShape2D.new()
		"CollisionShape3D": return CollisionShape3D.new()
		"MeshInstance3D": return MeshInstance3D.new()
		"DirectionalLight3D": return DirectionalLight3D.new()
		"PointLight2D": return PointLight2D.new()
		"OmniLight3D": return OmniLight3D.new()
		"SpotLight3D": return SpotLight3D.new()
		"AnimationPlayer": return AnimationPlayer.new()
		"AnimatedSprite2D": return AnimatedSprite2D.new()
		"AudioStreamPlayer": return AudioStreamPlayer.new()
		"AudioStreamPlayer2D": return AudioStreamPlayer2D.new()
		"AudioStreamPlayer3D": return AudioStreamPlayer3D.new()
		"Control": return Control.new()
		"Label": return Label.new()
		"Button": return Button.new()
		"TextureRect": return TextureRect.new()
		"Panel": return Panel.new()
		"CanvasLayer": return CanvasLayer.new()
		"ParallaxBackground": return ParallaxBackground.new()
		"ParallaxLayer": return ParallaxLayer.new()
		"TileMap": return TileMap.new()
		"Path2D": return Path2D.new()
		"Path3D": return Path3D.new()
		"PathFollow2D": return PathFollow2D.new()
		"PathFollow3D": return PathFollow3D.new()
		"Timer": return Timer.new()
		"GPUParticles2D": return GPUParticles2D.new()
		"GPUParticles3D": return GPUParticles3D.new()
		"CPUParticles2D": return CPUParticles2D.new()
		"CPUParticles3D": return CPUParticles3D.new()
		"WorldEnvironment": return WorldEnvironment.new()
		"NavigationRegion2D": return NavigationRegion2D.new()
		"NavigationRegion3D": return NavigationRegion3D.new()
		_:
			# Try to instantiate by class name
			if ClassDB.class_exists(type_name):
				return ClassDB.instantiate(type_name)
			return null


func _create_resource_of_type(type_name: String) -> Resource:
	match type_name:
		"CircleShape2D": return CircleShape2D.new()
		"RectangleShape2D": return RectangleShape2D.new()
		"CapsuleShape2D": return CapsuleShape2D.new()
		"BoxShape3D": return BoxShape3D.new()
		"SphereShape3D": return SphereShape3D.new()
		"CapsuleShape3D": return CapsuleShape3D.new()
		"StandardMaterial3D": return StandardMaterial3D.new()
		"ShaderMaterial": return ShaderMaterial.new()
		"CanvasItemMaterial": return CanvasItemMaterial.new()
		"BoxMesh": return BoxMesh.new()
		"SphereMesh": return SphereMesh.new()
		"CapsuleMesh": return CapsuleMesh.new()
		"CylinderMesh": return CylinderMesh.new()
		"PlaneMesh": return PlaneMesh.new()
		"QuadMesh": return QuadMesh.new()
		"Environment": return Environment.new()
		"Curve": return Curve.new()
		"Curve2D": return Curve2D.new()
		"Curve3D": return Curve3D.new()
		"Gradient": return Gradient.new()
		"GradientTexture1D": return GradientTexture1D.new()
		"GradientTexture2D": return GradientTexture2D.new()
		"NoiseTexture2D": return NoiseTexture2D.new()
		"Animation": return Animation.new()
		"AnimationLibrary": return AnimationLibrary.new()
		"SpriteFrames": return SpriteFrames.new()
		"LabelSettings": return LabelSettings.new()
		"StyleBoxFlat": return StyleBoxFlat.new()
		"StyleBoxTexture": return StyleBoxTexture.new()
		_:
			if ClassDB.class_exists(type_name):
				var res = ClassDB.instantiate(type_name)
				if res is Resource:
					return res
			return null


func _generate_script_template(extends_type: String, class_name_str: String, template: String) -> String:
	var script = ""
	
	if not class_name_str.is_empty():
		script += "class_name " + class_name_str + "\n"
	
	script += "extends " + extends_type + "\n\n"
	
	match template:
		"empty":
			script += "# Empty script\npass\n"
		"character_2d":
			script += """const SPEED = 300.0
const JUMP_VELOCITY = -400.0

func _physics_process(delta: float) -> void:
	# Add gravity
	if not is_on_floor():
		velocity += get_gravity() * delta

	# Handle jump
	if Input.is_action_just_pressed("ui_accept") and is_on_floor():
		velocity.y = JUMP_VELOCITY

	# Get input direction
	var direction := Input.get_axis("ui_left", "ui_right")
	if direction:
		velocity.x = direction * SPEED
	else:
		velocity.x = move_toward(velocity.x, 0, SPEED)

	move_and_slide()
"""
		"character_3d":
			script += """const SPEED = 5.0
const JUMP_VELOCITY = 4.5

func _physics_process(delta: float) -> void:
	# Add gravity
	if not is_on_floor():
		velocity += get_gravity() * delta

	# Handle jump
	if Input.is_action_just_pressed("ui_accept") and is_on_floor():
		velocity.y = JUMP_VELOCITY

	# Get input direction
	var input_dir := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	var direction := (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	if direction:
		velocity.x = direction.x * SPEED
		velocity.z = direction.z * SPEED
	else:
		velocity.x = move_toward(velocity.x, 0, SPEED)
		velocity.z = move_toward(velocity.z, 0, SPEED)

	move_and_slide()
"""
		_:  # "default"
			script += """func _ready() -> void:
	pass

func _process(delta: float) -> void:
	pass
"""
	
	return script


func _serialize_node_tree(node: Node, depth: int = 0) -> Dictionary:
	var data = {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path()),
	}
	
	# Include script path if attached
	if node.get_script():
		data["script"] = node.get_script().resource_path
	
	# Include children
	var children = []
	for child in node.get_children():
		children.append(_serialize_node_tree(child, depth + 1))
	
	if children.size() > 0:
		data["children"] = children
	
	return data


func _collect_node_paths(node: Node, root: Node, paths: Array) -> void:
	var node_path = str(root.get_path_to(node))
	if node_path.is_empty() or node_path == ".":
		node_path = "."
	paths.append({"path": node_path, "type": node.get_class(), "name": node.name})
	
	for child in node.get_children():
		_collect_node_paths(child, root, paths)


func _convert_property_value(value):
	if value is Dictionary:
		if value.has("_type"):
			match value["_type"]:
				"Vector2":
					return Vector2(value.get("x", 0), value.get("y", 0))
				"Vector3":
					return Vector3(value.get("x", 0), value.get("y", 0), value.get("z", 0))
				"Color":
					return Color(value.get("r", 1), value.get("g", 1), value.get("b", 1), value.get("a", 1))
				"Rect2":
					return Rect2(value.get("x", 0), value.get("y", 0), value.get("w", 0), value.get("h", 0))
	return value


func _scan_for_files(path: String, extensions: Array, results: Array) -> void:
	var dir = DirAccess.open(path)
	if dir == null:
		return
	
	dir.list_dir_begin()
	var file_name = dir.get_next()
	
	while file_name != "":
		if file_name.begins_with("."):
			file_name = dir.get_next()
			continue
		
		var full_path = path.path_join(file_name)
		
		if dir.current_is_dir():
			if file_name != "addons":
				_scan_for_files(full_path, extensions, results)
		else:
			for ext in extensions:
				if file_name.ends_with(ext):
					results.append(full_path)
					break
		
		file_name = dir.get_next()
	
	dir.list_dir_end()


func _output_result(result: Dictionary) -> void:
	print("[GODOT_MCP_RESULT]")
	print(JSON.stringify(result))
	print("[/GODOT_MCP_RESULT]")


func _output_error(message: String) -> void:
	_output_result({"success": false, "error": message})
