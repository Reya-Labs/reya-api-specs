# Unknown order-outcome semantics across peer venues

Research date: 2026-08-06  
Scope: public spot/perpetual order-placement APIs for Binance, Kraken,
Hyperliquid, Lighter, and Extended

## Verdict for Reya

Keep the proposed `ORDER_OUTCOME_UNKNOWN_ERROR` code from PRO-643, but revise
its payload, recovery state machine, and lookup support before implementation:

- require the client to retain and join the complete signed request. Treat
  echoed fields as supplemental unless the error includes recovered signer,
  market, `accountId`, `nonce`, and each operation's submitted selectors;
- treat an identical same-nonce resend as a bounded probe, not an idempotent
  result replay or proof of durable execution; and
- add a retained terminal-order lookup keyed by an attempt-unique pre-send
  identifier before describing create-order recovery as deterministic.

Binance is the only venue in this set that documents a dedicated outcome-
unknown signal. The other venues expose weaker transport errors or asynchronous
acceptance semantics and leave clients to reconcile through order streams and
lookups. All five support a caller-chosen order identifier that can anchor that
reconciliation. None documents replaying the same signed request as an
idempotent probe that returns the original result.

For Reya clients, `ORDER_OUTCOME_UNKNOWN_ERROR` should mean:

- the request passed API validation, but the API cannot prove whether the
  matching engine applied it;
- the error remains joined to the original signed request or echoes enough
  operation context to identify the intended state transition;
- while that request is still valid, clients may resend the identical bytes
  with the same nonce only under a published nonce-floor continuity guarantee
  covering any matching-engine recovery implicated by the error. Only a response
  with an explicit nonce-stage guarantee can resolve the probe; generic API/ME
  errors and another transport ambiguity do not resolve the original outcome;
- `INVALID_NONCE_ERROR` means only that the matching engine's observed nonce
  floor is already at or above the submitted nonce. Attribute that floor to the
  original attempt only when the nonce was known fresh before send and traffic
  for the signer was exclusively serialized; and
- an invalid-nonce or repeated-ambiguity result requires state reconciliation.
  Never submit a replacement with a fresh nonce while the outcome remains
  unresolved.

For create order, `clientOrderId` is the intended caller correlation tag, not
yet a durable terminal lookup key or lifetime idempotency key. Clients should
assign a non-zero value and keep it unique for their full reconciliation window.
Modify cannot assign a new `clientOrderId`: it is the lookup key when `orderId`
is absent, and otherwise restates the existing order's immutable client ID in
the signed full-order context. Cancel may use it as an existing-order selector;
cancel-all and cancel-all-after do not carry it. Every operation therefore needs
an attempt-specific reconciliation key containing the recovered signer/account,
operation, signed-request hash, nonce, and applicable market scope; create can
also include `clientOrderId`. A retained lookup must define that key's namespace,
propagation/finality point, retention window, and reuse rules. Until then,
clients should persist the complete signed request.

## Comparison

“Not documented” below means the reviewed public documentation makes no such
contract; it does not claim that the venue's implementation lacks the behavior.
Likewise, an absent lookup result is not treated as proof of non-execution unless
the venue documents propagation and finality guarantees.

