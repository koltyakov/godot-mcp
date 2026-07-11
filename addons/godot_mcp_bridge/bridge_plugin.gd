@tool
extends EditorPlugin

const PROTOCOL := 1
const MAX_REQUEST_BYTES := 65536
const MAX_CLIENTS := 4

var _server := TCPServer.new()
var _clients: Array[StreamPeerTCP] = []
var _buffers: Dictionary = {}
var _authenticated: Dictionary = {}
var _connected_at: Dictionary = {}
var _instance_id := ""
var _token := ""
var _descriptor_path := ""
var _heartbeat_elapsed := 0.0
var _observed_versions: Dictionary = {}
var _saved_versions: Dictionary = {}
var _scene_history_ids: Dictionary = {}
var _scene_disk_hashes: Dictionary = {}


func _enter_tree() -> void:
	_instance_id = (Crypto.new().generate_random_bytes(16) as PackedByteArray).hex_encode()
	_token = (Crypto.new().generate_random_bytes(32) as PackedByteArray).hex_encode()
	var error := _server.listen(0, "127.0.0.1")
	if error != OK:
		push_error("Godot MCP bridge failed to listen on loopback: " + str(error))
		return
	var descriptor_dir := "res://.godot/godot_mcp_bridge/instances"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(descriptor_dir))
	_descriptor_path = descriptor_dir.path_join(_instance_id + ".json")
	scene_changed.connect(_on_scene_changed)
	scene_saved.connect(_on_scene_saved)
	scene_closed.connect(_on_scene_closed)
	_write_descriptor()
	set_process(true)
	call_deferred("_observe_active_scene")


func _exit_tree() -> void:
	set_process(false)
	for peer in _clients:
		peer.disconnect_from_host()
	_clients.clear()
	_server.stop()
	if not _descriptor_path.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(_descriptor_path))


func _process(delta: float) -> void:
	while _server.is_connection_available() and _clients.size() < MAX_CLIENTS:
		var peer := _server.take_connection()
		_clients.append(peer)
		_buffers[peer] = ""
		_authenticated[peer] = false
		_connected_at[peer] = Time.get_ticks_msec()

	for peer in _clients.duplicate():
		peer.poll()
		if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			_remove_client(peer)
			continue
		if not bool(_authenticated.get(peer, false)) and Time.get_ticks_msec() - int(_connected_at.get(peer, 0)) > 2000:
			_remove_client(peer)
			continue
		var available: int = peer.get_available_bytes()
		if available > 0:
			_buffers[peer] = String(_buffers.get(peer, "")) + peer.get_utf8_string(available)
			if String(_buffers[peer]).length() > MAX_REQUEST_BYTES:
				_remove_client(peer)
				continue
			_process_lines(peer)

	_heartbeat_elapsed += delta
	if _heartbeat_elapsed >= 2.0:
		_heartbeat_elapsed = 0.0
		_write_descriptor()


func _process_lines(peer: StreamPeerTCP) -> void:
	var buffer := String(_buffers.get(peer, ""))
	var newline := buffer.find("\n")
	while newline >= 0:
		var line := buffer.substr(0, newline)
		buffer = buffer.substr(newline + 1)
		_handle_request(peer, line)
		newline = buffer.find("\n")
	_buffers[peer] = buffer


