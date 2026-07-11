const MAX_TEXT_RESULT_CHARS = 100_000;

export const permissiveToolOutputSchema = {
  type: "object" as const,
  additionalProperties: true,
};

function asStructuredResult(result: unknown): Record<string, unknown> {
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
}

function renderText(result: unknown): string {
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  if (text.length <= MAX_TEXT_RESULT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_TEXT_RESULT_CHARS)}\n[Text view truncated; use structuredContent for the complete result]`;
}

export function toolSuccessResponse(result: unknown) {
  return {
    content: [{ type: "text" as const, text: renderText(result) }],
    structuredContent: asStructuredResult(result),
  };
}

export function toolErrorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    structuredContent: { error: { message } },
    isError: true,
  };
}