| Venue | Exact unknown/ambiguous signal | Fields in the error/ack | Documented or defensible client recipe | Same-request idempotency probe |
| --- | --- | --- | --- | --- |
| Binance | `-1007 TIMEOUT`: “Send status unknown; execution status unknown.” HTTP `5XX` responses can also have an unknown execution state. | The timeout format documents only `code` and `msg`; it does not echo the submitted `newClientOrderId`, signing `timestamp`, or an order ID. | Retain `symbol + newClientOrderId`; consume the User Data Stream, then query order status with `origClientOrderId`. This is the only explicit unknown-outcome recipe in the set. | No. `newClientOrderId` is unique only among open orders and may be reused after fill, so repeating placement can create a second order. |
| Kraken | No placement-specific unknown-outcome code. `EService:Unavailable`, `EService:Busy`, `EGeneral:Internal error`, and non-JSON gateway errors are temporary/degraded-service signals without placement-finality semantics. | REST `AddOrder` success returns a venue `txid`; the reviewed error contract does not echo `nonce`, `cl_ord_id`, a request ID, or a server timestamp. | Persist a unique `cl_ord_id`; reconcile both open and closed orders using its filters before considering another placement. This is an inference from the available lookup surfaces, not Kraken's generic retry advice. | No. Nonces must increase, and `cl_ord_id` uniqueness is guaranteed only across open orders. A completed first order can therefore escape duplicate protection. |
| Hyperliquid | No documented outcome-unknown code. Semantic placement failures are per-order string errors in an otherwise successful exchange response. | A successful or rejected item can carry order status/error information; no dedicated ambiguous error with echoed request identifiers is documented. | Assign a 128-bit `cloid`; query `orderStatus` by that ID and consume `orderUpdates`. `unknownOid` has no documented propagation/finality window, so it is not by itself conclusive. | No. Transaction nonces are anti-replay while retained and must not be reused; API-wallet nonce state can be pruned after deregistration, expiry, or loss of funds on the registering account. Same-`cloid` replay is not documented as idempotent. |
| Lighter | Two-stage acceptance is explicit: `code=200` does not guarantee execution because the sequencer may still reject. Generic `29501 process timeout` and `29500 internal server error` have no documented enqueue/finality semantics. | A successful `sendTx` returns `tx_hash`; orders and streams expose `client_order_index`, venue order index, nonce, and status. The generic errors do not document these as echoed fields. | Assign a globally unique `client_order_index`; monitor WebSocket order updates and query `/accountOrders` by that index. If a `tx_hash` was received, query `/tx` for its status. `/accountOrders` supports the last 10,000 active orders without a time limit, or the last 1,000 inactive orders from 24 hours; negative lookups have no documented finality. | No. `21728 client order index already exists` detects some duplicates, but the docs do not promise replay returns the original result; `21104 invalid nonce` rejects nonce reuse. |
| Extended | No dedicated outcome-unknown code. REST placement is asynchronous: an accepted request can later be rejected or cancelled by the matching engine. Generic `500 InternalServerError` / `1006 UnhandledError` do not define placement finality. | Placement success returns Extended's order ID and the caller's `externalId`; the generic errors do not document either ID or the request nonce as echoed. | Persist the caller-assigned order `id`, returned as `externalId`; consume account WebSocket updates and query `/api/v1/user/orders/external/{externalId}` for current status and `statusReason`. | No. `1134 DuplicateOrder` is documented, but repeating the create request is not promised to return the original result or be a safe status probe. |

## Venue evidence

### Binance

The Spot REST general information and error-code references define `-1007
TIMEOUT` and warn that some `5XX` responses can represent an unknown execution
state. The documented recovery sequence is User Data Stream first, then an API
status query. New-order placement accepts `newClientOrderId`; order status
accepts the same value as `origClientOrderId`. The identifier's uniqueness is
limited to open orders, and the same ID may be accepted again after the earlier
order fills.

