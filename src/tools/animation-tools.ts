import type { ToolHandler } from "./types.js";
import type { GodotExecutor } from "../godot/executor.js";
import { isGodotProject } from "../godot/finder.js";

// Create Animation Tool
export const createAnimationTool: ToolHandler = {
  definition: {
    name: "create_animation",
    description: "Create an AnimationPlayer with a new animation in a Godot scene",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
        scene_path: {
          type: "string",
          description: "Path to the scene file",
        },
        node_path: {
          type: "string",
          description: "Path to the node where AnimationPlayer should be added (use '.' for root)",
          default: ".",
        },
        animation_name: {
          type: "string",
          description: "Name of the animation to create",
          default: "default",
        },
        duration: {
          type: "number",
          description: "Duration of the animation in seconds",
          default: 1.0,
        },
        loop: {
          type: "boolean",
          description: "Whether the animation should loop",
          default: false,
        },
      },
      required: ["project_path", "scene_path"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;
    const scenePath = args.scene_path as string;
    const nodePath = (args.node_path as string) || ".";
    const animationName = (args.animation_name as string) || "default";
    const duration = (args.duration as number) || 1.0;
    const loop = (args.loop as boolean) || false;

    if (!executor) {
      throw new Error("Godot is not available");
    }

    if (!(await isGodotProject(projectPath))) {
      throw new Error(`Not a valid Godot project: ${projectPath}`);
    }

    const result = await executor.execute(projectPath, "create_animation", {
      scene_path: scenePath,
      node_path: nodePath,
      animation_name: animationName,
      duration,
      loop,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to create animation");
    }

    return result.output;
  },
};

// Add Animation Track Tool
export const addAnimationTrackTool: ToolHandler = {
  definition: {
    name: "add_animation_track",
    description: "Add an animation track with keyframes to an existing animation",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Absolute path to the Godot project directory",
        },
        scene_path: {
          type: "string",
          description: "Path to the scene file",
        },
        animation_player_path: {
          type: "string",
          description: "Path to the AnimationPlayer node in the scene",
        },
        animation_name: {
          type: "string",
          description: "Name of the animation to add the track to",
        },
        target_node_path: {
          type: "string",
          description: "Path to the node being animated (relative to AnimationPlayer's parent)",
        },
        property: {
          type: "string",
          description: "Property to animate (e.g., 'position', 'rotation', 'modulate')",
        },
        keyframes: {
          type: "array",
          description: "Array of keyframes with time and value",
          items: {
            type: "object",
            properties: {
              time: {
                type: "number",
                description: "Time in seconds for this keyframe",
              },
              value: {
                description: "Value at this keyframe. Use objects like {_type: 'Vector2', x: 0, y: 0} for complex types",
              },
            },
            required: ["time", "value"],
          },
        },
      },
      required: ["project_path", "scene_path", "animation_player_path", "animation_name", "target_node_path", "property", "keyframes"],
    },
  },
  async execute(args, executor) {
    const projectPath = args.project_path as string;
    const scenePath = args.scene_path as string;
    const animationPlayerPath = args.animation_player_path as string;
    const animationName = args.animation_name as string;
    const targetNodePath = args.target_node_path as string;
    const property = args.property as string;
    const keyframes = args.keyframes as Array<{ time: number; value: unknown }>;

    if (!executor) {
      throw new Error("Godot is not available");
    }

    const result = await executor.execute(projectPath, "add_animation_track", {
      scene_path: scenePath,
      animation_player_path: animationPlayerPath,
      animation_name: animationName,
      target_node_path: targetNodePath,
      property,
      keyframes,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to add animation track");
    }

    return result.output;
  },
};

export const animationTools = [
  createAnimationTool,
  addAnimationTrackTool,
];
