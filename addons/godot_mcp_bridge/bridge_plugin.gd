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
	_write_descriptor()
	set_process(true)


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
			"capabilities": ["editor.state", "editor.scene.read"],
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
			_send_result(peer, request_id, {
				"scene_path": scene_root.scene_file_path if not scene_root.scene_file_path.is_empty() else null,
				"dirty": null,
				"dirty_confidence": "unknown",
				"tree": _serialize_node(scene_root, scene_root, 0),
			})
		_:
			_send_error(peer, request_id, -32601, "Method not found")


func _editor_state() -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
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
	return {
		"project": {"path": _project_path(), "name": ProjectSettings.get_setting("application/config/name", "Unknown")},
		"scene": null if root == null else {
			"path": root.scene_file_path if not root.scene_file_path.is_empty() else null,
			"name": root.name,
			"type": root.get_class(),
			"dirty": null,
			"dirty_confidence": "unknown",
		},
		"open_scenes": open_scenes,
		"selection": {"nodes": selected},
		"play": {"playing": EditorInterface.is_playing_scene()},
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
	}
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
	if node.get_script() is Script:
		result["script"] = (node.get_script() as Script).resource_path
	if depth >= 64:
		result["truncated"] = true
		return result
	for child in node.get_children():
		if child is Node:
			result["children"].append(_serialize_node(child, root, depth + 1))
	return result


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
		"capabilities": ["editor.state", "editor.scene.read"],
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