Sources: [REST general information](https://developers.binance.com/en/docs/products/spot/rest-api),
[error codes](https://developers.binance.com/en/docs/products/spot/errors),
[trade endpoints](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/trade),
[account/order-query endpoints](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account).

### Kraken

Kraken documents service, internal, and gateway failures, but not whether an
affected `AddOrder` reached the engine. Its generic suggestion to retry temporary
failures is not a placement-specific idempotency guarantee. `cl_ord_id` is
client-assigned and queryable on both open and closed order endpoints, but is
unique only across open orders. `userref` is non-unique. REST private calls
require strictly increasing nonces, so replaying a consumed nonce is invalid.

Sources: [API error messages](https://support.kraken.com/articles/360001491786-api-error-messages),
[`AddOrder`](https://docs.kraken.com/api-reference/trading/add-order),
[`cl_ord_id` guide](https://docs.kraken.com/exchange/guides/general/clordid),
[open orders](https://docs.kraken.com/api-reference/account-data/get-open-orders),
[closed orders](https://docs.kraken.com/api-reference/account-data/get-closed-orders),
[nonce semantics](https://support.kraken.com/articles/360001148063-why-am-i-getting-invalid-nonce-errors-).

Kraken WebSocket v2 does echo `req_id` and `cl_ord_id` in its response, but
`req_id` is request/acknowledgement correlation, not a documented durable lookup
or idempotency key. Source: [WebSocket v2 add order](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/add_order).

### Hyperliquid

Hyperliquid's exchange response distinguishes resting, filled, and semantic
error results, but its error reference does not define a transport-level
outcome-unknown state. A caller can assign `cloid`, query status by it, and
receive it on `orderUpdates`. A status miss returns `unknownOid`; the docs do not
give that negative result a conclusive propagation or retention window.
Transaction nonces are anti-replay while their state is retained and must not be
reused. The docs warn that API-wallet nonce state may be pruned after wallet
deregistration/expiry or when the registering account no longer has funds,
after which previously signed actions can become replayable.

Sources: [exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint),
[error responses](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/error-responses),
[order-status query](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-order-status-by-oid-or-cloid),
[WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions),
[nonce rules](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets).

### Lighter

Lighter explicitly separates API acceptance from sequencer execution. Its
caller-generated `client_order_index` can be used to query orders, while a
returned `tx_hash` can be used for transaction-status lookup. It documents
duplicate client-index, invalid-nonce, process-timeout, internal-server, and
transaction-not-found errors, but does not turn any replay or negative lookup
into a conclusive unknown-outcome protocol. `/accountOrders` supports the last
10,000 active orders without a time limit, or the last 1,000 inactive orders
from the preceding 24 hours.

Sources: [trading semantics](https://apidocs.lighter.xyz/docs/trading),
[getting started](https://apidocs.lighter.xyz/docs/get-started),
[errors and statuses](https://apidocs.lighter.xyz/docs/data-structures-constants-and-errors),
[`accountOrders`](https://apidocs.lighter.xyz/reference/accountorders),
[`sendTx`](https://apidocs.lighter.xyz/reference/sendtx),
[`tx`](https://apidocs.lighter.xyz/reference/tx).

### Extended

Extended documents order creation as asynchronous: the initial REST response
means the request was accepted by the REST API, not that the matching engine
will execute it. The mandatory caller-assigned order `id` is exposed as
`externalId`, can be used in a direct order lookup, and is present on account
order updates. Generic server/unhandled failures do not specify whether the
order was accepted, and the duplicate-order code is not documented as an
idempotent replay receipt. Extended also documents limited archival for final
zero-fill orders (seven days for regular accounts, none for high-volume
accounts), without stating whether the direct external-ID lookup has a different
retention guarantee.

Sources: [asynchronous lifecycle](https://api.docs.extended.exchange/#introduction),
[create/edit order](https://api.docs.extended.exchange/#create-or-edit-order),
[lookup by external ID](https://api.docs.extended.exchange/#get-orders-by-external-id),
[error responses](https://api.docs.extended.exchange/#error-responses),
[retention limits](https://api.docs.extended.exchange/#rate-limits).

## Implications for PRO-643

[PRO-643](https://linear.app/reya-labs/issue/PRO-643/perpob-machine-readable-outcome-unknown-wire-code-for-order-entry)
remained in Backlog on 2026-08-06, and its planned code was absent from the
[pinned API-spec base](https://github.com/Reya-Labs/reya-api-specs/blob/02e1987d091c5be87431aa2a999db4f75517db00/trading-schemas.json#L49-L88).
The ticket's conditional follow-up for an already-shipped design is therefore
not triggered. When PRO-643 is implemented:

1. Preserve the distinct `ORDER_OUTCOME_UNKNOWN_ERROR` code. It gives Reya
   clients a branchable contract that four of the five peers leave implicit.
2. Require callers to retain the complete signed request and keep echoing the
   WebSocket envelope `id`. `nonce`, `accountId`, and submitted selectors are
   useful supplemental fields, but are not a self-contained tuple: order/client
   IDs are market-scoped and nonces are signer-scoped. A standalone error must
   also echo the recovered signer and relevant market scope (`symbol` or
   `marketId`, including an optional mass-cancel symbol), plus
   cancel-all-after `timeoutMs` where applicable.
3. State explicitly that matching-engine execution may have succeeded.
4. Permit an identical same-nonce resend only as a bounded probe while the
   signed request remains valid and the server guarantees nonce-floor continuity
   across any relevant matching-engine recovery. A response with an explicit
   nonce-stage contract can establish probe attribution and retry eligibility,
   but it does not identify the terminal operation result or recover response-only
   fields. Resolve the original operation outcome only through a complete result
   receipt or an authoritative operation lookup. Current generic deadline,
   permission, risk, and business errors carry no nonce-stage guarantee.
5. Default to one probe attempt: one identical same-nonce resend. If a future
   contract publishes a larger finite probe budget, additional retries must be
   limited to explicitly classified transient transport or availability failures
   known to occur before the nonce gate. Do not retry deadline, permission, risk,
   business, or other deterministic errors. Outcome-unknown, an error without an
   authoritative nonce-stage guarantee, exhaustion of the probe budget, or
   expiry keeps the operation unresolved and requires reconciliation/escalation;
   clients must not advance the nonce.
6. For a known-valid, non-zero same-nonce probe, define
   `INVALID_NONCE_ERROR` narrowly: the matching engine's observed floor is
   already at or above the submitted nonce. Attribute that to the original only
   when the nonce was known fresh before send and all signer traffic was
   exclusively serialized. Map the matching engine's `MISSING_NONCE` to an input
   validation code instead of collapsing it into the same wire error. Do not
   describe invalid nonce as proof of on-disk durability.
7. After an unresolved probe, reconcile the operation's state before sending a
   fresh nonce. For create, open orders and current execution rows are supporting
   evidence only: execution rows cannot be queried by `clientOrderId`, and an
   absent open order is not authoritative for an immediately terminal order.
8. Add a retained terminal create-result lookup under an attempt-unique
   namespace, such as signer/account + `clientOrderId` + nonce (or request hash),
   with explicit propagation/finality, retention, duplicate, and reuse rules.
   It must return every field needed to reconstruct the create response,
   including the IOC fill range, or be paired with a retained fill lookup under
   the same attempt key. Define complete response fields and state transitions
   for every other operation-specific lookup: modify needs the complete
   modification result (including immediate-fill and cancellation fields), and
   cancel needs its order identity and terminal status. Cancel-all must recover
   `cancelledCount` and provide authoritative reconciliation of the affected
   order transitions. Cancel-all-after must recover `accountId`, `timeoutMs`, and
   optional `triggerAt`, distinguish command application (arm, refresh, or
   disarm) from the later timer firing, expose authoritative timer state, and
   reconcile the affected order transitions if the timer fires.

### Remaining create-order lookup gap

The same-nonce probe samples the matching engine's current nonce floor; it does
not replay the original response, prove that the original caused the floor, or
identify the resulting order. The current API surfaces do not make every
terminal create outcome recoverable from `clientOrderId`:

- an IOC taker is not published to `orderChanges`, and the create response is
  the only place its fill range is delivered;
- wallet execution rows contain venue `orderId` values, but not
  `clientOrderId`; and
- `orderHistory` is bounded, may exclude high-throughput accounts, and is
  explicitly not intended for market-maker reconciliation.

PRO-643 should therefore add or depend on a retained terminal create-result
lookup under an attempt-unique key with documented propagation/finality and
retention. It must return the IOC fill range and every other response-only field
needed to reconstruct the create result, or be paired with a retained fill
lookup under the same key. Until then, `INVALID_NONCE_ERROR` plus an absent open
order can still leave an immediately filled/cancelled create ambiguous. This gap
is specific to Reya's current surfaces; the peer comparison shows why
negative-lookup finality must be specified rather than inferred.

Sources: [current order-history scope](https://github.com/Reya-Labs/reya-api-specs/blob/02e1987d091c5be87431aa2a999db4f75517db00/openapi-trading-v2.yaml#L495-L526),
[current order and execution schemas](https://github.com/Reya-Labs/reya-api-specs/blob/02e1987d091c5be87431aa2a999db4f75517db00/trading-schemas.json#L357-L417),
[current IOC response-only fill range](https://github.com/Reya-Labs/reya-api-specs/blob/02e1987d091c5be87431aa2a999db4f75517db00/trading-schemas.json#L2450-L2484).

This recommendation differs from the original PRO-643 text because nonce
ownership has moved from the API's Redis layer to the matching engine. That
makes an identical same-nonce resend a useful probe, but not the conclusive
durability receipt described by the current PRO-608 branch documentation:

- API deadline and permission checks run before the request reaches the
  matching engine, and the matching engine has additional pre-nonce gates;
- the inspected matching-engine head flushes each WAL frame to the OS page
  cache, while `fdatasync` is periodic; and
- the in-memory nonce floor is advanced after WAL append, without gating the
  client response on a durable-on-disk watermark.

The recovery contract must therefore distinguish pre- versus post-nonce
responses and must not equate `INVALID_NONCE_ERROR` with host/power-loss
durability unless the matching engine exposes a genuine durable receipt.

Sources: [current API nonce ownership and prechecks](https://github.com/Reya-Labs/reya-off-chain-monorepo/blob/2af1a2d2eced41a6c4379c9051542d9d3cb26295/packages/common-backend/src/trade-handlers/validate-permissions.ts#L15-L24),
[current PRO-608 retry text](https://github.com/Reya-Labs/reya-off-chain-monorepo/blob/fc4d462c38b3aa407d437db49047173260a054bb/packages/common-backend/src/tcp/README.md#L45-L90),
[current wire mapping](https://github.com/Reya-Labs/reya-off-chain-monorepo/blob/fc4d462c38b3aa407d437db49047173260a054bb/packages/common-backend/src/trade-handlers/map-me-transport-error.ts#L27-L42),
[current ME nonce-code mapping](https://github.com/Reya-Labs/reya-off-chain-monorepo/blob/fc4d462c38b3aa407d437db49047173260a054bb/packages/common-backend/src/trade-handlers/me-error.ts#L1-L18),
[matching-engine nonce, append, and response order](https://github.com/Reya-Labs/reya-chain/blob/694f5670e7dc6316fa6be52adf5926a22cefe2f8/crates/matching-engine/src/threads/reactor/reactor.rs#L1700-L1901),
[WAL page-cache flush versus `fdatasync`](https://github.com/Reya-Labs/reya-chain/blob/694f5670e7dc6316fa6be52adf5926a22cefe2f8/crates/matching-engine/src/base/persistence/wal.rs#L126-L162),
[periodic WAL sync loop](https://github.com/Reya-Labs/reya-chain/blob/694f5670e7dc6316fa6be52adf5926a22cefe2f8/crates/matching-engine/src/threads/disk_writer/disk_writer.rs#L270-L326),
[frame flush implementation](https://github.com/Reya-Labs/reya-chain/blob/694f5670e7dc6316fa6be52adf5926a22cefe2f8/crates/matching-engine/src/base/persistence/framing.rs#L65-L83).
