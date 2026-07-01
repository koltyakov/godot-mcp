import type { ToolHandler } from "./types.js";
import { destructiveAnnotations } from "./types.js";
import { projectSelectorProperties, resolveProjectPath } from "./project-context.js";
import { normalizeResourcePath, SCENE_EXTENSIONS } from "./path-utils.js";

// Create Animation Tool
export const createAnimationTool: ToolHandler = {
  definition: {
    name: "create_animation",
    description: "Create an AnimationPlayer with a new animation in a Godot scene",
    inputSchema: {
      type: "object",
      properties: {
        ...projectSelectorProperties,
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
      required: ["scene_path"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);
    const scenePath = normalizeResourcePath(args.scene_path as string, {
      fieldName: "scene_path",
      extensions: SCENE_EXTENSIONS,
    });
    const nodePath = (args.node_path as string) || ".";
    const animationName = (args.animation_name as string) || "default";
    const duration = (args.duration as number | undefined) ?? 1.0;
    const loop = (args.loop as boolean | undefined) ?? false;

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
        ...projectSelectorProperties,
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
          description: "Property to animate for value/bezier tracks (e.g., 'position', 'rotation', 'modulate'). Ignored for method/audio/animation tracks.",
        },
        track_type: {
          type: "string",
          enum: ["value", "position_3d", "rotation_3d", "scale_3d", "blend_shape", "method", "bezier", "audio", "animation"],
          description: "Kind of animation track to add. Defaults to 'value'. 'method' keyframes take {method, args}; 'audio' takes {stream_path, start_offset, end_offset}; 'animation' takes a nested animation name string.",
          default: "value",
        },
        keyframes: {
          type: "array",
          description: "Array of keyframes. Each keyframe includes at least {time} plus a 'value' (or method/audio/animation-specific shape).",
          items: {
            type: "object",
            properties: {
              time: {
                type: "number",
                description: "Time in seconds for this keyframe",
              },
              value: {
                description: "Value at this keyframe. Use {_type:'Vector2',x,y} for math types, {_type:'Resource',path} for resource refs, or a plain number/string/dict as appropriate to the track_type.",
              },
              in_handle: { type: "number", description: "Bezier in-handle offset (bezier track only)." },
              out_handle: { type: "number", description: "Bezier out-handle offset (bezier track only)." },
              method: { type: "string", description: "Method name (method tracks only, set inside value)." },
              args: { type: "array", description: "Method call arguments (method tracks only, set inside value)." },
              stream_path: { type: "string", description: "res:// path of an AudioStream (audio tracks only)." },
              start_offset: { type: "number", description: "Audio start offset in seconds (audio tracks only)." },
              end_offset: { type: "number", description: "Audio end offset in seconds (audio tracks only)." },
            },
            required: ["time"],
          },
        },
      },
      required: ["scene_path", "animation_player_path", "animation_name", "target_node_path", "keyframes"],
    },
    annotations: destructiveAnnotations,
  },
  async execute(args, executor) {
    if (!executor) {
      throw new Error("Godot is not available");
    }

    const projectPath = await resolveProjectPath(args);
    const scenePath = normalizeResourcePath(args.scene_path as string, {
      fieldName: "scene_path",
      extensions: SCENE_EXTENSIONS,
    });
    const animationPlayerPath = args.animation_player_path as string;
    const animationName = args.animation_name as string;
    const targetNodePath = args.target_node_path as string;
    const property = args.property as string | undefined;
    const trackType = (args.track_type as string | undefined) || "value";
    const keyframes = args.keyframes as Array<Record<string, unknown>>;

    const result = await executor.execute(projectPath, "add_animation_track", {
      scene_path: scenePath,
      animation_player_path: animationPlayerPath,
      animation_name: animationName,
      target_node_path: targetNodePath,
      property: property ?? "",
      track_type: trackType,
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