func _handle_request(peer: StreamPeerTCP, line: String) -> void:
	var parsed = JSON.parse_string(line)
	if typeof(parsed) != TYPE_DICTIONARY:
		_send_error(peer, null, -32700, "Parse error")
		return
	var request: Dictionary = parsed
	var request_id = request.get("id")
	var method := String(request.get("method", ""))
	var params = request.get("params", {})
	if typeof(params) != TYPE_DICTIONARY:
		_send_error(peer, request_id, -32602, "Invalid parameters")
		return

	if not bool(_authenticated.get(peer, false)):
		if method != "bridge.hello" or int(params.get("protocol", 0)) != PROTOCOL or String(params.get("token", "")) != _token:
			_send_error(peer, request_id, -32001, "Unauthenticated")
			_remove_client(peer)
			return
		_authenticated[peer] = true
		_send_result(peer, request_id, {
			"protocol": PROTOCOL,
			"instance_id": _instance_id,
			"project_path": _project_path(),
			"godot_version": String(Engine.get_version_info().get("string", "unknown")),
			"capabilities": ["editor.state", "editor.scene.read", "editor.play.control", "editor.performance"],
		})
		return

	match method:
		"bridge.ping":
			_send_result(peer, request_id, {"instance_id": _instance_id, "timestamp_ms": _now_ms()})
		"editor.get_state":
			_send_result(peer, request_id, _editor_state())
		"editor.read_scene":
			var scene_root := EditorInterface.get_edited_scene_root()
			if scene_root == null:
				_send_error(peer, request_id, -32004, "No active edited scene")
				return
			var requested_path := String(params.get("scene_path", ""))
			if not requested_path.is_empty() and requested_path != scene_root.scene_file_path:
				_send_error(peer, request_id, -32004, "Requested scene is not the active edited scene")
				return
			var dirty_state := _scene_dirty_state(scene_root)
			_send_result(peer, request_id, {
				"scene_path": scene_root.scene_file_path if not scene_root.scene_file_path.is_empty() else null,
				"dirty": dirty_state["dirty"],
				"dirty_confidence": dirty_state["dirty_confidence"],
				"change_version": dirty_state["change_version"],
				"saved_change_version": dirty_state["saved_change_version"],
				"unsaved_changes_included": true,
				"tree": _serialize_node(scene_root, scene_root, 0),
			})
		"editor.play":
			var mode := String(params.get("mode", "main"))
			if EditorInterface.is_playing_scene():
				_send_error(peer, request_id, -32005, "A scene is already playing")
			elif mode == "current" and EditorInterface.get_edited_scene_root() == null:
				_send_error(peer, request_id, -32004, "No current scene is available to play")
			elif mode == "main" and String(ProjectSettings.get_setting("application/run/main_scene", "")).is_empty():
				_send_error(peer, request_id, -32004, "No main scene is configured")
			elif mode == "main":
				EditorInterface.play_main_scene()
				if EditorInterface.is_playing_scene():
					_send_result(peer, request_id, {"playing": true, "mode": mode})
				else:
					_send_error(peer, request_id, -32004, "Godot did not start the main scene")
			elif mode == "current":
				EditorInterface.play_current_scene()
				if EditorInterface.is_playing_scene():
					_send_result(peer, request_id, {"playing": true, "mode": mode})
				else:
					_send_error(peer, request_id, -32004, "Godot did not start the current scene")
			else:
				_send_error(peer, request_id, -32602, "mode must be main or current")
		"editor.stop":
			if EditorInterface.is_playing_scene():
				EditorInterface.stop_playing_scene()
			_send_result(peer, request_id, {"playing": false})
		"editor.get_performance":
			_send_result(peer, request_id, _performance_state())
		_:
			_send_error(peer, request_id, -32601, "Method not found")


func _editor_state() -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	var dirty_state := {} if root == null else _scene_dirty_state(root)
	var selected := []
	var open_scenes := []
	for scene_path in EditorInterface.get_open_scenes():
		if not String(scene_path).is_empty():
			open_scenes.append(scene_path)
	if root != null:
		for node in EditorInterface.get_selection().get_selected_nodes():
			if node is Node and (node == root or root.is_ancestor_of(node)):
				selected.append({
					"path": "." if node == root else String(root.get_path_to(node)),
					"name": node.name,
					"type": node.get_class(),
				})
	var playing := EditorInterface.is_playing_scene()
	var playing_scene := EditorInterface.get_playing_scene() if playing else ""
	return {
		"project": {"path": _project_path(), "name": ProjectSettings.get_setting("application/config/name", "Unknown")},
		"scene": null if root == null else {
			"path": root.scene_file_path if not root.scene_file_path.is_empty() else null,
			"name": root.name,
			"type": root.get_class(),
			"dirty": dirty_state["dirty"],
			"dirty_confidence": dirty_state["dirty_confidence"],
			"change_version": dirty_state["change_version"],
			"saved_change_version": dirty_state["saved_change_version"],
		},
		"open_scenes": open_scenes,
		"selection": {"nodes": selected},
		"play": {"playing": playing, "scene_path": playing_scene if not playing_scene.is_empty() else null},
	}


