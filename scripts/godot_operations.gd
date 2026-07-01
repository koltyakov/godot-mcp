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
		"read_script":
			return _read_script(params)
		"edit_script":
			return _edit_script(params)
		"attach_script":
			return _attach_script(params)
		"run_godot_script":
			return _run_godot_script(params)
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
		"classdb_info":
			return _classdb_info(params)
		"compile_script":
			return _compile_script(params)
		"get_project_settings":
			return _get_project_settings(params)
		"set_project_setting":
			return _set_project_setting(params)
		"list_autoloads":
			return _list_autoloads(params)
		"set_autoload":
			return _set_autoload(params)
		"remove_autoload":
			return _remove_autoload(params)
		"list_input_actions":
			return _list_input_actions(params)
		"set_node_group":
			return _set_node_group(params)
		"set_node_meta":
			return _set_node_meta(params)
		"remove_node_meta":
			return _remove_node_meta(params)
		"connect_signal":
			return _connect_signal(params)
		"disconnect_signal":
			return _disconnect_signal(params)
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
	var instance_scene_path = params.get("instance_scene_path", "")
	
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
	
	# Create the new node. Either instance a child scene or instantiate a class.
	var new_node: Node = null
	if not String(instance_scene_path).is_empty():
		var child_scene = load(instance_scene_path) as PackedScene
		if child_scene == null:
			scene_root.queue_free()
			return {"success": false, "error": "Failed to load child scene: " + instance_scene_path}
		new_node = child_scene.instantiate()
		if new_node == null:
			scene_root.queue_free()
			return {"success": false, "error": "Failed to instantiate child scene: " + instance_scene_path}
	else:
		new_node = _create_node_of_type(node_type)
		if new_node == null:
			scene_root.queue_free()
			return {"success": false, "error": "Unknown node type: " + node_type}
	
	new_node.name = node_name
	
	# Set properties
	for prop_name in properties:
		if not _has_property(new_node, prop_name):
			new_node.queue_free()
			scene_root.queue_free()
			return {"success": false, "error": "Property not found on new node: " + prop_name}

		new_node.set(prop_name, _convert_property_value(properties[prop_name]))
	
	# Add to parent
	parent_node.add_child(new_node)
	new_node.owner = scene_root
	
	# Save the scene
	var new_packed_scene = PackedScene.new()
	var pack_result = new_packed_scene.pack(scene_root)
	if pack_result != OK:
		scene_root.queue_free()
		return {"success": false, "error": "Failed to pack scene: " + str(pack_result)}

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
	var pack_result = new_packed_scene.pack(scene_root)
	if pack_result != OK:
		scene_root.queue_free()
		return {"success": false, "error": "Failed to pack scene: " + str(pack_result)}

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
		if not _has_property(node, prop_name):
			scene_root.queue_free()
			return {"success": false, "error": "Property not found on node: " + prop_name}

		var value = properties[prop_name]
		# Convert special types
		value = _convert_property_value(value)
		node.set(prop_name, value)
		modified_props.append(prop_name)
	
	var new_packed_scene = PackedScene.new()
	var pack_result = new_packed_scene.pack(scene_root)
	if pack_result != OK:
		scene_root.queue_free()
		return {"success": false, "error": "Failed to pack scene: " + str(pack_result)}

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


func _read_script(params: Dictionary) -> Dictionary:
	var script_path = params.get("script_path", "")
	
	if script_path.is_empty():
		return {"success": false, "error": "script_path is required"}
	
	var file = FileAccess.open(script_path, FileAccess.READ)
	if file == null:
		return {"success": false, "error": "Failed to read script: " + script_path + " (" + str(FileAccess.get_open_error()) + ")"}
	
	var content = file.get_as_text()
	file.close()
	
	return {
		"success": true,
		"script_path": script_path,
		"content": content,
		"line_count": content.split("\n").size()
	}


func _edit_script(params: Dictionary) -> Dictionary:
	var script_path = params.get("script_path", "")
	var content = params.get("content", "")
	
	if script_path.is_empty():
		return {"success": false, "error": "script_path is required"}
	
	if not (content is String):
		return {"success": false, "error": "content must be a string"}
	
	var dir_path = script_path.get_base_dir()
	if not dir_path.is_empty():
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir_path))
	
	var file = FileAccess.open(script_path, FileAccess.WRITE)
	if file == null:
		return {"success": false, "error": "Failed to write script: " + script_path + " (" + str(FileAccess.get_open_error()) + ")"}
	
	file.store_string(content)
	file.close()
	
	return {
		"success": true,
		"message": "Updated script at " + script_path,
		"script_path": script_path
	}


