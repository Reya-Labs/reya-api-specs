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
  'address: /v2/wallet/{address}/accounts',
  "pattern: '^/v2/wallet/0x[a-fA-F0-9]{40}/accounts$'",
  'AccountUpdatePayload:',
  'AccountUpdateData:',
]) {
  assert.ok(infoAsyncApi.includes(expected), `Info AsyncAPI must include: ${expected}`);
}

const marketDepthChannel = yamlBlock(infoAsyncApi, '  marketDepth:');
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
    "$ref: '#/components/schemas/WebSocketDepthSnapshot'",
  ),
  'Subscribed depth contents must use the WebSocket-specific snapshot',
);
const webSocketDepthSnapshot = yamlBlock(
  infoAsyncApi,
  '    WebSocketDepthSnapshot:',
);
assert.ok(
  webSocketDepthSnapshot.includes('title: DepthSnapshot'),
  'WebSocket depth snapshot must retain the existing SDK export name',
);
assert.ok(
  webSocketDepthSnapshot.includes(
    "$ref: './trading-schemas.json#/definitions/DepthSnapshot'",
  ),
  'WebSocket depth snapshot must retain the shared snapshot fields',
);
for (const side of ['bids', 'asks']) {
  const sideSchema = yamlBlock(
    webSocketDepthSnapshot,
    `            ${side}:`,
  );
  assert.ok(
    sideSchema.includes('maxItems: 100'),
    `WebSocket depth snapshot ${side} must be capped at 100 levels`,
  );
}
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

// --- Rate limit v1 wire contract: 400-only venue verdicts ------------------

const requestErrorCodes = tradingSchemas.definitions.RequestErrorCode.enum;
for (const code of [
  'RATE_LIMITED_ERROR',
  'OPEN_ORDER_COUNT_EXCEEDED_ERROR',
  'OPEN_ORDER_NOTIONAL_EXCEEDED_ERROR',
  'CAPACITY_LIMITED_ERROR',
  'NOT_WHITELISTED_ERROR',
  'ACCOUNT_SUSPENDED_ERROR',
  'SERVICE_UNAVAILABLE_ERROR',
  'ORDER_OUTCOME_UNKNOWN_ERROR',
]) {
  assert.ok(
    requestErrorCodes.includes(code),
    `RequestErrorCode must publish ${code}`,
  );
}
const responseStatuses = (operationId) => {
  const pathItem = yamlBlock(openApi, `  /${operationId}:`);
  const responses = yamlBlock(yamlBlock(pathItem, '    post:'), '      responses:');
  return Array.from(responses.matchAll(/^        '(\d{3})':$/gm), (match) => match[1]);
};
const ORDER_ENTRY_OPERATIONS = [
  'createOrder',
  'modifyOrder',
  'cancelOrder',
  'cancelAll',
  'cancelAllAfter',
];
// The venue answers every verdict on 400 and puts the reason in the body's
// `error` code. A reintroduced 429/503/403 would split one contract across two
// signals and desynchronise REST from the order-entry WebSocket envelope.
const VENUE_VERDICT_STATUSES = ['403', '429', '503'];
for (const operationId of ORDER_ENTRY_OPERATIONS) {
  const declared = responseStatuses(operationId);
  const forbidden = declared.filter((status) => VENUE_VERDICT_STATUSES.includes(status));
  assert.deepEqual(
    forbidden,
    [],
    `POST /v2/${operationId} must not declare a venue-verdict status: rate limits, capacity shedding, suspension and whitelist refusals are all 400 with the RequestErrorCode in the body (declares: ${forbidden.join(', ')})`,
  );
  assert.ok(
    declared.includes('400'),
    `POST /v2/${operationId} must declare the 400 that carries every venue verdict`,
  );
}

const retryAfterMs = tradingSchemas.definitions.RequestError.properties.retryAfterMs;
assert.ok(retryAfterMs, 'RequestError must carry retryAfterMs');
assert.equal(retryAfterMs.type, 'integer', 'RequestError.retryAfterMs must be an integer');
assert.equal(
  retryAfterMs.minimum,
  1,
  'RequestError.retryAfterMs must declare minimum: 1 — a zero hint is collapsed to omission',
);

const badRequest = yamlBlock(openApi, '    BadRequest:');
for (const code of [
  'RATE_LIMITED_ERROR',
  'CAPACITY_LIMITED_ERROR',
  'NOT_WHITELISTED_ERROR',
  'ACCOUNT_SUSPENDED_ERROR',
  'SERVICE_UNAVAILABLE_ERROR',
  'ORDER_OUTCOME_UNKNOWN_ERROR',
  'retryAfterMs',
]) {
  assert.ok(
    badRequest.includes(code),
    `components.responses.BadRequest must document ${code}: it is the only response the venue verdicts arrive on`,
  );
}

for (const [name, source] of [
  ['Execution AsyncAPI', execAsyncApi],
  ['Info AsyncAPI', infoAsyncApi],
]) {
  const info = yamlBlock(source, 'info:');
  assert.ok(info.includes('4029'), `${name} info description must document close code 4029`);
  assert.ok(
    info.includes('MSG_RATE_EXCEEDED retry_after_ms='),
    `${name} info description must document the 4029 close reason grammar verbatim`,
  );
}

// PRO-643: all five REST/WS operations share the same transport-outcome contract.
for (const operation of ['CreateOrder', 'ModifyOrder', 'CancelOrder', 'CancelAll', 'CancelAllAfter']) {
  const response = yamlBlock(execAsyncApi, `    ${operation}ResponseMessagePayload:`);
  assert.ok(
    response.includes("$ref: './trading-schemas.json#/definitions/RequestError'"),
    `${operation}ResponseMessagePayload must carry RequestError`,
  );
}

// ── SL/TP firing (3.1.0) ────────────────────────────────────────────────────
// These properties are load-bearing and individually droppable: an auto-merge
// of trading-schemas.json that loses one regenerates an SDK without the field,
// with nothing else going red. Pin them by name.
assert.ok(
  tradingSchemas.definitions.Order.properties.triggered,
  'Order.triggered is the armed-vs-fired discriminator and must stay published',
);
assert.ok(
  tradingSchemas.definitions.CreateOrderRequest.required.includes('timeInForce'),
  'timeInForce is REQUIRED on every create from 3.1.0 — a trigger may no longer imply GTC',
);
for (const reason of [
  'OCO_SIBLING_FIRED',
  'PROTECTIVE_SELF_TRADE_SWEEP',
  'POSITION_CLOSED',
  'RISK_REJECTED',
]) {
  assert.ok(
    tradingSchemas.definitions.CancelReason.enum.includes(reason),
    `CancelReason must publish ${reason} — the firing engine emits it`,
  );
}
for (const code of ['TRIGGER_IOC_MUST_NOT_EXPIRE_ERROR', 'TRIGGER_LIMIT_OUTSIDE_BAND_ERROR']) {
  assert.ok(
    tradingSchemas.definitions.RequestErrorCode.enum.includes(code),
    `RequestErrorCode must publish ${code}`,
  );
}

console.log('Perp OB REST and AsyncAPI contract assertions passed.');