func _observe_active_scene() -> void:
	var root := EditorInterface.get_edited_scene_root()
	if root != null:
		_observe_scene_history(root)


func _on_scene_changed(scene_root: Node) -> void:
	if scene_root != null:
		_observe_scene_history(scene_root)


func _on_scene_saved(filepath: String) -> void:
	var previous_sha256 := String(_scene_disk_hashes.get(filepath, ""))
	call_deferred("_confirm_scene_saved", filepath, previous_sha256)


func _confirm_scene_saved(filepath: String, previous_sha256: String) -> void:
	var root := EditorInterface.get_edited_scene_root()
	if root != null and root.scene_file_path == filepath:
		_observe_scene_history(root)
	var history_id = _scene_history_ids.get(filepath)
	if history_id == null:
		return
	var save_confirmed := false
	if EditorInterface.has_method("get_unsaved_scenes"):
		var unsaved_scenes = EditorInterface.call("get_unsaved_scenes")
		if typeof(unsaved_scenes) == TYPE_ARRAY or typeof(unsaved_scenes) == TYPE_PACKED_STRING_ARRAY:
			save_confirmed = not unsaved_scenes.has(filepath)
	elif FileAccess.file_exists(filepath):
		var current_sha256 := FileAccess.get_sha256(filepath)
		save_confirmed = not current_sha256.is_empty() and current_sha256 != previous_sha256
	if not save_confirmed:
		var unconfirmed_history = get_undo_redo().get_history_undo_redo(int(history_id))
		if unconfirmed_history != null:
			_observed_versions[int(history_id)] = unconfirmed_history.get_version()
		_saved_versions.erase(int(history_id))
		return
	_scene_disk_hashes[filepath] = FileAccess.get_sha256(filepath)
	var history = get_undo_redo().get_history_undo_redo(int(history_id))
	if history != null:
		_saved_versions[int(history_id)] = history.get_version()


func _on_scene_closed(filepath: String) -> void:
	var history_id = _scene_history_ids.get(filepath)
	_scene_history_ids.erase(filepath)
	_scene_disk_hashes.erase(filepath)
	if history_id != null:
		_observed_versions.erase(int(history_id))
		_saved_versions.erase(int(history_id))


func _observe_scene_history(root: Node) -> Dictionary:
	var history_id := int(get_undo_redo().get_object_history_id(root))
	var history = get_undo_redo().get_history_undo_redo(history_id)
	if history == null:
		return {"history_id": history_id, "change_version": null}
	var version := int(history.get_version())
	if not _observed_versions.has(history_id):
		_observed_versions[history_id] = version
	if not root.scene_file_path.is_empty():
		_scene_history_ids[root.scene_file_path] = history_id
		if not _scene_disk_hashes.has(root.scene_file_path):
			_scene_disk_hashes[root.scene_file_path] = FileAccess.get_sha256(root.scene_file_path) if FileAccess.file_exists(root.scene_file_path) else ""
	return {"history_id": history_id, "change_version": version}


