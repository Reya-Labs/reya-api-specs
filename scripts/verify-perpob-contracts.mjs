import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tradingSchemas = JSON.parse(readFileSync('trading-schemas.json', 'utf8'));
const openApi = readFileSync('openapi-trading-v2.yaml', 'utf8');
const infoAsyncApi = readFileSync('asyncapi-trading-v2.yaml', 'utf8');
const execAsyncApi = readFileSync('asyncapi-exec-v2.yaml', 'utf8');

function yamlBlock(source, heading) {
  const lines = source.split('\n');
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `Missing YAML block: ${heading.trim()}`);
  const indent = heading.length - heading.trimStart().length;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && line.length - line.trimStart().length <= indent) break;
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

assert.equal(
  tradingSchemas.definitions.CreateOrderRequest.properties.reduceOnly.description,
  'Reduce-only intent. Required only for perp IOC orders. Omit this field for every other order class: perp GTC/GTT, STOP_LOSS/TAKE_PROFIT, and all spot orders. Sending the field, including `false`, for those order classes is rejected with `INPUT_VALIDATION_ERROR`. Omitted values map to `false` in the signed on-chain `OrderDetails.reduceOnly` field.',
);

assert.ok(
  openApi.includes('url: https://api-devnet.reya-cronos.network/v2'),
  'OpenAPI must include the current devnet server',
);
const asyncExecSpecOperation = yamlBlock(openApi, '  /asyncapi-exec-spec.yaml:');
assert.ok(asyncExecSpecOperation.includes('operationId: getAsyncExecApiSpec'));
assert.ok(asyncExecSpecOperation.includes('application/yaml:'));

const executionTypeParam = yamlBlock(openApi, '    ExecutionTypeParam:');
const executionTypeParamValues = Array.from(
  executionTypeParam.matchAll(/^\s+- ([A-Z_]+)$/gm),
  (match) => match[1],
);
assert.deepEqual(
  executionTypeParamValues,
  tradingSchemas.definitions.ExecutionType.enum,
  'ExecutionTypeParam must stay value-complete with the ExecutionType payload enum',
);

for (const expected of [
  'host: websocket-devnet.reya-cronos.network',
  'address: /v2/wallet/{address}/accounts',
  "pattern: '^/v2/wallet/0x[a-fA-F0-9]{40}/accounts$'",
  'AccountUpdatePayload:',
  'AccountUpdateData:',
]) {
  assert.ok(infoAsyncApi.includes(expected), `Info AsyncAPI must include: ${expected}`);
}

const accountUpdateData = yamlBlock(infoAsyncApi, '    AccountUpdateData:');
const accountUpdatePayload = yamlBlock(infoAsyncApi, '    AccountUpdatePayload:');
assert.ok(accountUpdatePayload.includes('additionalProperties: false'));
for (const field of ['type', 'timestamp', 'channel', 'data']) {
  assert.ok(
    accountUpdatePayload.includes(`- ${field}`),
    `AccountUpdatePayload must require: ${field}`,
  );
}
assert.ok(
  !accountUpdatePayload.includes('allOf:'),
  'AccountUpdatePayload must not compose sealed object schemas with allOf',
);
for (const [field, expectedType] of [
  ['accountId', 'type: string'],
  ['owner', "$ref: './trading-schemas.json#/definitions/Address'"],
  ['isMainPerpAccount', 'type: boolean'],
  ['isSpotAccount', 'type: boolean'],
  ['removed', 'type: boolean'],
]) {
  const fieldBlock = yamlBlock(accountUpdateData, `        ${field}:`);
  assert.ok(fieldBlock.includes(expectedType), `${field} must include: ${expectedType}`);
}

for (const field of ['mainAccountId', 'spotAccountId']) {
  const fieldBlock = yamlBlock(accountUpdateData, `        ${field}:`);
  assert.ok(fieldBlock.includes('- string'), `${field} must allow string values`);
  assert.ok(fieldBlock.includes("- 'null'"), `${field} must allow null values`);
}

assert.ok(
  execAsyncApi.includes('host: ws-exec-devnet.reya-cronos.network'),
  'Execution AsyncAPI must include the current devnet server',
);

console.log('Perp OB REST and AsyncAPI contract assertions passed.');
