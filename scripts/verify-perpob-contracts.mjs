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

// --- Rate limit v1 wire contract -------------------------------------------

for (const code of [
  'RATE_LIMITED_ERROR',
  'OPEN_ORDER_COUNT_EXCEEDED_ERROR',
  'OPEN_ORDER_NOTIONAL_EXCEEDED_ERROR',
  'CAPACITY_LIMITED_ERROR',
  'NOT_WHITELISTED_ERROR',
  'ACCOUNT_SUSPENDED_ERROR',
]) {
  assert.ok(
    tradingSchemas.definitions.RequestErrorCode.enum.includes(code),
    `RequestErrorCode must keep the rate-limit v1 member: ${code}`,
  );
}

const responseStatuses = (operationId) => {
  const pathItem = yamlBlock(openApi, `  /${operationId}:`);
  const responses = yamlBlock(yamlBlock(pathItem, '    post:'), '      responses:');
  return Array.from(responses.matchAll(/^        '(\d{3})':$/gm), (match) => match[1]);
};
// Exact sets: absence is the load-bearing half. A cancel that starts declaring
// 503, or a cancelAllAfter that does, would mean risk-off traffic can be shed.
const ACCESS_AND_LIMIT_STATUSES = ['403', '429', '503'];
for (const [operationId, expectedStatuses] of [
  ['createOrder', ['403', '429', '503']],
  ['modifyOrder', ['403', '429', '503']],
  ['cancelOrder', ['429']],
  ['cancelAll', ['429']],
  // Arming or refreshing a countdown from a suspended account is refused 403;
  // disarming is not gated, and no direction is ever capacity-shed.
  ['cancelAllAfter', ['403', '429']],
]) {
  const declared = responseStatuses(operationId).filter((status) =>
    ACCESS_AND_LIMIT_STATUSES.includes(status),
  );
  assert.deepEqual(
    declared.sort(),
    [...expectedStatuses].sort(),
    `POST /v2/${operationId} must declare exactly these access/limit responses: ${expectedStatuses.join(', ')} (declares: ${declared.join(', ') || 'none'})`,
  );
}

const tooManyRequests = yamlBlock(openApi, '    TooManyRequests:');
const tooManyRequestsHeader = yamlBlock(tooManyRequests, '        Retry-After:');
assert.ok(
  tooManyRequestsHeader.includes('required: true'),
  'TooManyRequests must declare Retry-After as required',
);
assert.ok(
  tooManyRequestsHeader.includes('minimum: 1'),
  'TooManyRequests Retry-After must declare minimum: 1 (the edge never sends 0)',
);
const serviceUnavailableHeader = yamlBlock(
  yamlBlock(openApi, '    ServiceUnavailable:'),
  '        Retry-After:',
);
assert.ok(
  serviceUnavailableHeader.includes('required: false'),
  'ServiceUnavailable must declare Retry-After as optional',
);

const retryAfterMs = tradingSchemas.definitions.RequestError.properties.retryAfterMs;
assert.ok(retryAfterMs, 'RequestError must carry retryAfterMs');
assert.equal(retryAfterMs.type, 'integer', 'RequestError.retryAfterMs must be an integer');
assert.equal(
  retryAfterMs.minimum,
  1,
  'RequestError.retryAfterMs must declare minimum: 1 — a zero hint is collapsed to omission',
);

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
  ['1012', 'feed resync'],
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

console.log('Perp OB REST and AsyncAPI contract assertions passed.');