func _scene_dirty_state(root: Node) -> Dictionary:
	var history_state := _observe_scene_history(root)
	var history_id := int(history_state.get("history_id", -1))
	var version = history_state.get("change_version")
	var saved_version = _saved_versions.get(history_id)
	if root.scene_file_path.is_empty():
		return {
			"dirty": true,
			"dirty_confidence": "exact_untitled",
			"change_version": version,
			"saved_change_version": saved_version,
		}
	if EditorInterface.has_method("get_unsaved_scenes"):
		var unsaved_scenes = EditorInterface.call("get_unsaved_scenes")
		if typeof(unsaved_scenes) == TYPE_ARRAY or typeof(unsaved_scenes) == TYPE_PACKED_STRING_ARRAY:
			return {
				"dirty": unsaved_scenes.has(root.scene_file_path),
				"dirty_confidence": "editor_api",
				"change_version": version,
				"saved_change_version": saved_version,
			}
	if saved_version != null and version != null:
		if version != saved_version:
			return {
				"dirty": true,
				"dirty_confidence": "undo_redo_tracked",
				"change_version": version,
				"saved_change_version": saved_version,
			}
		return {
			"dirty": null,
			"dirty_confidence": "unknown",
			"change_version": version,
			"saved_change_version": saved_version,
		}
	if version != null and version != _observed_versions.get(history_id):
		return {
			"dirty": true,
			"dirty_confidence": "undo_redo_tracked",
			"change_version": version,
			"saved_change_version": null,
		}
	return {
		"dirty": null,
		"dirty_confidence": "unknown",
		"change_version": version,
		"saved_change_version": null,
	}


func _performance_state() -> Dictionary:
	return {
		"fps": Performance.get_monitor(Performance.TIME_FPS),
		"process_ms": Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
		"physics_process_ms": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
		"static_memory_bytes": Performance.get_monitor(Performance.MEMORY_STATIC),
		"object_count": Performance.get_monitor(Performance.OBJECT_COUNT),
		"resource_count": Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT),
		"node_count": Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
		"orphan_node_count": Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT),
		"draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"primitives": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
		"video_memory_bytes": Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED),
	}


func _serialize_node(node: Node, root: Node, depth: int) -> Dictionary:
	var result := {
		"name": node.name,
		"type": node.get_class(),
		"path": "." if node == root else String(root.get_path_to(node)),
		"children": [],
		"groups": [],
		"metadata": {},
		"properties": {},
		"owner_path": null,
	}
	if node.owner is Node and (node.owner == root or root.is_ancestor_of(node.owner)):
		result["owner_path"] = "." if node.owner == root else String(root.get_path_to(node.owner))
	var instance_path := node.get_scene_file_path()
	if node != root and not instance_path.is_empty():
		result["instance"] = instance_path
		result["editable_instance"] = root.is_editable_instance(node)
	for group in node.get_groups():
		result["groups"].append(String(group))
	for key in node.get_meta_list():
		result["metadata"][String(key)] = _bridge_json_safe(node.get_meta(key))
	for property_info in node.get_property_list():
		if typeof(property_info) != TYPE_DICTIONARY:
			continue
		var property_name := String(property_info.get("name", ""))
		if property_name.is_empty() or property_name == "script" or (int(property_info.get("usage", 0)) & PROPERTY_USAGE_STORAGE) == 0:
			continue
		result["properties"][property_name] = _bridge_json_safe(node.get(property_name))
	if node.is_unique_name_in_owner():
		result["properties"]["unique_name_in_owner"] = true
	if node.get_script() is Script:
		result["script"] = (node.get_script() as Script).resource_path
	var incoming_connections := _serialize_incoming_connections(node, root)
	if not incoming_connections.is_empty():
		result["incoming_connections"] = incoming_connections
	if depth >= 64:
		result["truncated"] = true
		return result
	for child in node.get_children():
		if child is Node:
			result["children"].append(_serialize_node(child, root, depth + 1))
	return result


func _serialize_incoming_connections(node: Node, root: Node) -> Array:
	var result := []
	for connection in node.get_incoming_connections():
		if typeof(connection) != TYPE_DICTIONARY:
			continue
		var flags := int(connection.get("flags", 0))
		if (flags & CONNECT_PERSIST) == 0:
			continue
		var entry := {"flags": flags}
		var signal_value = connection.get("signal")
		if typeof(signal_value) == TYPE_SIGNAL:
			entry["signal"] = String(signal_value.get_name())
			var source = signal_value.get_object()
			if source is Node and (source == root or root.is_ancestor_of(source)):
				entry["from"] = "." if source == root else String(root.get_path_to(source))
		var callable = connection.get("callable", Callable())
		if callable.is_valid():
			var target = callable.get_object()
			if target is Node and (target == root or root.is_ancestor_of(target)):
				entry["to"] = "." if target == root else String(root.get_path_to(target))
			entry["method"] = String(callable.get_method())
			var bound_arguments: Array = callable.get_bound_arguments()
			if not bound_arguments.is_empty():
				entry["binds"] = _bridge_json_safe(bound_arguments)
			var unbound_argument_count: int = _callable_unbind_count(callable)
			if unbound_argument_count > 0:
				entry["unbinds"] = unbound_argument_count
		result.append(entry)
	return result


