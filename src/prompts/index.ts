import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: PromptArgument[];
  /**
   * Returns the prompt messages for the given arguments. Should throw if
   * required arguments are missing or invalid.
   */
  build: (args: Record<string, string>) => { description?: string; messages: PromptMessage[] };
}

type PromptContent =
  | { type: "text"; text: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text: string } };

export interface PromptMessage {
  role: "user" | "assistant";
  content: PromptContent;
}

function userText(text: string): PromptMessage {
  return { role: "user", content: { type: "text", text } };
}

function requireArg(args: Record<string, string>, name: string, promptName: string): string {
  const value = args[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required argument "${name}" for prompt "${promptName}"`);
  }
  return value;
}

const prompts: PromptDefinition[] = [
  {
    name: "new-2d-player",
    description:
      "Scaffold a 2D player scene: CharacterBody2D root with Sprite2D, CollisionShape2D, and a basic movement script.",
    arguments: [
      { name: "scene_path", description: "res:// path for the new scene (e.g. res://scenes/player.tscn)", required: true },
      { name: "script_path", description: "res:// path for the movement script (e.g. res://scripts/player.gd)", required: true },
    ],
    build: (args) => {
      const scenePath = requireArg(args, "scene_path", "new-2d-player");
      const scriptPath = requireArg(args, "script_path", "new-2d-player");
      return {
        messages: [
          userText(
            [
              `Create a 2D player scene at ${scenePath} with the following structure and behavior:`,
              ``,
              `1. Root node: CharacterBody2D named "Player".`,
              `2. Add a Sprite2D child named "Sprite2D" (leave texture empty for now).`,
              `3. Add a CollisionShape2D child named "CollisionShape2D" with a CapsuleShape2D resource sized appropriately for a 2D character.`,
              `4. Create a GDScript at ${scriptPath} extending CharacterBody2D with:`,
              `   - SPEED = 300.0 and JUMP_VELOCITY = -400.0 constants`,
              `   - gravity taken from ProjectSettings via get_gravity()`,
              `   - _physics_process that applies gravity, handles ui_accept jump when on floor, and ui_left/ui_right horizontal movement via move_and_slide()`,
              `5. Attach the script to the Player root node.`,
              ``,
              `Use create_scene, then add both children in one apply_scene_changes transaction. Use create_resource, create_script, and attach_script for the remaining assets. Report the transaction's resulting node paths.`,
            ].join("\n")
          ),
        ],
      };
    },
  },
  {
    name: "new-3d-player",
    description:
      "Scaffold a 3D player scene: CharacterBody3D root with MeshInstance3D, CollisionShape3D, Camera3D, and a movement script.",
    arguments: [
      { name: "scene_path", description: "res:// path for the new scene", required: true },
      { name: "script_path", description: "res:// path for the movement script", required: true },
    ],
    build: (args) => {
      const scenePath = requireArg(args, "scene_path", "new-3d-player");
      const scriptPath = requireArg(args, "script_path", "new-3d-player");
      return {
        messages: [
          userText(
            [
              `Create a 3D player scene at ${scenePath} with the following structure:`,
              ``,
              `1. Root node: CharacterBody3D named "Player".`,
              `2. Add a MeshInstance3D named "Mesh" with a BoxMesh (1x1x1).`,
              `3. Add a CollisionShape3D named "Collision" with a BoxShape3D matching the mesh.`,
              `4. Add a Camera3D named "Camera" positioned behind/above and looking at the player (e.g. position (0, 1.5, 4)).`,
              `5. Create a GDScript at ${scriptPath} extending CharacterBody3D implementing WASD/arrows movement (SPEED = 5.0), gravity, and space-to-jump (JUMP_VELOCITY = 4.5) using move_and_slide().`,
              `6. Attach the script to the Player root.`,
              ``,
              `Use create_scene, then add the Mesh, Collision, and Camera in one apply_scene_changes transaction. Use create_resource, create_script, and attach_script for the remaining assets.`,
            ].join("\n")
          ),
        ],
      };
    },
  },
  {
    name: "gdscript-conventions",
    description:
      "Inject Godot 4.x GDScript conventions and idioms as context for the conversation. Use before writing GDScript by hand.",
    build: () => ({
      messages: [
        userText(
          [
            `Apply the following Godot 4.x GDScript conventions to any scripts you write or modify in this session:`,
            ``,
            `- Use @export (not the old ` + "`export`" + ` keyword) for exported variables.`,
            `- Use @onready var x = $Node (not the old onready keyword).`,
            `- Strongly type variables and return types where practical: var speed: float = 300.0, func _ready() -> void:.`,
            `- Use get_gravity() (CharacterBody2D/3D) rather than a hardcoded gravity constant when possible.`,
            `- Prefer signal_name in lieu of stringly-typed connect: e.g. button.pressed.connect(_on_pressed).`,
            `- Use PackedStringArray, Vector2/Vector3/Color literals (Vector2(1, 0)) and typed arrays Array[int].`,
            `- For input, use Input.get_vector / Input.get_axis instead of polling each action manually.`,
            `- Node references: use $NodePath or %UniqueName (scene-unique node with %) for stable references.`,
            `- Use Engine.get_process_frames() / Time.get_ticks_msec() for timing instead of accumulating deltas when you can.`,
            `- _process(delta) is for visual updates; _physics_process(delta) is for movement and physics state.`,
            `- Avoid load() in hot paths; prefer @preload for constants or cache in _ready().`,
            `- Godot 4 uses PascalCase for class/node names and snake_case for functions/variables.`,
            ``,
            `When asked to create or edit a script, match these conventions unless the user overrides them.`,
          ].join("\n")
        ),
      ],
    }),
  },
  {
    name: "audit-scene",
    description:
      "Read a scene and produce a structured audit: node hierarchy, types, attached scripts, and suggestions for missing pieces.",
    arguments: [{ name: "scene_path", description: "res:// path of the scene to audit", required: true }],
    build: (args) => {
      const scenePath = requireArg(args, "scene_path", "audit-scene");
      return {
        messages: [
          userText(
            [
              `Audit the Godot scene at ${scenePath}.`,
              ``,
              `Steps:`,
              `1. Use the read_scene tool (or the godot://scene/${encodeURIComponent(scenePath)} resource) to load the node tree.`,
              `2. Report the hierarchy with each node's type and any attached script.`,
              `3. Flag common issues:`,
              `   - CharacterBody/RigidBody without a CollisionShape child`,
              `   - Sprite2D without a texture (where detectable from properties)`,
              `   - AnimationPlayer with no animations`,
              `   - root node without a script if the scene is interactive`,
              `4. Suggest concrete next steps as a bulleted list.`,
            ].join("\n")
          ),
        ],
      };
    },
  },
];

const promptMap = new Map(prompts.map((p) => [p.name, p]));

export function listPromptDefinitions() {
  return prompts.map((p) => ({
    name: p.name,
    description: p.description,
    arguments: p.arguments,
  }));
}

export function getPrompt(name: string, args: Record<string, string>) {
  const prompt = promptMap.get(name);
  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  return prompt.build(args);
}

export function setupPromptHandlers(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: listPromptDefinitions() };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args: Record<string, string> = {};
    if (rawArgs) {
      for (const [key, value] of Object.entries(rawArgs)) {
        args[key] = typeof value === "string" ? value : String(value ?? "");
      }
    }

    try {
      const result = getPrompt(name, args);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  });
}
