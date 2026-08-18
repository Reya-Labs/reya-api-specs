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

const paginationMeta = tradingSchemas.definitions.PaginationMeta.properties;
assert.ok(
  paginationMeta.startTime.example > paginationMeta.endTime.example,
  'PaginationMeta examples must show newest-first ordering',
);

const depth = tradingSchemas.definitions.Depth;
assert.deepEqual(
  depth.required,
  ['symbol', 'type', 'bids', 'asks', 'updatedAt'],
  'Deprecated Depth must preserve its legacy source-compatible shape',
);
assert.equal(depth.deprecated, true);
assert.equal(depth.properties.type.$ref, '#/definitions/DepthType');
assert.equal(depth.properties.bids.maxItems, undefined);
assert.equal(depth.properties.asks.maxItems, undefined);
const depthSnapshot = tradingSchemas.definitions.DepthSnapshot.allOf[1];
const depthUpdate = tradingSchemas.definitions.DepthUpdate.allOf[1];
const depthUpdateConstraint =
  tradingSchemas.definitions.DepthUpdate.allOf[2];
assert.equal(
  tradingSchemas.definitions.DepthSnapshot.additionalProperties,
  true,
  'DepthSnapshot must expose extensions in generated REST clients',
);
assert.equal(
  tradingSchemas.definitions.DepthUpdate.additionalProperties,
  true,
  'DepthUpdate must expose extensions in generated WebSocket clients',
);
assert.deepEqual(
  tradingSchemas.definitions.DepthBase.required,
  ['symbol', 'updatedAt'],
  'DepthBase must not widen variant discriminators or side constraints during code generation',
);
assert.deepEqual(depthSnapshot.required, ['type', 'bids', 'asks']);
assert.deepEqual(depthUpdate.required, ['type', 'bids', 'asks']);
assert.equal(
  depthSnapshot.properties.type.$ref,
  '#/definitions/DepthSnapshotType',
);
assert.equal(
  depthUpdate.properties.type.$ref,
  '#/definitions/DepthUpdateType',
);
assert.deepEqual(tradingSchemas.definitions.DepthSnapshotType.enum, ['SNAPSHOT']);
assert.deepEqual(tradingSchemas.definitions.DepthUpdateType.enum, ['UPDATE']);
assert.deepEqual(
  depthUpdateConstraint.anyOf,
  [
    { properties: { bids: { minItems: 1 } } },
    { properties: { asks: { minItems: 1 } } },
  ],
  'DepthUpdate must require at least one changed side',
);
const acceptsDepthUpdateSides = (bids, asks) =>
  depthUpdateConstraint.anyOf.some(({ properties }) =>
    Object.entries(properties).every(
      ([side, constraint]) =>
        ({ bids, asks })[side].length >= constraint.minItems,
    ),
  );
assert.equal(
  acceptsDepthUpdateSides([], []),
  false,
  'DepthUpdate must reject a no-op with both sides empty',
);
assert.equal(acceptsDepthUpdateSides([{ px: '1', qty: '1' }], []), true);
assert.equal(acceptsDepthUpdateSides([], [{ px: '1', qty: '1' }]), true);
for (const side of ['bids', 'asks']) {
  assert.equal(
    depthSnapshot.properties[side].maxItems,
    1000,
    `DepthSnapshot.${side} must be capped at 1,000 levels`,
  );
  assert.equal(
    depthUpdate.properties[side].maxItems,
    undefined,
    `DepthUpdate.${side} must allow a boundary transition larger than the WebSocket view`,
  );
  assert.equal(
    depthUpdate.properties[side].minItems,
    undefined,
    `DepthUpdate.${side} must allow an empty unchanged-side diff`,
  );
}

