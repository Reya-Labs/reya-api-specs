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

assert.ok(
  execAsyncApi.includes('host: ws-exec-devnet.reya-cronos.network'),
  'Execution AsyncAPI must include the current devnet server',
);

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
]) {
  assert.ok(
    requestErrorCodes.includes(code),
    `RequestErrorCode must keep the rate-limit v1 member: ${code}`,
  );
}
assert.ok(
  !requestErrorCodes.includes('OPEN_ORDER_CAP_ERROR'),
  'OPEN_ORDER_CAP_ERROR belonged to the removed legacy TypeScript limiter and is emitted nowhere; the matching engine returns OPEN_ORDER_COUNT_EXCEEDED_ERROR / OPEN_ORDER_NOTIONAL_EXCEEDED_ERROR instead',
);

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

for (const orphan of ['Forbidden', 'TooManyRequests', 'ServiceUnavailable']) {
  assert.ok(
    !openApi.includes(`\n    ${orphan}:\n`),
    `components.responses.${orphan} must be gone: nothing references it once venue verdicts are 400-only`,
  );
}
assert.ok(
  !openApi.includes('Retry-After'),
  'Trading OpenAPI must not declare a Retry-After header: the retry hint travels in the body as retryAfterMs',
);
assert.ok(
  !JSON.stringify(tradingSchemas).includes('Retry-After'),
  'trading-schemas.json must not mention a Retry-After header: the retry hint travels in the body as retryAfterMs',
);

const retryAfterMs = tradingSchemas.definitions.RequestError.properties.retryAfterMs;
assert.ok(retryAfterMs, 'RequestError must carry retryAfterMs');
assert.equal(retryAfterMs.type, 'integer', 'RequestError.retryAfterMs must be an integer');
assert.equal(
  retryAfterMs.minimum,
  1,
  'RequestError.retryAfterMs must declare minimum: 1 — a zero hint is collapsed to omission',
);

const badRequest = yamlBlock(openApi, '    BadRequest:');
// Per-code guidance lives in the multiline REST response reference.
const requestErrorCodeDoc = badRequest.replace(/\s+/g, ' ');
for (const phrase of [
  'HTTP 429 is reserved for infrastructure-level (per-IP) limits in front of the API and is never a venue verdict',
  '`SERVICE_UNAVAILABLE_ERROR`: the request was not accepted',
  're-sign with a fresh nonce for `SERVICE_UNAVAILABLE_ERROR`; reconcile first for `ORDER_OUTCOME_UNKNOWN_ERROR`',
  'It carries no retry hint; use backoff with jitter',
  'never replace an unresolved attempt with a fresh nonce',
  'retry `RATE_LIMITED_ERROR` after at least `retryAfterMs`',
  'retry `CAPACITY_LIMITED_ERROR` using backoff with jitter',
  'Permission errors such as `NOT_WHITELISTED_ERROR` and `ACCOUNT_SUSPENDED_ERROR` are not resolved by automatic retries',
]) {
  assert.ok(
    requestErrorCodeDoc.includes(phrase),
    `HTTP 400 response must retain client recovery guidance: "${phrase}"`,
  );
}

const orderEntryTag = yamlBlock(openApi, '  - name: Order Entry');
assert.ok(
  orderEntryTag.includes('**Every venue verdict is HTTP 400.**'),
  'The Order Entry tag must state the 400-only contract',
);
assert.ok(
  orderEntryTag.includes('HTTP 429 is\n      reserved for infrastructure-level (per-IP) limits in front of the API'),
  'The Order Entry tag must keep the 429 carve-out',
);
for (const code of [
  'RATE_LIMITED_ERROR',
  'CAPACITY_LIMITED_ERROR',
  'NOT_WHITELISTED_ERROR',
  'ACCOUNT_SUSPENDED_ERROR',
  'SERVICE_UNAVAILABLE_ERROR',
  'retryAfterMs',
]) {
  assert.ok(
    badRequest.includes(code),
    `components.responses.BadRequest must document ${code}: it is the only response the venue verdicts arrive on`,
  );
}

