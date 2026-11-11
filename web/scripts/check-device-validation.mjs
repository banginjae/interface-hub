// Runs the device protocol validator and writes the payloads the page would send to
// internal/service/testdata/device_editor_cases.json. TestNormalizeDeviceEditorCases replays
// that file against NormalizeDevicePayload, so the client verdict, the client payload
// conversion and the server verdict are checked against the same cases.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.resolve(web, "..", "internal", "service", "testdata", "device_editor_cases.json");
const out = path.join(web, "node_modules", ".cache", "device-validation");
fs.mkdirSync(out, { recursive: true });
for (const name of ["specModel", "restValidation", "deviceModel", "deviceValidation"]) {
  const source = fs.readFileSync(path.join(web, "src/spec", `${name}.ts`), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(out, `${name}.mjs`), code.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"'));
}
const load = (name) => import(new URL(`file:///${path.join(out, `${name}.mjs`).replace(/\\/g, "/")}`).href);
const spec = await load("specModel");
const device = await load("deviceModel");
const check = await load("deviceValidation");

function command(commandId = "0x03") {
  return Object.assign(device.blankDevice(), { commandId, name: "문열기", changeReason: "test" });
}
function field(name, type, layout = {}, extra = {}) {
  return Object.assign(spec.blankField(name), { type }, layout, extra);
}
function fixed(name, type, offset, length, extra = {}) {
  return field(name, type, { lengthMode: "FIXED", byteOffset: String(offset), byteLength: String(length) }, extra);
}

const packet = () => [
  fixed("Start", "bytes", 0, 1, { example: "Ag==" }),
  fixed("Command", "integer", 1, 1, { encoding: "UINT8", example: "3" }),
  fixed("ErrorCode", "integer", 2, 2, { endian: "LITTLE", encoding: "UINT16", example: "0" }),
  fixed("Param1", "integer", 4, 2, { endian: "LITTLE", encoding: "UINT16", example: "1" }),
  fixed("Param2", "integer", 6, 2, { endian: "LITTLE", encoding: "UINT16", example: "0" }),
  fixed("Param3", "integer", 8, 4, { endian: "LITTLE", encoding: "UINT32", example: "0" }),
  fixed("ExtraDataLength", "integer", 12, 2, { endian: "LITTLE", encoding: "UINT16", example: "0" }),
  fixed("HeaderChecksum", "integer", 14, 1, { encoding: "UINT8", example: "90" }),
  fixed("ExtraDataChecksum", "integer", 15, 1, { encoding: "UINT8", example: "0" }),
  field("ExtraData", "bytes", { lengthMode: "VARIABLE", byteOffset: "16", encoding: "BYTES" }),
];

const cases = [
  ["minimum: Command ID and name only", true, () => command()],
  ["reference packet: 16 fixed bytes + variable ExtraData", true, () => { const d = command(); d.fields = packet(); d.exampleHex = "02 03 00 00 01 00 00 00 00 00 00 00 00 00 5A 00"; return d; }],
  ["fields without any byte layout", true, () => { const d = command(); d.fields = [field("Param1", "bytes"), field("Note", "string")]; return d; }],
  ["FIXED with endian but position not decided yet", true, () => { const d = command(); d.fields = [field("Param1", "bytes", { lengthMode: "FIXED", endian: "LITTLE" })]; return d; }],
  ["BITFIELD inside one byte", true, () => { const d = command(); d.fields = [fixed("Flags", "integer", 3, 1, { encoding: "BITFIELD", bitOffset: "0", bitLength: "1", example: "1" })]; return d; }],
  ["VARIABLE with offset only", true, () => { const d = command(); d.fields = [field("ExtraData", "bytes", { lengthMode: "VARIABLE", byteOffset: "16" })]; return d; }],
  ["HEX with spaces and lowercase", true, () => { const d = command(); d.exampleHex = "02 03 0a"; return d; }],
  ["length without offset", false, () => { const d = command(); d.fields = [field("Param1", "bytes", { lengthMode: "FIXED", byteLength: "2" })]; return d; }],
  ["offset without length", false, () => { const d = command(); d.fields = [field("Param1", "bytes", { lengthMode: "FIXED", byteOffset: "4" })]; return d; }],
  ["overlapping FIXED ranges", false, () => { const d = command(); d.fields = [fixed("A", "bytes", 0, 2), fixed("B", "bytes", 1, 2)]; return d; }],
  ["zero length", false, () => { const d = command(); d.fields = [fixed("A", "bytes", 0, 0)]; return d; }],
  ["negative offset", false, () => { const d = command(); d.fields = [fixed("A", "bytes", -1, 1)]; return d; }],
  ["BITFIELD wider than the field", false, () => { const d = command(); d.fields = [fixed("Flags", "integer", 0, 1, { encoding: "BITFIELD", bitOffset: "0", bitLength: "9", example: "1" })]; return d; }],
  ["BITFIELD without bit range", false, () => { const d = command(); d.fields = [fixed("Flags", "integer", 0, 1, { encoding: "BITFIELD", example: "1" })]; return d; }],
  ["odd HEX digits", false, () => { const d = command(); d.exampleHex = "02 0"; return d; }],
  ["HEX with line break", false, () => { const d = command(); d.exampleHex = "02 03\n00"; return d; }],
  ["HEX with non-hex character", false, () => { const d = command(); d.exampleHex = "02 0G"; return d; }],
  ["empty Command ID", false, () => command("")],
  ["Command ID with tab", false, () => command("0x\t03")],
  ["integer field without example", false, () => { const d = command(); d.fields = [fixed("Command", "integer", 0, 1)]; return d; }],
  ["blank field name", false, () => { const d = command(); d.fields = [field("", "bytes")]; return d; }],
  ["interpreted JSON with undefined key", false, () => { const d = command(); d.fields = [field("Param1", "string", {}, { example: "a" })]; d.exampleMode = "MANUAL"; d.manualText = '{"Param1":"a","extra":1}'; return d; }],
];

let failed = 0;
const records = [];
for (const [label, expectValid, make] of cases) {
  const draft = make();
  const issues = check.validateCommand(draft, "new");
  const ok = expectValid ? issues.length === 0 : issues.length > 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const issue of issues) console.log(`        [${issue.tab}] ${issue.where}: ${issue.message}`);
  let payload = null;
  try {
    payload = device.deviceToPayload(draft);
  } catch {
    payload = null;
  }
  if (payload) records.push({ name: label, valid: expectValid, payload });
}