assert.ok(
  openApi.includes('url: https://api-devnet.reya-cronos.network/v2'),
  'OpenAPI must include the current devnet server',
);
const asyncExecSpecOperation = yamlBlock(openApi, '  /asyncapi-exec-spec.yaml:');
assert.ok(asyncExecSpecOperation.includes('operationId: getAsyncExecApiSpec'));
assert.ok(asyncExecSpecOperation.includes('application/yaml:'));
const marketDepthOperation = yamlBlock(openApi, '  /market/{symbol}/depth:');
assert.ok(
  marketDepthOperation.includes("$ref: '#/components/schemas/DepthSnapshot'"),
  'REST market depth must return the bounded snapshot variant',
);
for (const compatibilitySchema of ['Depth', 'DepthType']) {
  const schema = yamlBlock(openApi, `    ${compatibilitySchema}:`);
  assert.ok(
    schema.includes(
      `$ref: './trading-schemas.json#/definitions/${compatibilitySchema}'`,
    ),
    `OpenAPI must retain the ${compatibilitySchema} SDK compatibility export`,
  );
}

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
const executionTypeParamRefLine =
  /^([ ]*)-[ ]+\$ref:[ ]*(['"])#\/components\/parameters\/ExecutionTypeParam\2(?:[ ]+#.*)?[ ]*$/gm;
const countActiveExecutionTypeParamRefs = (source, expectedIndent) =>
  Array.from(
    source.matchAll(executionTypeParamRefLine),
    (match) => match[1].length,
  ).filter(
    (indent) => expectedIndent === undefined || indent === expectedIndent,
  ).length;
const executionTypeFilterOperations = [
  '  /market/{symbol}/perpExecutions:',
  '  /wallet/{address}/perpExecutions:',
];
for (const operationHeading of executionTypeFilterOperations) {
  const pathItem = yamlBlock(openApi, operationHeading);
  const getOperation = yamlBlock(pathItem, '    get:');
  const parameters = yamlBlock(getOperation, '      parameters:');
  assert.equal(
    countActiveExecutionTypeParamRefs(parameters, 8),
    1,
    `${operationHeading.trim()} GET parameters must expose ExecutionTypeParam exactly once`,
  );
}
assert.equal(
  countActiveExecutionTypeParamRefs(openApi),
  executionTypeFilterOperations.length,
  'ExecutionTypeParam must not be used outside the market and wallet perp execution GET operations',
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

const marketDepthChannel = yamlBlock(infoAsyncApi, '  marketDepth:');
assert.ok(
  marketDepthChannel.includes('at most the 100 highest') &&
    marketDepthChannel.includes('exact published top-100 view') &&
    marketDepthChannel.includes('100-level boundary') &&
    !marketDepthChannel.includes('1,000-level boundary'),
  'WebSocket depth must document the fixed 100-level-per-side view',
);
for (const message of ['marketDepthSubscribed:', 'marketDepthUpdate:']) {
  assert.ok(
    marketDepthChannel.includes(message),
    `Market depth channel must include ${message}`,
  );
}
const receiveMarketDepth = yamlBlock(infoAsyncApi, '  receiveMarketDepth:');
for (const messageRef of [
  '#/channels/marketDepth/messages/marketDepthSubscribed',
  '#/channels/marketDepth/messages/marketDepthUpdate',
]) {
  assert.ok(
    receiveMarketDepth.includes(messageRef),
    `receiveMarketDepth must include ${messageRef}`,
  );
}
const marketDepthSubscribedPayload = yamlBlock(
  infoAsyncApi,
  '    MarketDepthSubscribedPayload:',
);
assert.ok(
  marketDepthSubscribedPayload.includes(
    "$ref: './trading-schemas.json#/definitions/DepthSnapshot'",
  ),
  'Subscribed depth contents must use DepthSnapshot',
);
const marketDepthUpdateBody = yamlBlock(
  infoAsyncApi,
  '    MarketDepthUpdateBody:',
);
assert.ok(
  marketDepthUpdateBody.includes(
    "$ref: './trading-schemas.json#/definitions/DepthUpdate'",
  ),
  'Depth channel_data must use DepthUpdate',
);
for (const compatibilitySchema of ['Depth', 'DepthType']) {
  const schema = yamlBlock(infoAsyncApi, `    ${compatibilitySchema}:`);
  assert.ok(
    schema.includes(
      `$ref: './trading-schemas.json#/definitions/${compatibilitySchema}'`,
    ),
    `Info AsyncAPI must retain the ${compatibilitySchema} SDK compatibility export`,
  );
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
