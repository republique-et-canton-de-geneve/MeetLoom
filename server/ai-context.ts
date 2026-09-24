/** Keep every authorized agenda discoverable while bounding the model request. */
export function boundedAgendaContext(
  context: Array<{ id: string; title: string; [key: string]: unknown }>,
  limit = 60000,
) {
  const complete = JSON.stringify(context);
  if (complete.length <= limit)
    return { text: complete, truncated: false, sessions: context.length };
  const values = context.map((value) => ({
    id: value.id,
    title: value.title.slice(0, 120),
    excerpt: "",
  }));
  let size = Math.max(
    0,
    Math.floor(
      (limit - JSON.stringify(values).length) / Math.max(1, values.length),
    ),
  );
  const sources = context.map((value) => JSON.stringify(value));
  for (;;) {
    const text = JSON.stringify(
      values.map((value, index) => ({
        ...value,
        excerpt: sources[index].slice(0, size),
      })),
    );
    if (text.length <= limit)
      return { text, truncated: true, sessions: context.length };
    if (!size) throw new Error("AI_CONTEXT_LIMIT");
    size = Math.floor(size / 2);
  }
}
