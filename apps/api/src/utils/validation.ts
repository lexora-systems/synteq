import type { ZodTypeAny } from "zod";

export function parseWithSchema<TSchema extends ZodTypeAny>(schema: TSchema, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
    const error = new Error(message);
    error.name = "ValidationError";
    throw error;
  }

  return parsed.data;
}