func _run_godot_script(params: Dictionary) -> Dictionary:
	var source = params.get("script", "")
	var method = params.get("method", "run")
	var parameters = params.get("parameters", {})
	
	if source.is_empty():
		return {"success": false, "error": "script is required"}
	
	if method.is_empty():
		return {"success": false, "error": "method is required"}
	
	if not (parameters is Dictionary):
		return {"success": false, "error": "parameters must be a Dictionary"}
	
	var script = GDScript.new()
	script.source_code = source
	var reload_result = script.reload()
	if reload_result != OK:
		return {"success": false, "error": "Failed to compile script: " + str(reload_result)}
	
	var instance = script.new()
	if instance == null:
		return {"success": false, "error": "Failed to instantiate script"}
	
	if not instance.has_method(method):
		if instance is Node:
			instance.queue_free()
		return {"success": false, "error": "Script does not define method: " + method}
	
	var value = instance.call(method, parameters)
	if instance is Node:
		instance.queue_free()
	
	return {
		"success": true,
		"method": method,
		"result": _to_json_safe(value)
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
	var pack_result = new_packed_scene.pack(scene_root)
	if pack_result != OK:
		scene_root.queue_free()
		return {"success": false, "error": "Failed to pack scene: " + str(pack_result)}

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
		anim_player.root_node = NodePath("..")
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
	
	if library.has_animation(animation_name):
		scene_root.queue_free()
		return {"success": false, "error": "Animation already exists: " + animation_name}
	
	var add_result = library.add_animation(animation_name, animation)
	if add_result != OK:
		scene_root.queue_free()
		return {"success": false, "error": "Failed to add animation: " + str(add_result)}
	
	var new_packed_scene = PackedScene.new()
	var pack_result = new_packed_scene.pack(scene_root)
	if pack_result != OK:
		scene_root.queue_free()
		return {"success": false, "error": "Failed to pack scene: " + str(pack_result)}

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
	var track_type_str = params.get("track_type", "value")
	
	if scene_path.is_empty() or animation_player_path.is_empty() or target_node_path.is_empty():
		return {"success": false, "error": "scene_path, animation_player_path, and target_node_path are required"}
	
	# "property" is required for value/bezier tracks but not for method/audio/animation tracks.
	var needs_property = track_type_str in ["value", "bezier"]
	if needs_property and property.is_empty():
		return {"success": false, "error": "property is required for value/bezier tracks"}
	
	if not (keyframes is Array) or keyframes.is_empty():
		return {"success": false, "error": "At least one keyframe is required"}
	
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
	
	var animation_root = anim_player.get_node_or_null(anim_player.root_node)
	if animation_root == null:
		animation_root = anim_player.get_parent()
	
	if animation_root == null:
		scene_root.queue_free()
		return {"success": false, "error": "AnimationPlayer has no usable root node"}
	
	var target_node = animation_root if target_node_path == "." else animation_root.get_node_or_null(target_node_path)
	if target_node == null:
		scene_root.queue_free()
		return {"success": false, "error": "Animation target node not found: " + target_node_path}
	
	if needs_property and not _has_property(target_node, property):
		scene_root.queue_free()
		return {"success": false, "error": "Property not found on animation target: " + property}
	
	# Resolve the Animation.TrackType enum.
	var track_type: int = Animation.TYPE_VALUE
	match track_type_str:
		"value":
			track_type = Animation.TYPE_VALUE
		"position_3d":
			track_type = Animation.TYPE_POSITION_3D
		"rotation_3d":
			track_type = Animation.TYPE_ROTATION_3D
		"scale_3d":
			track_type = Animation.TYPE_SCALE_3D
		"blend_shape":
			track_type = Animation.TYPE_BLEND_SHAPE
		"method":
			track_type = Animation.TYPE_METHOD
		"bezier":
			track_type = Animation.TYPE_BEZIER
		"audio":
			track_type = Animation.TYPE_AUDIO
		"animation":
			track_type = Animation.TYPE_ANIMATION
		_:
			scene_root.queue_free()
			return {"success": false, "error": "Unknown track_type: " + track_type_str}
	
	# Create the track
	var node_path = str(animation_root.get_path_to(target_node))
	if node_path.is_empty():
		node_path = "."
	var track_path_str = node_path
	if needs_property:
		track_path_str = node_path + ":" + property
	elif track_type_str == "bezier":
		# Bezier tracks address a single property too.
		track_path_str = node_path + ":" + property
	var track_idx = animation.add_track(track_type)
	animation.track_set_path(track_idx, NodePath(track_path_str))
	
	# Add keyframes. Each track type has its own keyframe shape:
	var kf_error = ""
	for kf in keyframes:
		if not (kf is Dictionary) or not kf.has("time"):
			kf_error = "Each keyframe must include time"
			break
		var time = float(kf.get("time", 0.0))
		match track_type_str:
			"value":
				if not kf.has("value"):
					kf_error = "value tracks require a 'value' per keyframe"
					break
				animation.track_insert_key(track_idx, time, _convert_property_value(kf["value"]))
			"position_3d":
				var v = _convert_property_value(kf.get("value", {}))
				if not (v is Vector3):
					kf_error = "position_3d value must be a Vector3"
					break
				animation.position_insert_key(track_idx, time, v)
			"rotation_3d":
				var q = _convert_property_value(kf.get("value", {}))
				if not (q is Quaternion):
					kf_error = "rotation_3d value must be a Quaternion"
					break
				animation.rotation_insert_key(track_idx, time, q)
			"scale_3d":
				var s = _convert_property_value(kf.get("value", {}))
				if not (s is Vector3):
					kf_error = "scale_3d value must be a Vector3"
					break
				animation.scale_insert_key(track_idx, time, s)
			"blend_shape":
				animation.blend_shape_insert_key(track_idx, time, float(kf.get("value", 0.0)))
			"bezier":
				if not kf.has("value"):
					kf_error = "bezier tracks require a numeric 'value' per keyframe"
					break
				var in_handle = kf.get("in_handle", 0.0)
				var out_handle = kf.get("out_handle", 0.0)
				animation.bezier_track_insert_key(track_idx, time, float(kf["value"]), Vector2(time, float(in_handle)), Vector2(time, float(out_handle)))
			"method":
				# Keyframe value is a Dictionary { method: StringName, args: Array }
				var m = kf.get("value", {})
				if not (m is Dictionary) or not m.has("method"):
					kf_error = "method keyframe requires {\"method\": \"name\", \"args\": [...]}"
					break
				var args = m.get("args", [])
				var call_args = []
				for a in args:
					call_args.append(_convert_property_value(a))
				var method_dict = {
					"method": StringName(m["method"]),
					"args": call_args,
				}
				animation.track_insert_key(track_idx, time, method_dict)
			"audio":
				var audio_path = kf.get("stream_path", "")
				var stream = null
				if not audio_path.is_empty():
					stream = load(audio_path)
				if stream == null and kf.has("stream"):
					stream = _convert_property_value(kf["stream"])
				var start_offset = float(kf.get("start_offset", 0.0))
				var end_offset = float(kf.get("end_offset", 0.0))
				animation.audio_track_insert_key(track_idx, time, stream, start_offset, end_offset)
			"animation":
				# Keyframe value is an Animation name (string) for nested AnimationPlayer.
				animation.track_insert_key(track_idx, time, String(kf.get("value", "")))
	
	if not kf_error.is_empty():
		scene_root.queue_free()
		return {"success": false, "error": kf_error}
	
	var new_packed_scene = PackedScene.new()
	var pack_result = new_packed_scene.pack(scene_root)
	if pack_result != OK:
		scene_root.queue_free()
		return {"success": false, "error": "Failed to pack scene: " + str(pack_result)}
	
	var result = ResourceSaver.save(new_packed_scene, scene_path)
	scene_root.queue_free()
	
	if result != OK:
		return {"success": false, "error": "Failed to save scene"}
	
	return {
		"success": true,
		"message": "Added %s animation track for %s on %s" % [track_type_str, property if needs_property else "(no property)", target_node_path]
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
		if not _has_property(resource, prop_name):
			return {"success": false, "error": "Property not found on resource: " + prop_name}

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
	
	var scenes = []
	_scan_for_files("res://", [".tscn", ".scn"], scenes)
	var scripts = []
	_scan_for_files("res://", [".gd"], scripts)
	var version_info = Engine.get_version_info()
	
	return {
		"success": true,
		"project_name": config.get_value("application", "config/name", "Unknown"),
		"main_scene": config.get_value("application", "run/main_scene", ""),
		"godot_version": version_info.get("string", str(version_info)),
		"project_path": _project_root_path(),
		"scene_count": scenes.size(),
		"script_count": scripts.size()
	}


func _list_scenes(params: Dictionary) -> Dictionary:
	var scenes = []
	_scan_for_files("res://", [".tscn", ".scn"], scenes)
	return {"success": true, "project_path": _project_root_path(), "scenes": scenes, "count": scenes.size()}


func _list_scripts(params: Dictionary) -> Dictionary:
	var scripts = []
	_scan_for_files("res://", [".gd"], scripts)
	return {"success": true, "project_path": _project_root_path(), "scripts": scripts, "count": scripts.size()}


# ============== ClassDB Discovery ==============

func _classdb_info(params: Dictionary) -> Dictionary:
	var class_name_arg = String(params.get("class", ""))
	var include = params.get("include", ["methods", "properties", "signals", "enums", "constants"])
	if not (include is Array):
		include = ["methods", "properties", "signals", "enums", "constants"]
	var inc = {}
	for item in include:
		inc[String(item)] = true

	# Without a class filter, return the list of all known classes.
	if class_name_arg.is_empty():
		var classes = ClassDB.get_class_list()
		classes.sort()
		return {"success": true, "classes": classes, "count": classes.size()}

	if not ClassDB.class_exists(class_name_arg):
		return {"success": false, "error": "Unknown class: " + class_name_arg}

	var info: Dictionary = {"name": class_name_arg}
	info["parent"] = ClassDB.get_parent_class(class_name_arg)
	info["can_instantiate"] = ClassDB.can_instantiate(class_name_arg)

	if inc.has("inheritance"):
		var parents: Array = []
		var p = ClassDB.get_parent_class(class_name_arg)
		while not p.is_empty():
			parents.append(p)
			p = ClassDB.get_parent_class(p)
		info["inheritance"] = parents

	if inc.has("methods"):
		var methods: Array = []
		for m in ClassDB.class_get_method_list(class_name_arg, true):
			if typeof(m) != TYPE_DICTIONARY:
				continue
			var entry: Dictionary = {"name": String(m.get("name", ""))}
			var args = []
			for a in m.get("args", []):
				if typeof(a) == TYPE_DICTIONARY:
					args.append({
						"name": String(a.get("name", "")),
						"type": _variant_type_name(int(a.get("type", 0))),
						"class_name": String(a.get("class_name", "")),
					})
			entry["args"] = args
			var rv = m.get("return", {})
			if typeof(rv) == TYPE_DICTIONARY and rv.get("type", TYPE_NIL) != TYPE_NIL:
				entry["returns"] = _variant_type_name(int(rv.get("type", 0)))
			methods.append(entry)
		info["methods"] = methods

	if inc.has("properties"):
		var props: Array = []
		for p in ClassDB.class_get_property_list(class_name_arg, true):
			if typeof(p) != TYPE_DICTIONARY:
				continue
			var usage: int = int(p.get("usage", 0))
			# Skip pure runtime/grouping properties that are noisy and rarely set.
			if usage == 0:
				continue
			props.append({
				"name": String(p.get("name", "")),
				"type": _variant_type_name(int(p.get("type", 0))),
				"class_name": String(p.get("class_name", "")),
				"hint": int(p.get("hint", 0)),
			})
		info["properties"] = props

	if inc.has("signals"):
		var sigs: Array = []
		for s in ClassDB.class_get_signal_list(class_name_arg, true):
			if typeof(s) != TYPE_DICTIONARY:
				continue
			var sig_args = []
			for a in s.get("args", []):
				if typeof(a) == TYPE_DICTIONARY:
					sig_args.append({"name": String(a.get("name", "")), "type": _variant_type_name(int(a.get("type", 0)))})
			sigs.append({"name": String(s.get("name", "")), "args": sig_args})
		info["signals"] = sigs

	if inc.has("enums"):
		var enums_dict: Dictionary = {}
		for e in ClassDB.class_get_enum_list(class_name_arg, true):
			var constants = ClassDB.class_get_enum_constants(class_name_arg, e, true)
			var pairs = []
			for c in constants:
				pairs.append({"name": String(c), "value": ClassDB.class_get_integer_constant(class_name_arg, c)})
			enums_dict[String(e)] = pairs
		info["enums"] = enums_dict

	if inc.has("constants"):
		var consts: Array = []
		for c in ClassDB.class_get_integer_constant_list(class_name_arg, true):
			consts.append({"name": String(c), "value": ClassDB.class_get_integer_constant(class_name_arg, c)})
		info["constants"] = consts

	if inc.has("default_values"):
		var defaults: Dictionary = {}
		for p in ClassDB.class_get_property_list(class_name_arg, true):
			if typeof(p) != TYPE_DICTIONARY:
				continue
			var pname = String(p.get("name", ""))
			var usage: int = int(p.get("usage", 0))
			# Only bother with editor-visible, settable properties.
			if pname == "" or pname in ["Node Path", "resource_local_to_scene", "resource_name", "script", "Multiplayer", "MultiplayerSync"]:
				continue
			if (usage & 2) == 0 and (usage & 8) == 0: # neither EDITOR(2) nor STORAGE(8)
				continue
			var default_val = ClassDB.class_get_property_default_value(class_name_arg, pname)
			defaults[pname] = _to_json_safe(default_val)
		info["default_property_values"] = defaults

	return {"success": true, "class": info}


const _VARIANT_TYPE_NAMES = {
	TYPE_NIL: "NIL", TYPE_BOOL: "bool", TYPE_INT: "int", TYPE_FLOAT: "float",
	TYPE_STRING: "String", TYPE_VECTOR2: "Vector2", TYPE_VECTOR2I: "Vector2i",
	TYPE_RECT2: "Rect2", TYPE_RECT2I: "Rect2i", TYPE_VECTOR3: "Vector3",
	TYPE_VECTOR3I: "Vector3i", TYPE_TRANSFORM2D: "Transform2D",
	TYPE_VECTOR4: "Vector4", TYPE_VECTOR4I: "Vector4i", TYPE_PLANE: "Plane",
	TYPE_QUATERNION: "Quaternion", TYPE_AABB: "AABB", TYPE_BASIS: "Basis",
	TYPE_TRANSFORM3D: "Transform3D", TYPE_PROJECTION: "Projection",
	TYPE_COLOR: "Color", TYPE_STRING_NAME: "StringName", TYPE_NODE_PATH: "NodePath",
	TYPE_RID: "RID", TYPE_OBJECT: "Object", TYPE_CALLABLE: "Callable",
	TYPE_SIGNAL: "Signal", TYPE_DICTIONARY: "Dictionary", TYPE_ARRAY: "Array",
	TYPE_PACKED_BYTE_ARRAY: "PackedByteArray", TYPE_PACKED_INT32_ARRAY: "PackedInt32Array",
	TYPE_PACKED_INT64_ARRAY: "PackedInt64Array", TYPE_PACKED_FLOAT32_ARRAY: "PackedFloat32Array",
	TYPE_PACKED_FLOAT64_ARRAY: "PackedFloat64Array", TYPE_PACKED_STRING_ARRAY: "PackedStringArray",
	TYPE_PACKED_VECTOR2_ARRAY: "PackedVector2Array", TYPE_PACKED_VECTOR3_ARRAY: "PackedVector3Array",
	TYPE_PACKED_COLOR_ARRAY: "PackedColorArray", TYPE_MAX: "MAX",
}

func _variant_type_name(type_int: int) -> String:
	return _VARIANT_TYPE_NAMES.get(type_int, "Variant(" + str(type_int) + ")")


# ============== Script Validation ==============

func _compile_script(params: Dictionary) -> Dictionary:
	var source = String(params.get("source", ""))
	var script_path = String(params.get("script_path", ""))
	if source.is_empty() and not script_path.is_empty():
		var f = FileAccess.open(script_path, FileAccess.READ)
		if f == null:
			return {"success": false, "error": "Failed to read script: " + script_path}
		source = f.get_as_text()
		f.close()
	if source.is_empty():
		return {"success": false, "error": "Provide 'source' or an existing 'script_path' to validate"}

	var s = GDScript.new()
	s.source_code = source
	var reload_result = s.reload()
	if reload_result != OK:
		return {
			"success": false,
			"ok": false,
			"error": "Compile failed with code " + str(reload_result) + " (script did not parse).",
		}

	# Best-effort diagnostic extraction. get_diagnostic_list is available on
	# recent Godot 4.x builds; older ones just return OK on success.
	var diagnostics: Array = []
	if s.has_method("get_diagnostic_list"):
		for d in s.get_diagnostic_list():
			if typeof(d) == TYPE_DICTIONARY:
				diagnostics.append({
					"line": int(d.get("line", -1)) + 1,
					"column": int(d.get("column", -1)) + 1,
					"severity": int(d.get("severity", 0)),
					"message": String(d.get("message", "")),
				})
	var warnings = diagnostics.filter(func(d): return int(d.severity) == 1)
	var errors = diagnostics.filter(func(d): return int(d.severity) == 0)
	return {
		"success": true,
		"ok": errors.is_empty(),
		"errors": errors,
		"warnings": warnings,
		"all_diagnostics": diagnostics,
		"line_count": source.split("\n").size(),
	}


# ============== Project Settings / Autoloads / Input Map ==============

func _get_project_settings(params: Dictionary) -> Dictionary:
	var cfg = ConfigFile.new()
	var err = cfg.load("res://project.godot")
	if err != OK:
		return {"success": false, "error": "Failed to load project.godot (" + str(err) + ")"}
	var section_filter = String(params.get("section", ""))
	var key_filter = String(params.get("key", ""))
	var result: Dictionary = {}
	var sections: Array = cfg.get_sections() if section_filter.is_empty() else [section_filter]
	for sec in sections:
		if not cfg.has_section(sec):
			continue
		var section_data: Dictionary = {}
		for k in cfg.get_section_keys(sec):
			if not key_filter.is_empty() and k != key_filter:
				continue
			section_data[k] = _to_json_safe(cfg.get_value(sec, k))
		if section_data.size() > 0:
			result[String(sec)] = section_data
	return {"success": true, "settings": result}


func _set_project_setting(params: Dictionary) -> Dictionary:
	var section = String(params.get("section", ""))
	var key = String(params.get("key", ""))
	var value = params.get("value", null)
	if section.is_empty() or key.is_empty():
		return {"success": false, "error": "section and key are required"}
	# ProjectSettings.set_setting takes "section/key" form.
	var path = section + "/" + key
	ProjectSettings.set_setting(path, _convert_property_value(value))
	var save_err = ProjectSettings.save()
	if save_err != OK:
		return {"success": false, "error": "Failed to save project.godot (" + str(save_err) + ")"}
	return {"success": true, "message": "Set " + path}


func _list_autoloads(params: Dictionary) -> Dictionary:
	var cfg = ConfigFile.new()
	var err = cfg.load("res://project.godot")
	if err != OK:
		return {"success": false, "error": "Failed to load project.godot"}
	var autoloads: Array = []
	if cfg.has_section("autoload"):
		for autoload_name in cfg.get_section_keys("autoload"):
			var raw = String(cfg.get_value("autoload", autoload_name))
			var is_singleton = raw.begins_with("*")
			autoloads.append({
				"name": autoload_name,
				"path": raw.lstrip("*"),
				"singleton": is_singleton,
			})
	return {"success": true, "autoloads": autoloads, "count": autoloads.size()}


func _set_autoload(params: Dictionary) -> Dictionary:
	var autoload_name = String(params.get("name", ""))
	var path = String(params.get("path", ""))
	var singleton = bool(params.get("singleton", true))
	if autoload_name.is_empty() or path.is_empty():
		return {"success": false, "error": "name and path are required"}
	var cfg = ConfigFile.new()
	var err = cfg.load("res://project.godot")
	if err != OK:
		return {"success": false, "error": "Failed to load project.godot"}
	var val = ("*" if singleton else "") + path
	cfg.set_value("autoload", autoload_name, val)
	err = cfg.save("res://project.godot")
	if err != OK:
		return {"success": false, "error": "Failed to save project.godot"}
	return {"success": true, "message": "Set autoload " + autoload_name + " -> " + path, "singleton": singleton}


func _remove_autoload(params: Dictionary) -> Dictionary:
	var autoload_name = String(params.get("name", ""))
	if autoload_name.is_empty():
		return {"success": false, "error": "name is required"}
	var cfg = ConfigFile.new()
	var err = cfg.load("res://project.godot")
	if err != OK:
		return {"success": false, "error": "Failed to load project.godot"}
	if not cfg.has_section_key("autoload", autoload_name):
		return {"success": false, "error": "No such autoload: " + autoload_name}
	cfg.erase_section_key("autoload", autoload_name)
	err = cfg.save("res://project.godot")
	if err != OK:
		return {"success": false, "error": "Failed to save project.godot"}
	return {"success": true, "message": "Removed autoload " + autoload_name}


func _list_input_actions(params: Dictionary) -> Dictionary:
	var actions: Array = []
	for action in InputMap.get_actions():
		# Skip the built-in editor/ui actions when no filter is provided, but
		# include them when requested explicitly.
		var built_in = String(action).begins_with("ui_") or String(action).begins_with("spatial_editor/")
		var include = bool(params.get("include_builtin", false))
		if built_in and not include:
			continue
		var events: Array = []
		for e in InputMap.action_get_events(action):
			events.append(_serialize_input_event(e))
		actions.append({
			"name": String(action),
			"deadzone": InputMap.action_get_deadzone(action),
			"events": events,
			"builtin": built_in,
		})
	return {"success": true, "actions": actions, "count": actions.size()}


func _serialize_input_event(e: InputEvent) -> Dictionary:
	var d: Dictionary = {"type": e.get_class()}
	match e.get_class():
		"InputEventKey":
			d["keycode"] = e.keycode
			d["physical_keycode"] = e.physical_keycode
			d["unicode"] = e.unicode
			d["shift"] = e.shift_pressed
			d["ctrl"] = e.ctrl_pressed
			d["alt"] = e.alt_pressed
			d["meta"] = e.meta_pressed
		"InputEventMouseButton":
			d["button_index"] = e.button_index
			d["shift"] = e.shift_pressed
			d["ctrl"] = e.ctrl_pressed
			d["alt"] = e.alt_pressed
		"InputEventJoypadMotion":
			d["axis"] = e.axis
			d["axis_value"] = e.axis_value
		"InputEventJoypadButton":
			d["button_index"] = e.button_index
		_:
			d["repr"] = str(e)
	return d


# ============== Node Groups / Meta / Signals ==============

func _set_node_group(params: Dictionary) -> Dictionary:
	var scene_path = String(params.get("scene_path", ""))
	var node_path = String(params.get("node_path", ""))
	var group = String(params.get("group", ""))
	var add = bool(params.get("add", true))
	if scene_path.is_empty() or node_path.is_empty() or group.is_empty():
		return {"success": false, "error": "scene_path, node_path, and group are required"}
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	var scene_root = packed_scene.instantiate()
	var node = scene_root if node_path == "." else scene_root.get_node_or_null(node_path)
	if node == null:
		scene_root.queue_free()
		return {"success": false, "error": "Node not found: " + node_path}
	if add:
		node.add_to_group(group, true) # persistent
	else:
		node.remove_from_group(group)
	var new_packed_scene = PackedScene.new()
	var pack_result = new_packed_scene.pack(scene_root)
	scene_root.queue_free()
	if pack_result != OK:
		return {"success": false, "error": "Failed to pack scene"}
	var save_err = ResourceSaver.save(new_packed_scene, scene_path)
	if save_err != OK:
		return {"success": false, "error": "Failed to save scene"}
	return {"success": true, "message": ("Added " if add else "Removed ") + "group '" + group + "' on " + node_path}


func _set_node_meta(params: Dictionary) -> Dictionary:
	var scene_path = String(params.get("scene_path", ""))
	var node_path = String(params.get("node_path", ""))
	var key = String(params.get("key", ""))
	var value = params.get("value", null)
	if scene_path.is_empty() or node_path.is_empty() or key.is_empty():
		return {"success": false, "error": "scene_path, node_path, and key are required"}
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	var scene_root = packed_scene.instantiate()
	var node = scene_root if node_path == "." else scene_root.get_node_or_null(node_path)
	if node == null:
		scene_root.queue_free()
		return {"success": false, "error": "Node not found: " + node_path}
	node.set_meta(key, _convert_property_value(value))
	var new_packed_scene = PackedScene.new()
	var pack_result = new_packed_scene.pack(scene_root)
	scene_root.queue_free()
	if pack_result != OK:
		return {"success": false, "error": "Failed to pack scene"}
	var save_err = ResourceSaver.save(new_packed_scene, scene_path)
	if save_err != OK:
		return {"success": false, "error": "Failed to save scene"}
	return {"success": true, "message": "Set meta '" + key + "' on " + node_path}


func _remove_node_meta(params: Dictionary) -> Dictionary:
	var scene_path = String(params.get("scene_path", ""))
	var node_path = String(params.get("node_path", ""))
	var key = String(params.get("key", ""))
	if scene_path.is_empty() or node_path.is_empty() or key.is_empty():
		return {"success": false, "error": "scene_path, node_path, and key are required"}
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	var scene_root = packed_scene.instantiate()
	var node = scene_root if node_path == "." else scene_root.get_node_or_null(node_path)
	if node == null:
		scene_root.queue_free()
		return {"success": false, "error": "Node not found: " + node_path}
	if not node.has_meta(key):
		scene_root.queue_free()
		return {"success": false, "error": "No such meta: " + key}
	node.remove_meta(key)
	var new_packed_scene = PackedScene.new()
	var pack_result = new_packed_scene.pack(scene_root)
	scene_root.queue_free()
	if pack_result != OK:
		return {"success": false, "error": "Failed to pack scene"}
	var save_err = ResourceSaver.save(new_packed_scene, scene_path)
	if save_err != OK:
		return {"success": false, "error": "Failed to save scene"}
	return {"success": true, "message": "Removed meta '" + key + "' on " + node_path}


func _connect_signal(params: Dictionary) -> Dictionary:
	var scene_path = String(params.get("scene_path", ""))
	var source_path = String(params.get("source_node_path", ""))
	var signal_name = String(params.get("signal", ""))
	var target_path = String(params.get("target_node_path", ""))
	var method = String(params.get("method", ""))
	var flags = int(params.get("flags", Node.CONNECT_PERSIST))
	if scene_path.is_empty() or source_path.is_empty() or signal_name.is_empty() or target_path.is_empty() or method.is_empty():
		return {"success": false, "error": "scene_path, source_node_path, signal, target_node_path, and method are required"}
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	var scene_root = packed_scene.instantiate()
	var source = scene_root if source_path == "." else scene_root.get_node_or_null(source_path)
	var target = scene_root if target_path == "." else scene_root.get_node_or_null(target_path)
	if source == null:
		scene_root.queue_free()
		return {"success": false, "error": "Source node not found: " + source_path}
	if target == null:
		scene_root.queue_free()
		return {"success": false, "error": "Target node not found: " + target_path}
	var err = source.connect(signal_name, Callable(target, method), flags)
	if err != OK:
		scene_root.queue_free()
		return {"success": false, "error": "connect() failed: " + str(err)}
	var new_packed_scene = PackedScene.new()
	var pack_result = new_packed_scene.pack(scene_root)
	scene_root.queue_free()
	if pack_result != OK:
		return {"success": false, "error": "Failed to pack scene"}
	var save_err = ResourceSaver.save(new_packed_scene, scene_path)
	if save_err != OK:
		return {"success": false, "error": "Failed to save scene"}
	return {"success": true, "message": "Connected " + source_path + "." + signal_name + " -> " + target_path + "." + method}


func _disconnect_signal(params: Dictionary) -> Dictionary:
	var scene_path = String(params.get("scene_path", ""))
	var source_path = String(params.get("source_node_path", ""))
	var signal_name = String(params.get("signal", ""))
	var target_path = String(params.get("target_node_path", ""))
	var method = String(params.get("method", ""))
	if scene_path.is_empty() or source_path.is_empty() or signal_name.is_empty() or target_path.is_empty() or method.is_empty():
		return {"success": false, "error": "scene_path, source_node_path, signal, target_node_path, and method are required"}
	var packed_scene = load(scene_path) as PackedScene
	if packed_scene == null:
		return {"success": false, "error": "Failed to load scene: " + scene_path}
	var scene_root = packed_scene.instantiate()
	var source = scene_root if source_path == "." else scene_root.get_node_or_null(source_path)
	var target = scene_root if target_path == "." else scene_root.get_node_or_null(target_path)
	if source == null or target == null:
		scene_root.queue_free()
		return {"success": false, "error": "Source or target node not found"}
	source.disconnect(signal_name, Callable(target, method))
	var new_packed_scene = PackedScene.new()
	var pack_result = new_packed_scene.pack(scene_root)
	scene_root.queue_free()
	if pack_result != OK:
		return {"success": false, "error": "Failed to pack scene"}
	var save_err = ResourceSaver.save(new_packed_scene, scene_path)
	if save_err != OK:
		return {"success": false, "error": "Failed to save scene"}
	return {"success": true, "message": "Disconnected " + signal_name}


# ============== Helper Functions ==============

func _project_root_path() -> String:
	var project_path = ProjectSettings.globalize_path("res://")
	while project_path.ends_with("/") or project_path.ends_with("\\"):
		project_path = project_path.substr(0, project_path.length() - 1)
	return project_path


func _to_json_safe(value, depth: int = 0):
	if depth > 8:
		return str(value)
	
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_VECTOR2:
			return {"_type": "Vector2", "x": value.x, "y": value.y}
		TYPE_VECTOR2I:
			return {"_type": "Vector2i", "x": value.x, "y": value.y}
		TYPE_VECTOR3:
			return {"_type": "Vector3", "x": value.x, "y": value.y, "z": value.z}
		TYPE_VECTOR3I:
			return {"_type": "Vector3i", "x": value.x, "y": value.y, "z": value.z}
		TYPE_VECTOR4:
			return {"_type": "Vector4", "x": value.x, "y": value.y, "z": value.z, "w": value.w}
		TYPE_VECTOR4I:
			return {"_type": "Vector4i", "x": value.x, "y": value.y, "z": value.z, "w": value.w}
		TYPE_COLOR:
			return {"_type": "Color", "r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_RECT2:
			return {"_type": "Rect2", "x": value.position.x, "y": value.position.y, "w": value.size.x, "h": value.size.y}
		TYPE_RECT2I:
			return {"_type": "Rect2i", "x": value.position.x, "y": value.position.y, "w": value.size.x, "h": value.size.y}
		TYPE_TRANSFORM2D:
			return {"_type": "Transform2D", "origin": _to_json_safe(value.origin, depth + 1), "rotation": value.get_rotation()}
		TYPE_PLANE:
			return {"_type": "Plane", "x": value.x, "y": value.y, "z": value.z, "d": value.d}
		TYPE_QUATERNION:
			return {"_type": "Quaternion", "x": value.x, "y": value.y, "z": value.z, "w": value.w}
		TYPE_AABB:
			return {"_type": "AABB", "position": _to_json_safe(value.position, depth + 1), "size": _to_json_safe(value.size, depth + 1)}
		TYPE_BASIS:
			return {"_type": "Basis", "x": _to_json_safe(value.x, depth + 1), "y": _to_json_safe(value.y, depth + 1), "z": _to_json_safe(value.z, depth + 1)}
		TYPE_TRANSFORM3D:
			return {"_type": "Transform3D", "origin": _to_json_safe(value.origin, depth + 1), "basis": _to_json_safe(value.basis, depth + 1)}
		TYPE_NODE_PATH:
			return {"_type": "NodePath", "path": str(value)}
		TYPE_STRING_NAME:
			return {"_type": "StringName", "value": String(value)}
		TYPE_CALLABLE:
			return str(value)
		TYPE_SIGNAL:
			return str(value)
		TYPE_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_FLOAT64_ARRAY:
			var array_result = []
			for item in value:
				array_result.append(_to_json_safe(item, depth + 1))
			return array_result
		TYPE_PACKED_BYTE_ARRAY:
			# Bytes do not round-trip cleanly through JSON; surface length + hex preview.
			return {"_type": "PackedByteArray", "size": value.size()}
		TYPE_PACKED_STRING_ARRAY:
			return value.duplicate()
		TYPE_PACKED_VECTOR2_ARRAY:
			var v2_result = []
			for item in value:
				v2_result.append(_to_json_safe(item, depth + 1))
			return v2_result
		TYPE_PACKED_VECTOR3_ARRAY:
			var v3_result = []
			for item in value:
				v3_result.append(_to_json_safe(item, depth + 1))
			return v3_result
		TYPE_PACKED_COLOR_ARRAY:
			var col_result = []
			for item in value:
				col_result.append(_to_json_safe(item, depth + 1))
			return col_result
		TYPE_DICTIONARY:
			var dictionary_result = {}
			for key in value:
				dictionary_result[str(key)] = _to_json_safe(value[key], depth + 1)
			return dictionary_result
		TYPE_OBJECT:
			if value == null:
				return null
			if value is Node:
				return {"_type": value.get_class(), "name": value.name, "path": str(value.get_path())}
			if value is Resource:
				return {"_type": value.get_class(), "resource_path": value.resource_path}
			return str(value)
		_:
			return str(value)

func _create_node_of_type(type_name: String) -> Node:
	# Historically this function had a hardcoded match table for ~45 node types.
	# ClassDB.instantiate covers all of them (and any future/exotic node types)
	# and the caller already rejects null results, so we let the engine do it.
	if ClassDB.class_exists(type_name):
		var instance = ClassDB.instantiate(type_name)
		if instance is Node:
			return instance
	return null


func _create_resource_of_type(type_name: String) -> Resource:
	# Same reasoning as _create_node_of_type: ClassDB covers every built-in
	# Resource subclass without maintaining a hardcoded list.
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


func _serialize_node_tree(node: Node, root: Node = null, depth: int = 0) -> Dictionary:
	if root == null:
		root = node

	var node_path = "." if node == root else str(root.get_path_to(node))
	var data = {
		"name": node.name,
		"type": node.get_class(),
		"path": node_path,
	}

	# Instance-relative scene path for instanced sub-scenes (non-empty when the
	# node came from a different .tscn file). Useful for the agent to know what
	# is owned by this scene vs inherited/instanced.
	var instance_path = node.get_scene_file_path()
	if not instance_path.is_empty() and str(instance_path) != "":
		data["instance"] = str(instance_path)

	# Include script path if attached
	if node.get_script():
		var script_res = node.get_script()
		data["script"] = script_res.resource_path

	# Groups the node belongs to.
	var groups = node.get_groups()
	if groups.size() > 0:
		data["groups"] = []
		for g in groups:
			data["groups"].append(String(g))

	# User metadata set via set_meta.
	var meta_list = node.get_meta_list()
	if meta_list.size() > 0:
		var meta = {}
		for key in meta_list:
			meta[String(key)] = _to_json_safe(node.get_meta(key))
		data["meta"] = meta

	# Stored properties (the same set PackedScene persists). Filter out a few
	# noisy/uninteresting defaults to keep payloads manageable.
	var props = _serialize_node_properties(node)
	if props.size() > 0:
		data["properties"] = props

	# Signal connections whose target is this node (gives the agent half of the
	# wiring picture; pair with the source-side scan in `_collect_outgoing_signals`).
	var incoming = _serialize_incoming_connections(node, root)
	if incoming.size() > 0:
		data["incoming_connections"] = incoming

	# Include children
	var children = []
	for child in node.get_children():
		children.append(_serialize_node_tree(child, root, depth + 1))

	if children.size() > 0:
		data["children"] = children

	return data


# Return the set of properties PackedScene would store, filtered to those that
# differ from the class default (so we don't dump unchanged defaults).
func _serialize_node_properties(node: Node) -> Dictionary:
	const STORAGE_FLAG = 8 # PROPERTY_USAGE_STORAGE
	var result = {}
	var cls = node.get_class()
	for prop_info in node.get_property_list():
		if typeof(prop_info) != TYPE_DICTIONARY:
			continue
		var pname = prop_info.get("name", "")
		if pname == "" or pname in [
			"script", # already surfaced separately
			"process_mode", "process_physics_mode", "process_priority",
			"editor_description", "multiplayer", "multiplayer_sync",
			"unique_name_in_owner",
		]:
			continue
		var usage: int = prop_info.get("usage", 0)
		if (usage & STORAGE_FLAG) == 0:
			continue
		var current = node.get(pname)
		var default = ClassDB.class_get_property_default_value(cls, pname)
		# Skip values identical to the class default.
		if _values_equal(current, default):
			continue
		# unique_name_in_owner is stored as a node flag, surface it explicitly.
		result[pname] = _to_json_safe(current)
	if node.is_unique_name_in_owner():
		result["unique_name_in_owner"] = true
	return result


func _values_equal(a, b) -> bool:
	# Compare primitives and math types; deep-compare Dictionary/Array.
	if typeof(a) != typeof(b):
		# int/float comparison should still work for numeric equality.
		if a is float and b is int:
			return a == float(b)
		if a is int and b is float:
			return float(a) == b
		return false
	if typeof(a) == TYPE_DICTIONARY or typeof(a) == TYPE_ARRAY:
		return a == b
	# Resource/Node identity compare
	if typeof(a) == TYPE_OBJECT:
		return a == b
	return a == b


func _serialize_incoming_connections(node: Node, root: Node) -> Array:
	var result = []
	for conn in node.get_incoming_connections():
		var entry = {}
		if typeof(conn) == TYPE_DICTIONARY:
			entry["signal"] = String(conn.get("signal", ""))
			var callable: Callable = conn.get("callable", Callable())
			if callable.is_valid():
				var target = callable.get_object()
				if target is Node:
					entry["from"] = str(root.get_path_to(target))
				entry["method"] = String(callable.get_method())
			entry["flags"] = int(conn.get("flags", 0))
		if entry.size() > 0:
			result.append(entry)
	return result


func _has_property(object: Object, property_name: String) -> bool:
	for property_info in object.get_property_list():
		if property_info.name == property_name:
			return true
	return false


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
				"Vector2i":
					return Vector2i(value.get("x", 0), value.get("y", 0))
				"Vector3":
					return Vector3(value.get("x", 0), value.get("y", 0), value.get("z", 0))
				"Vector3i":
					return Vector3i(value.get("x", 0), value.get("y", 0), value.get("z", 0))
				"Vector4":
					return Vector4(value.get("x", 0), value.get("y", 0), value.get("z", 0), value.get("w", 0))
				"Vector4i":
					return Vector4i(value.get("x", 0), value.get("y", 0), value.get("z", 0), value.get("w", 0))
				"Color":
					return Color(value.get("r", 1), value.get("g", 1), value.get("b", 1), value.get("a", 1))
				"Rect2":
					return Rect2(value.get("x", 0), value.get("y", 0), value.get("w", 0), value.get("h", 0))
				"Rect2i":
					return Rect2i(value.get("x", 0), value.get("y", 0), value.get("w", 0), value.get("h", 0))
				"Transform2D":
					var t2 = Transform2D()
					if value.has("rotation"):
						t2 = t2.rotated(value["rotation"])
					if value.has("origin"):
						t2.origin = _convert_property_value(value["origin"])
					return t2
				"Plane":
					return Plane(value.get("x", 0), value.get("y", 0), value.get("z", 0), value.get("d", 0))
				"Quaternion":
					return Quaternion(value.get("x", 0), value.get("y", 0), value.get("z", 0), value.get("w", 1))
				"AABB":
					return AABB(_convert_property_value(value.get("position", {})), _convert_property_value(value.get("size", {})))
				"Basis":
					return Basis(_convert_property_value(value.get("x", {})), _convert_property_value(value.get("y", {})), _convert_property_value(value.get("z", {})))
				"Transform3D":
					var t3 = Transform3D()
					if value.has("basis"):
						t3.basis = _convert_property_value(value["basis"])
					if value.has("origin"):
						t3.origin = _convert_property_value(value["origin"])
					return t3
				"NodePath":
					return NodePath(value.get("path", ""))
				"StringName":
					return StringName(value.get("value", ""))
				"Resource":
					var r = load(value.get("path", ""))
					if r == null:
						push_error("Failed to load resource for property: " + str(value.get("path", "")))
					return r
				"PackedVector2Array":
					var arr2 = PackedVector2Array()
					for item in value.get("items", []):
						arr2.append(_convert_property_value(item))
					return arr2
				"PackedVector3Array":
					var arr3 = PackedVector3Array()
					for item in value.get("items", []):
						arr3.append(_convert_property_value(item))
					return arr3
				"PackedStringArray":
					var arrs = PackedStringArray()
					for item in value.get("items", []):
						arrs.append(item)
					return arrs
				"PackedColorArray":
					var arrc = PackedColorArray()
					for item in value.get("items", []):
						arrc.append(_convert_property_value(item))
					return arrc
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
