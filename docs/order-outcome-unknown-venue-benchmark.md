# Unknown order-outcome semantics across peer venues

Research date: 2026-08-06  
Scope: public spot/perpetual order-placement APIs for Binance, Kraken,
Hyperliquid, Lighter, and Extended

## Verdict for Reya

Keep the proposed `ORDER_OUTCOME_UNKNOWN_ERROR` code from PRO-643, but revise
its payload and client recipe before implementation:

- echo a submitted target `orderId`, in addition to the proposed `nonce` and
  optional `clientOrderId`; and
- first resend the identical signed request with the same nonce, then reconcile
  state if that probe returns `INVALID_NONCE_ERROR`; and
- add a reliable terminal-order lookup keyed by `clientOrderId` (or an
  equivalent pre-send identifier) before describing create-order recovery as
  deterministic.

Binance is the only venue in this set that documents a dedicated outcome-
unknown signal. The other venues expose weaker transport errors or asynchronous
acceptance semantics and leave clients to reconcile through order streams and
lookups. All five support a caller-chosen order identifier that can anchor that
reconciliation. None documents replaying the same signed request as an
idempotent probe that returns the original result.

For Reya clients, `ORDER_OUTCOME_UNKNOWN_ERROR` should mean:

- the request passed API validation, but the API cannot prove whether the
  matching engine applied it;
- the error echoes the submitted `clientOrderId` and target `orderId` when
  present, plus the submitted signing `nonce`, so the caller can correlate it
  to retained request state;
- clients should first resend the identical signed request with the same nonce;
  a normal/business response is authoritative, while `INVALID_NONCE_ERROR`
  means the original or a later same-signer request crossed the matching
  engine's durable write-ahead-log boundary and requires reconciliation; and
- for order creation, clients should then consume order updates and reconcile
  open orders and recent executions by `clientOrderId` before deciding whether
  to send a replacement with a fresh nonce.

The durable lookup key is `clientOrderId`. The nonce is useful request
correlation, especially for operations without a client order ID, but is not a
lifetime idempotency key. It is a durable replay probe under the current PerpOB
foundation contract. Clients should assign and persist a non-zero
`clientOrderId` before sending each create request, while recognizing the
terminal-state lookup gap described below.

## Comparison

“Not documented” below means the reviewed public documentation makes no such
contract; it does not claim that the venue's implementation lacks the behavior.
Likewise, an absent lookup result is not treated as proof of non-execution unless
the venue documents propagation and finality guarantees.

| Venue | Exact unknown/ambiguous signal | Fields in the error/ack | Documented or defensible client recipe | Same-request idempotency probe |
| --- | --- | --- | --- | --- |
| Binance | `-1007 TIMEOUT`: “Send status unknown; execution status unknown.” HTTP `5XX` responses can also have an unknown execution state. | The timeout format documents only `code` and `msg`; it does not echo the submitted `newClientOrderId`, signing `timestamp`, or an order ID. | Retain `symbol + newClientOrderId`; consume the User Data Stream, then query order status with `origClientOrderId`. This is the only explicit unknown-outcome recipe in the set. | No. `newClientOrderId` is unique only among open orders and may be reused after fill, so repeating placement can create a second order. |
| Kraken | No placement-specific unknown-outcome code. `EService:Unavailable`, `EService:Busy`, `EGeneral:Internal error`, and non-JSON gateway errors are temporary/degraded-service signals without placement-finality semantics. | REST `AddOrder` success returns a venue `txid`; the reviewed error contract does not echo `nonce`, `cl_ord_id`, a request ID, or a server timestamp. | Persist a unique `cl_ord_id`; reconcile both open and closed orders using its filters before considering another placement. This is an inference from the available lookup surfaces, not Kraken's generic retry advice. | No. Nonces must increase, and `cl_ord_id` uniqueness is guaranteed only across open orders. A completed first order can therefore escape duplicate protection. |
| Hyperliquid | No documented outcome-unknown code. Semantic placement failures are per-order string errors in an otherwise successful exchange response. | A successful or rejected item can carry order status/error information; no dedicated ambiguous error with echoed request identifiers is documented. | Assign a 128-bit `cloid`; query `orderStatus` by that ID and consume `orderUpdates`. `unknownOid` has no documented propagation/finality window, so it is not by itself conclusive. | No. Transaction nonces are anti-replay and must never be reused; same-`cloid` replay behavior is not documented as idempotent. |
| Lighter | Two-stage acceptance is explicit: `code=200` does not guarantee execution because the sequencer may still reject. Generic `29501 process timeout` and `29500 internal server error` have no documented enqueue/finality semantics. | A successful `sendTx` returns `tx_hash`; orders and streams expose `client_order_index`, venue order index, nonce, and status. The generic errors do not document these as echoed fields. | Assign a globally unique `client_order_index`; monitor WebSocket order updates and query `/accountOrders` by that index. If a `tx_hash` was received, query `/tx` for its status. Negative lookups have no documented finality window. | No. `21728 client order index already exists` detects some duplicates, but the docs do not promise replay returns the original result; `21104 invalid nonce` rejects nonce reuse. |
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
Transaction nonces are anti-replay and must not be reused.

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
into a conclusive unknown-outcome protocol.

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
idempotent replay receipt.