const execAsyncApiInfoBlock = yamlBlock(execAsyncApi, 'info:');
assert.ok(
  execAsyncApiInfoBlock.includes('HTTP 400 carrying the same `error` code and the same `retryAfterMs`'),
  'Execution AsyncAPI must cross-reference REST as 400-only, so the two transports cannot drift apart',
);
for (const status of ['HTTP 429 with', 'HTTP 503', 'HTTP 403']) {
  assert.ok(
    !execAsyncApiInfoBlock.includes(status),
    `Execution AsyncAPI must not cross-reference REST ${status}: venue verdicts are 400-only`,
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
// Proximity rather than two independent substring hits, so a code cannot stay
// "documented" while its reason drifts to a different close code.
const infoAsyncApiInfo = yamlBlock(infoAsyncApi, 'info:');
const BINDING_WINDOW = 200;
for (const [closeCode, boundTo] of [
  ['1013', 'slow consumer'],
  ['1012', 'fresh snapshot'],
]) {
  const token = `\`${closeCode}\``;
  let bound = false;
  for (let at = infoAsyncApiInfo.indexOf(token); at !== -1; at = infoAsyncApiInfo.indexOf(token, at + 1)) {
    if (infoAsyncApiInfo.slice(at, at + BINDING_WINDOW).includes(boundTo)) {
      bound = true;
      break;
    }
  }
  assert.ok(
    bound,
    `Info AsyncAPI must keep close code ${closeCode} bound to "${boundTo}" (within ${BINDING_WINDOW} characters of a \`${closeCode}\` mention)`,
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
assert.ok(
  !tradingSchemas.definitions.RequestErrorCode.enum.includes('TRIGGER_REQUIRES_GTC_ERROR'),
  'TRIGGER_REQUIRES_GTC_ERROR was retired in 3.1.0 — triggers now choose their own TIF',
);
assert.ok(
  !tradingSchemas.definitions.CancelReason.enum.includes('BAND_VIOLATION'),
  'BAND_VIOLATION was removed from CancelReason in 3.1.0 — the band is an admission rejection, never a cancel reason',
);

console.log('Perp OB REST and AsyncAPI contract assertions passed.');

// PRO-643: all five REST/WS operations share the same transport-outcome contract.
for (const [code, action] of [
  ['SERVICE_UNAVAILABLE_ERROR', 'fresh nonce'],
  ['ORDER_OUTCOME_UNKNOWN_ERROR', 'reconcile'],
]) {
  assert.ok(tradingSchemas.definitions.RequestErrorCode.enum.includes(code));
  // Recovery guidance is owned by the REST HTTP 400 reference, not the enum summary.
  const start = badRequest.indexOf('        - `' + code + '`:');
  assert.ok(start >= 0, `HTTP 400 reference must document ${code}`);
  const policy = badRequest.slice(start).split('\n        - ')[0].toLowerCase();
  assert.ok(policy.includes(action), `${code} must retain its ${action} recovery policy`);
  assert.ok(openApi.includes('`' + code + '`'));
}
for (const field of ['nonce', 'clientOrderId']) {
  assert.ok(!(field in tradingSchemas.definitions.RequestError.properties));
  assert.ok(!tradingSchemas.definitions.RequestError.required.includes(field));
}
for (const operation of ['CreateOrder', 'ModifyOrder', 'CancelOrder', 'CancelAll', 'CancelAllAfter']) {
  const response = yamlBlock(execAsyncApi, `    ${operation}ResponseMessagePayload:`);
  assert.ok(response.includes("$ref: './trading-schemas.json#/definitions/RequestError'"));
}
console.log('Transport-outcome error contract assertions passed.');

for (const code of ['NO_PRICES_FOUND_FOR_SYMBOL_ERROR', 'UNAVAILABLE_MATCHING_ENGINE_ERROR', 'UNAVAILABLE_ACCOUNT_OWNER_ERROR']) {
  assert.ok(!requestErrorCodes.includes(code), `Obsolete error code must not be published: ${code}`);
  assert.ok(!openApi.includes(code), `REST reference must not advertise obsolete code: ${code}`);
}

assert.ok(
  !/^\s+(nonce|clientOrderId):/m.test(badRequest),
  'HTTP 400 examples must not echo request identifiers',
);