func _callable_unbind_count(callable_value) -> int:
	var version := Engine.get_version_info()
	if int(version.get("major", 4)) > 4 or int(version.get("minor", 0)) >= 4:
		return int(callable_value.get_unbound_arguments_count())
	return maxi(-int(callable_value.get_bound_arguments_count()), 0)


func _write_descriptor() -> void:
	if _descriptor_path.is_empty():
		return
	var descriptor := {
		"schema": "godot-mcp-editor-bridge",
		"protocol": PROTOCOL,
		"instance_id": _instance_id,
		"pid": OS.get_process_id(),
		"project_path": _project_path(),
		"project_name": ProjectSettings.get_setting("application/config/name", "Unknown"),
		"godot_version": String(Engine.get_version_info().get("string", "unknown")),
		"host": "127.0.0.1",
		"port": _server.get_local_port(),
		"token": _token,
		"capabilities": ["editor.state", "editor.scene.read", "editor.play.control", "editor.performance"],
		"heartbeat_at_ms": _now_ms(),
	}
	var temporary_path := _descriptor_path + ".tmp"
	var file := FileAccess.open(temporary_path, FileAccess.WRITE)
	if file == null:
		return
	file.store_string(JSON.stringify(descriptor))
	file.close()
	if OS.get_name() != "Windows":
		FileAccess.set_unix_permissions(ProjectSettings.globalize_path(temporary_path), 384)
	DirAccess.rename_absolute(ProjectSettings.globalize_path(temporary_path), ProjectSettings.globalize_path(_descriptor_path))


func _send_result(peer: StreamPeerTCP, request_id, result) -> void:
	_send(peer, {"jsonrpc": "2.0", "id": request_id, "result": result})


func _send_error(peer: StreamPeerTCP, request_id, code: int, message: String) -> void:
	_send(peer, {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


func _send(peer: StreamPeerTCP, payload: Dictionary) -> void:
	peer.put_data((JSON.stringify(payload) + "\n").to_utf8_buffer())


func _remove_client(peer: StreamPeerTCP) -> void:
	_clients.erase(peer)
	_buffers.erase(peer)
	_authenticated.erase(peer)
	_connected_at.erase(peer)
	peer.disconnect_from_host()


func _project_path() -> String:
	return ProjectSettings.globalize_path("res://").trim_suffix("/")


func _now_ms() -> int:
	return int(Time.get_unix_time_from_system() * 1000.0)


func _bridge_json_safe(value, depth: int = 0):
	if depth > 8:
		return "<max-depth>"
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING, TYPE_STRING_NAME:
			return value
		TYPE_VECTOR2:
			return {"_type": "Vector2", "x": value.x, "y": value.y}
		TYPE_VECTOR3:
			return {"_type": "Vector3", "x": value.x, "y": value.y, "z": value.z}
		TYPE_COLOR:
			return {"_type": "Color", "r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_NODE_PATH:
			return {"_type": "NodePath", "value": String(value)}
		TYPE_ARRAY:
			var output := []
			for item in value:
				output.append(_bridge_json_safe(item, depth + 1))
			return output
		TYPE_DICTIONARY:
			var output := {}
			for key in value:
				output[String(key)] = _bridge_json_safe(value[key], depth + 1)
			return output
		TYPE_OBJECT:
			if value is Resource:
				return {"_type": value.get_class(), "resource_path": value.resource_path}
	return str(value)