Sources: [asynchronous lifecycle](https://api.docs.extended.exchange/#introduction),
[create/edit order](https://api.docs.extended.exchange/#create-or-edit-order),
[lookup by external ID](https://api.docs.extended.exchange/#get-orders-by-external-id),
[error responses](https://api.docs.extended.exchange/#error-responses).

## Implications for PRO-643

PRO-643 was still in Backlog and had no implementation PR when checked on
2026-08-06, so PRO-787 does not require the ticket's conditional follow-up for a
shipped design. When PRO-643 is implemented:

1. Preserve the distinct `ORDER_OUTCOME_UNKNOWN_ERROR` code. It gives Reya
   clients a branchable contract that four of the five peers leave implicit.
2. Echo `clientOrderId` when submitted and always echo the request nonce. Do not
   present the nonce as an order lookup or lifetime idempotency key.
3. Also echo a submitted target `orderId`. Cancel and modify requests can target
   solely by `orderId`, so `nonce + optional clientOrderId` does not identify the
   affected order in every valid request. Keep echoing the WebSocket envelope
   `id` for request/response correlation.
4. State explicitly that matching-engine execution may have succeeded.
5. Tell clients to retry the identical signed request with the same nonce first.
   A normal/business response is authoritative. `INVALID_NONCE_ERROR` means a
   request from that signer crossed the matching engine's durable WAL boundary
   and requires state reconciliation. With serialized signer traffic, that
   identifies the original request; with concurrent traffic, it may identify a
   later request.
6. After an invalid-nonce probe, tell clients to reconcile order updates, open
   orders, and recent executions before creating a replacement with a fresh
   nonce. Never blind-retry an outcome-unknown operation with a fresh nonce.
7. Recommend non-zero `clientOrderId` as the primary create-order correlation
   key; operations without it need operation-specific state reconciliation.

### Remaining create-order lookup gap

The same-nonce probe establishes whether a same-signer request crossed the
matching engine's durable boundary; it does not replay the original response or
identify the resulting order. The current API surfaces do not make every
terminal create outcome recoverable from `clientOrderId`:

- an IOC taker is not published to `orderChanges`, and the create response is
  the only place its fill range is delivered;
- wallet execution rows contain venue `orderId` values, but not
  `clientOrderId`; and
- `orderHistory` is bounded, may exclude high-throughput accounts, and is
  explicitly not intended for market-maker reconciliation.

PRO-643 should therefore add or depend on a retained terminal-order status
lookup by `clientOrderId` with documented propagation/finality and retention,
or another pre-send identifier that resolves to the authoritative result. Until
then, `INVALID_NONCE_ERROR` plus an absent open order can still leave an
immediately filled/cancelled create ambiguous. This gap is specific to Reya's
current surfaces; the peer comparison shows why negative-lookup finality must be
specified rather than inferred.

Sources: [current order-history scope](https://github.com/Reya-Labs/reya-api-specs/blob/02e1987d091c5be87431aa2a999db4f75517db00/openapi-trading-v2.yaml#L495-L526),
[current order and execution schemas](https://github.com/Reya-Labs/reya-api-specs/blob/02e1987d091c5be87431aa2a999db4f75517db00/trading-schemas.json#L357-L417),
[current IOC response-only fill range](https://github.com/Reya-Labs/reya-api-specs/blob/02e1987d091c5be87431aa2a999db4f75517db00/trading-schemas.json#L2450-L2484).

This retry recommendation differs from the original PRO-643 text because nonce
ownership has since moved from the API's Redis layer to the matching engine. The
matching engine advances its per-signer nonce floor only after appending the
request to its durable WAL; the API now forwards the nonce without consuming it.
The current PRO-608 implementation branch documents the same-nonce probe.

Sources: [current nonce ownership](https://github.com/Reya-Labs/reya-off-chain-monorepo/blob/2af1a2d2eced41a6c4379c9051542d9d3cb26295/packages/common-backend/src/trade-handlers/validate-permissions.ts#L15-L24),
[current transport retry contract](https://github.com/Reya-Labs/reya-off-chain-monorepo/blob/fc4d462c38b3aa407d437db49047173260a054bb/packages/common-backend/src/tcp/README.md#L45-L90),
[current wire mapping](https://github.com/Reya-Labs/reya-off-chain-monorepo/blob/fc4d462c38b3aa407d437db49047173260a054bb/packages/common-backend/src/trade-handlers/map-me-transport-error.ts#L27-L42).
