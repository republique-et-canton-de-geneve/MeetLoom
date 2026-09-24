import test from "node:test";
import assert from "node:assert/strict";
import { createSession, newBlock, transitionRun } from "../shared/domain.js";
import { aiProposalSchema, applyAiOperations } from "../shared/ai.js";

test("AI proposal operations are validated, immutable and cannot change audiences or ownership", () => {
  const session = createSession("owner", "Agenda", "en", true),
    before = JSON.stringify(session),
    block = session.days[0].blocks[0];
  const result = applyAiOperations(
    session,
    [
      {
        type: "update_block",
        blockId: block.id,
        changes: {
          duration: 12,
          description: "Rewritten",
          fields: { notes: "Private prompt" },
        },
      },
      { type: "update_day", dayId: session.days[0].id, date: "2026-10-15" },
    ],
    "en",
  );
  assert.equal(result.days[0].blocks[0].duration, 12);
  assert.equal(result.days[0].blocks[0].fields.notes, "Private prompt");
  assert.equal(result.days[0].date, "2026-10-15");
  assert.equal(JSON.stringify(session), before);
  assert.deepEqual(result.columns, session.columns);
  assert.equal(result.ownerId, session.ownerId);
  assert.equal(
    aiProposalSchema.safeParse({
      answer: "Unsafe",
      operations: [{ type: "update_session", ownerId: "someone" }],
    }).success,
    false,
  );
  assert.throws(() =>
    applyAiOperations(
      session,
      [
        {
          type: "update_block",
          blockId: block.id,
          changes: { fields: { unknown: "Bad" } },
        },
      ],
      "en",
    ),
  );
});
test("AI creates private pages and unpublished forms with fresh IDs; active clock blocks cannot be removed", () => {
  const session = createSession("owner", "Agenda", "en", true);
  const result = applyAiOperations(
    session,
    [
      { type: "create_page", title: "Brief", content: "Instructions" },
      {
        type: "create_form",
        title: "Feedback",
        description: "Your thoughts",
        questions: [
          {
            type: "matrix",
            title: "Rate these",
            description: "",
            required: true,
            rows: ["Content", "Pacing"],
            options: ["Good", "Great"],
          },
        ],
      },
    ],
    "en",
  );
  assert.equal(result.pages![0].visibility, "team");
  assert.equal(result.forms![0].questions[0].type, "matrix");
  assert.equal("publication" in result.forms![0], false);
  const running = transitionRun(session, "start", {}, 1000);
  assert.throws(() =>
    applyAiOperations(
      running,
      [{ type: "delete_blocks", blockIds: [running.run.blockId!] }],
      "en",
    ),
  );
  assert.throws(() =>
    applyAiOperations(
      session,
      [{ type: "update_day", dayId: session.days[0].id, date: "2026-02-30" }],
      "en",
    ),
  );
});
test("AI inserts into nested groups and maintains derived durations", () => {
  const session = createSession("owner", "Agenda", "en");
  const child = newBlock("en", { duration: 5 });
  session.days[0].blocks = [
    newBlock("en", { kind: "group", children: [child] }),
  ];
  const result = applyAiOperations(
    session,
    [
      {
        type: "add_blocks",
        dayId: session.days[0].id,
        afterBlockId: child.id,
        blocks: [
          {
            title: "New",
            description: "Activity",
            duration: 10,
            category: "activity",
            facilitator: "",
            section: "",
          },
        ],
      },
    ],
    "en",
  );
  assert.equal(result.days[0].blocks[0].children?.length, 2);
  assert.equal(result.days[0].blocks[0].duration, 15);
});
