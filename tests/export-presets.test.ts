import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";
test("export presets are personal, validated presentation settings and cannot store arbitrary agenda content", async (t) => {
  const h = await harness(t);
  await h.setup();
  const viewer = await h.account("export-preset@example.test");
  const created = await h.owner.request("/export/presets", "POST", {
    name: "Facilitator handout",
    audience: "team",
    options: {
      paper: "Legal",
      font: "Georgia",
      fontSize: 12,
      layout: "table",
      includeMaterials: true,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.preset.options.dayPageBreak, true);
  assert.equal(
    (await viewer.client.request("/export/presets")).body.presets.length,
    0,
  );
  await viewer.client.request(
    `/export/presets/${created.body.preset.id}`,
    "DELETE",
  );
  assert.equal(
    (await h.owner.request("/export/presets")).body.presets.length,
    1,
  );
  assert.equal(
    (
      await h.owner.request("/export/presets", "POST", {
        name: "Invalid",
        audience: "team",
        options: { script: "bad" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await viewer.client.request(
        `/export/presets/${created.body.preset.id}`,
        "PUT",
        { name: "Not mine", audience: "public", options: {} },
      )
    ).status,
    404,
  );
  const updated = await h.owner.request(
    `/export/presets/${created.body.preset.id}`,
    "PUT",
    { name: "Renamed", audience: "public", options: { fontSize: 14 } },
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.preset.name, "Renamed");
  assert.equal(
    (await h.owner.request("/export/presets")).body.presets[0].options.fontSize,
    14,
  );
  await h.owner.request(`/export/presets/${created.body.preset.id}`, "DELETE");
  assert.equal(
    (await h.owner.request("/export/presets")).body.presets.length,
    0,
  );
});
