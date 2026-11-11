// Runs the editor change detection used to disable no-op saves against each spec kind's
// real draft conversion, so UI-only edits and reverted edits never count as changes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(web, "node_modules", ".cache", "save-compare");
fs.mkdirSync(out, { recursive: true });
for (const name of ["specModel", "mqttModel", "wsModel", "deviceModel", "saveCompare"]) {
  const source = fs.readFileSync(path.join(web, "src/spec", `${name}.ts`), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(out, `${name}.mjs`), code.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'));
}
const load = (name) => import(new URL(`file:///${path.join(out, `${name}.mjs`).replace(/\\/g, "/")}`).href);
const rest = await load("specModel");
const mqtt = await load("mqttModel");
const ws = await load("wsModel");
const device = await load("deviceModel");
const { itemChanged, itemSaveBody, sameValue } = await load("saveCompare");

const kinds = [
  {
    label: "REST",
    blank: () => {
      const draft = rest.blankItem();
      draft.name = "주문 생성";
      draft.path = "/orders";
      draft.requestBody.fields = [rest.blankField("id"), rest.blankField("qty")];
      return draft;
    },
    fromApi: rest.itemFromApi,
    toPayload: rest.itemToPayload,
    reorderFields: (draft) => ({ ...draft, requestBody: { ...draft.requestBody, fields: [...draft.requestBody.fields].reverse() } }),
  },
  {
    label: "MQTT",
    blank: () => ({ ...mqtt.blankMqtt(), name: "상태", topic: "gw/1/status", fields: [rest.blankField("a"), rest.blankField("b")] }),
    fromApi: mqtt.mqttFromApi,
    toPayload: mqtt.mqttToPayload,
  },
  {
    label: "WebSocket",
    blank: () => ({ ...ws.blankWs(), name: "", eventName: "door.open" }),
    fromApi: ws.wsFromApi,
    toPayload: ws.wsToPayload,
    nameOf: ws.messageName,
  },
  {
    label: "Device",
    blank: () => ({ ...device.blankDevice(), name: "문열기", commandId: "0x01" }),
    fromApi: device.deviceFromApi,
    toPayload: device.deviceToPayload,
  },
];

let failed = 0;
const expect = (label, actual, wanted) => {
  const ok = actual === wanted;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

for (const kind of kinds) {
  const seed = kind.blank();
  const stored = {
    itemUid: "u1", sortOrder: 1, name: (kind.nameOf ? kind.nameOf(seed) : seed.name).trim(), summary: "", status: "ACTIVE",
    payload: kind.toPayload(seed), errorCodes: [{ id: 7, code: "E7" }, { id: 3, code: "E3" }],
  };
  const original = kind.fromApi(stored);
  const baseline = itemSaveBody(original, kind.toPayload, kind.nameOf);
  const changed = (draft, isNew = false) => itemChanged(isNew, baseline, itemSaveBody(draft, kind.toPayload, kind.nameOf));

  expect(`${kind.label}: opened and untouched`, changed(original), false);
  expect(`${kind.label}: reloaded from the same stored item`, changed(kind.fromApi(stored)), false);
  expect(`${kind.label}: change reason only`, changed({ ...original, changeReason: "사유" }), false);
  expect(`${kind.label}: summary padded with spaces`, changed({ ...original, summary: "   " }), false);
  expect(`${kind.label}: linked error codes in another order`, changed({ ...original, errorCodeIds: [3, 7] }), false);
  const edited = { ...original, summary: "바뀐 설명" };
  expect(`${kind.label}: summary edited`, changed(edited), true);
  expect(`${kind.label}: summary edited then reverted`, changed({ ...edited, summary: original.summary }), false);
  expect(`${kind.label}: error code removed`, changed({ ...original, errorCodeIds: [3] }), true);
  expect(`${kind.label}: new item is always a change`, changed(original, true), true);
  if (kind.reorderFields) {
    expect(`${kind.label}: field order swapped`, changed(kind.reorderFields(original)), true);
  }
}

expect("object key order is not a change", sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
expect("array order is a change", sameValue([1, 2], [2, 1]), false);
expect("undefined property equals missing property", sameValue({ a: 1, b: undefined }, { a: 1 }), true);
expect("null differs from missing property", sameValue({ a: 1, b: null }, { a: 1 }), false);
expect("conversion failure counts as a change", itemChanged(false, { name: "a" }, null), true);

console.log(failed === 0 ? "\nall cases passed" : `\n${failed} case(s) failed`);
process.exit(failed === 0 ? 0 : 1);