// Client-only rules: the page blocks these because the payload conversion would silently drop values.
const dropped = command();
dropped.fields = [field("Param1", "bytes", { endian: "LITTLE" })];
const droppedOk = check.validateCommand(dropped, "new").length > 0;
if (!droppedOk) failed += 1;
console.log(`${droppedOk ? "PASS" : "FAIL"}  client: Endian without length mode is blocked instead of being dropped`);
const text = command();
text.fields = [field("Param1", "bytes", { lengthMode: "FIXED", byteOffset: "a", byteLength: "2" })];
const textOk = check.validateCommand(text, "new").some((issue) => issue.message.includes("Offset"));
if (!textOk) failed += 1;
console.log(`${textOk ? "PASS" : "FAIL"}  client: non-numeric Offset is reported`);

const filled = device.fillOffsets([
  field("Start", "bytes", { lengthMode: "FIXED", byteLength: "1" }),
  field("Command", "bytes", { lengthMode: "FIXED", byteLength: "1" }),
  fixed("ErrorCode", "bytes", 2, 2),
  field("Param1", "bytes", { lengthMode: "FIXED", byteLength: "2" }),
  field("ExtraData", "bytes", { lengthMode: "VARIABLE" }),
  field("After", "bytes", { lengthMode: "FIXED", byteLength: "1" }),
]);
const offsets = filled.fields.map((item) => item.byteOffset).join(",");
const fillOk = offsets === "0,1,2,4,6," && filled.filled === 4;
if (!fillOk) failed += 1;
console.log(`${fillOk ? "PASS" : "FAIL"}  client: Offset auto-fill fills empty offsets in order and stops after a variable field (${offsets})`);

const summary = device.layoutSummary(packet());
const sumOk = summary.fixedSum === 16 && summary.variable.length === 1 && !summary.complete;
if (!sumOk) failed += 1;
console.log(`${sumOk ? "PASS" : "FAIL"}  client: reference packet sums to 16 Bytes + 1 variable field`);

const siblings = check.sameCommandIds([
  { itemUid: "a", payload: { commandId: "0x03", direction: "REQUEST" } },
  { itemUid: "b", payload: { commandId: "0x03", direction: "RESPONSE" } },
], " 0x03 ", "a");
const siblingOk = siblings.length === 1 && siblings[0].itemUid === "b";
if (!siblingOk) failed += 1;
console.log(`${siblingOk ? "PASS" : "FAIL"}  client: same Command ID with another direction is listed, self excluded`);

fs.mkdirSync(path.dirname(fixture), { recursive: true });
fs.writeFileSync(fixture, `${JSON.stringify(records, null, 2)}\n`);
console.log(`wrote ${records.length} payloads to ${path.relative(path.resolve(web, ".."), fixture)}`);
fs.rmSync(out, { recursive: true, force: true });
if (failed > 0) {
  console.error(`${failed} case(s) disagree with the expected verdict`);
  process.exit(1);
}
