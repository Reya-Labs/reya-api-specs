# Reya DEX Trading WebSocket API v2 - Complete Documentation

## Table of Contents
1. [Overview](#overview)
2. [Server Endpoints](#server-endpoints)
3. [Channel Architecture](#channel-architecture)
4. [Message Structure](#message-structure)
5. [Channels Reference](#channels-reference)
6. [Data Types & Schemas](#data-types--schemas)
7. [Connection Management](#connection-management)

## Overview

The Reya DEX Trading WebSocket API v2 provides real-time streaming data for decentralized exchange operations on the Reya Network. This version offers user-friendly data structures with human-readable formats, removing blockchain-specific details while maintaining comprehensive trading functionality.

## Server Endpoints

### Production Environment
- **URL**: `wss://ws.reya.xyz`
- **Protocol**: WSS
- **Description**: Production WebSocket server for live trading

### Staging Environment
- **URL**: `wss://websocket-staging.reya.xyz`
- **Protocol**: WSS
- **Description**: Staging WebSocket server for pre-production testing

### Test Environment
- **URL**: `wss://websocket-testnet.reya.xyz`
- **Protocol**: WSS
- **Description**: Test WebSocket server for development

## Channel Architecture

The API uses a hierarchical channel structure with clear separation between different data types:

### Channel Categories

1. **Market Data Channels**
   - `/v2/markets/summary` - Perp market summaries
   - `/v2/market/{symbol}/summary` - Individual perp market summary
   - `/v2/market/{symbol}/perpExecutions` - Market-specific perpetual executions
   - `/v2/market/{symbol}/depth` - L2 order book depth snapshots, only relevant for markets using the Reya Order Book instead of the AMM
   - `/v2/market/{symbol}/spotExecutions` - Market-specific spot executions
   - `/v2/prices` - All symbol prices
   - `/v2/prices/{symbol}` - Individual symbol prices

2. **Wallet Data Channels**
   - `/v2/wallet/{address}/positions` - Position updates
   - `/v2/wallet/{address}/orderChanges` - Order change updates
   - `/v2/wallet/{address}/perpExecutions` - Wallet-specific perpetual executions
   - `/v2/wallet/{address}/spotExecutions` - Wallet-specific spot executions
   - `/v2/wallet/{address}/accountBalances` - Account balance updates

### Parameter Validation

#### Symbol Parameter
- **Pattern**: `^[A-Za-z0-9]+$`
- **Examples**: `BTCRUSDPERP`, `ETHRUSD`, `kBONKRUSDPERP`, `AI16ZRUSDPERP`
- **Description**: Trading symbol supporting alphanumeric characters

#### Address Parameter
- **Pattern**: `^0x[a-fA-F0-9]{40}$`
- **Example**: `0x6c51275fd01d5dbd2da194e92f920f8598306df2`
- **Description**: Ethereum wallet address (40 hexadecimal characters)

## Message Structure

All WebSocket messages follow a standardized envelope structure:

### Base Message Envelope
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/market/BTCRUSDPERP/summary",
  "data": { /* channel-specific data */ }
}
```

### Message Components
- **type**: Always `"channel_data"` for data updates
- **timestamp**: Server timestamp in milliseconds
- **channel**: Specific channel identifier
- **data**: Channel-specific payload (object or array)

### Heartbeat Messages

#### Ping Message (Server → Client)
```json
{
  "type": "ping",
  "timestamp": 1747927089946
}
```

#### Pong Message (Client → Server)
```json
{
  "type": "pong",
  "timestamp": 1747927089946
}
```

## Channels Reference

### 1. Market Data Channels

#### `/v2/markets/summary`
**Purpose**: Real-time updates for all market summaries

**Subscription**: 
```json
{
  "type": "subscribe",
  "channel": "/v2/markets/summary"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/markets/summary",
  "data": [
    {
      "symbol": "BTCRUSDPERP",
      "updatedAt": 1747927089946,
      "longOiQty": "154.741",
      "shortOiQty": "154.706",
      "oiQty": "154.741",
      "fundingRate": "-0.000509373441021089",
      "longFundingValue": "412142.26",
      "shortFundingValue": "412142.26",
      "fundingRateVelocity": "-0.00000006243",
      "volume24h": "917833.49891",
      "pxChange24h": "92.6272285500004",
      "throttledOraclePrice": "2666.48162040777",
      "throttledPoolPrice": "2666.48166680625",
      "pricesUpdatedAt": 1747927089597
    }
  ]
}
```

<details>
<summary><strong>Data Type - MarketSummary</strong></summary>

- `symbol` (string): Trading symbol
- `updatedAt` (integer): Last calculation timestamp (milliseconds)
- `longOiQty` (string): Long open interest in lots
- `shortOiQty` (string): Short open interest in lots
- `oiQty` (string): Total open interest quantity
- `fundingRate` (string): Current hourly funding rate
- `longFundingValue` (string): Current long funding value
- `shortFundingValue` (string): Current short funding value
- `fundingRateVelocity` (string): Funding rate velocity
- `volume24h` (string): 24-hour trading volume
- `pxChange24h` (string, optional): 24-hour price change
- `throttledOraclePrice` (string, optional): Last oracle price at summary update
- `throttledPoolPrice` (string, optional): Last pool price at summary update
- `pricesUpdatedAt` (integer, optional): Last price update timestamp

</details>

#### `/v2/market/{symbol}/summary`
**Purpose**: Real-time updates for a specific market's summary

**Parameters**:
- `symbol`: Trading symbol (e.g., `BTCRUSDPERP`, `kBONKRUSDPERP`)

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/market/BTCRUSDPERP/summary"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/market/BTCRUSDPERP/summary",
  "data": {
    "symbol": "BTCRUSDPERP",
    "updatedAt": 1747927089946,
    "longOiQty": "154.741",
    "shortOiQty": "154.706",
    "oiQty": "154.741",
    "fundingRate": "-0.000509373441021089",
    "longFundingValue": "412142.26",
    "shortFundingValue": "412142.26",
    "fundingRateVelocity": "-0.00000006243",
    "volume24h": "917833.49891",
    "pxChange24h": "92.6272285500004",
    "throttledOraclePrice": "2666.48162040777",
    "throttledPoolPrice": "2666.48166680625",
    "pricesUpdatedAt": 1747927089597
  }
}
```

<details>
<summary><strong>Data Type - MarketSummary</strong></summary>

Same as above - see `/v2/markets/summary` channel for complete field definitions.

</details>

#### `/v2/market/{symbol}/perpExecutions`
**Purpose**: Real-time perpetual executions for a specific market

**Parameters**:
- `symbol`: Trading symbol (e.g., `BTCRUSDPERP`, `AI16ZRUSDPERP`)

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/market/BTCRUSDPERP/perpExecutions"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/market/BTCRUSDPERP/perpExecutions",
  "data": [
    {
      "exchangeId": 1,
      "symbol": "BTCRUSDPERP",
      "accountId": 12345,
      "qty": "1.0",
      "side": "B",
      "price": "43000.00",
      "fee": "0.50",
      "type": "ORDER_MATCH",
      "timestamp": 1747927089946,
      "sequenceNumber": 152954
    }
  ]
}
```

<details>
<summary><strong>Data Type - PerpExecution</strong></summary>

- `exchangeId` (integer): Exchange identifier
- `symbol` (string): Trading symbol
- `accountId` (integer): Account identifier
- `qty` (string): Execution quantity
- `side` (Side): Execution side (B=Buy, A=Sell)
- `fee` (string): Execution fee
- `price` (string): Execution price
- `type` (ExecutionType): Execution type (ORDER_MATCH, LIQUIDATION, ADL)
- `timestamp` (integer): Execution timestamp (milliseconds)
- `sequenceNumber` (integer): Global sequence number

</details>

#### `/v2/prices`
**Purpose**: Real-time price updates for all symbols

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/prices"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/prices",
  "data": [
    {
      "symbol": "BTCRUSDPERP",
      "oraclePrice": "43000.00",
      "poolPrice": "42999.50",
      "updatedAt": 1747927089946
    },
    {
      "symbol": "ETHRUSDPERP",
      "oraclePrice": "2500.00",
      "poolPrice": "2499.75",
      "updatedAt": 1747927089946
    }
  ]
}
```

<details>
<summary><strong>Data Type - Price</strong></summary>

- `symbol` (string): Trading symbol
- `oraclePrice` (string): Oracle price - Price given by the Stork feeds, used both as the peg price for prices on Reya, as well as Mark Prices
- `poolPrice` (string, optional): Pool price - The price currently quoted by the AMM for zero volume
- `updatedAt` (integer): Last update timestamp (milliseconds)

</details>

#### `/v2/prices/{symbol}`
**Purpose**: Real-time price updates for a specific symbol

**Parameters**:
- `symbol`: Trading symbol (e.g., `BTCRUSDPERP`, `kBONKRUSDPERP`)

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/prices/BTCRUSDPERP"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/prices/BTCRUSDPERP",
  "data": {
    "symbol": "BTCRUSDPERP",
    "oraclePrice": "43000.00",
    "poolPrice": "42999.50",
    "updatedAt": 1747927089946
  }
}
```

<details>
<summary><strong>Data Type - Price</strong></summary>

Same as above - see `/v2/prices` channel for complete field definitions.

</details>

#### `/v2/market/{symbol}/depth`
**Purpose**: Real-time L2 order book depth snapshots for a specific market

**Parameters**:
- `symbol`: Trading symbol (e.g., `BTCRUSDPERP`, `DOGERUSDPERP`)

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/market/BTCRUSDPERP/depth"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/market/BTCRUSDPERP/depth",
  "data": {
    "symbol": "BTCRUSDPERP",
    "type": "SNAPSHOT",
    "bids": [
      { "px": "42999.50", "qty": "1.5" },
      { "px": "42998.00", "qty": "2.0" }
    ],
    "asks": [
      { "px": "43000.50", "qty": "1.0" },
      { "px": "43001.00", "qty": "3.0" }
    ],
    "updatedAt": 1747927089946
  }
}
```

<details>
<summary><strong>Data Type - Depth</strong></summary>

- `symbol` (string): Trading symbol
- `type` (DepthType): Depth message type (SNAPSHOT, UPDATE)
- `bids` (array): Bid side levels aggregated by price, sorted descending by price
  - `px` (string): Price level
  - `qty` (string): Aggregated quantity at this price level
- `asks` (array): Ask side levels aggregated by price, sorted ascending by price
  - `px` (string): Price level
  - `qty` (string): Aggregated quantity at this price level
- `updatedAt` (integer): Snapshot generation timestamp (milliseconds)

</details>

#### `/v2/market/{symbol}/spotExecutions`
**Purpose**: Real-time spot executions for a specific market

**Parameters**:
- `symbol`: Trading symbol (e.g., `ETHRUSD`, `BTCRUSD`)

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/market/ETHRUSD/spotExecutions"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/market/ETHRUSD/spotExecutions",
  "data": [
    {
      "exchangeId": 1,
      "symbol": "ETHRUSD",
      "accountId": 12345,
      "makerAccountId": 67890,
      "orderId": "63552420354981888",
      "makerOrderId": "63552420037263360",
      "qty": "1.0",
      "side": "B",
      "price": "2500.00",
      "fee": "0.0",
      "type": "ORDER_MATCH",
      "timestamp": 1747927089946
    }
  ]
}
```

<details>
<summary><strong>Data Type - SpotExecution</strong></summary>

- `exchangeId` (integer, optional): Exchange identifier
- `symbol` (string): Trading symbol
- `accountId` (integer): Account identifier (taker)
- `makerAccountId` (integer): Maker account ID (counterparty)
- `orderId` (string, optional): Order ID for the taker
- `makerOrderId` (string, optional): Order ID for the maker
- `qty` (string): Execution quantity
- `side` (Side): Execution side (B=Buy, A=Sell)
- `price` (string): Execution price
- `fee` (string): Execution fee
- `type` (ExecutionType): Execution type (ORDER_MATCH, LIQUIDATION, ADL)
- `timestamp` (integer): Execution timestamp (milliseconds)

</details>

---

### 2. Wallet Data Channels

#### `/v2/wallet/{address}/positions`
**Purpose**: Real-time position updates for a wallet

**Parameters**:
- `address`: Ethereum wallet address (e.g., `0x6c51275fd01d5dbd2da194e92f920f8598306df2`)

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/wallet/0x6c51275fd01d5dbd2da194e92f920f8598306df2/positions"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/wallet/0x6c51275fd01d5dbd2da194e92f920f8598306df2/positions",
  "data": [
    {
      "exchangeId": 1,
      "symbol": "BTCRUSDPERP",
      "accountId": 12345,
      "qty": "1.5",
      "side": "B",
      "avgEntryPrice": "43000.00",
      "avgEntryFundingValue": "100.25",
      "lastTradeSequenceNumber": 152954
    }
  ]
}
```

<details>
<summary><strong>Data Type - Position</strong></summary>

- `exchangeId` (integer): Exchange identifier
- `symbol` (string): Trading symbol
- `accountId` (integer): Account identifier
- `qty` (string): Position quantity
- `side` (Side): Position side (B=Buy, A=Sell)
- `avgEntryPrice` (string): Average entry price
- `avgEntryFundingValue` (string): Average entry funding value
- `lastTradeSequenceNumber` (integer): Last execution sequence number

</details>

#### `/v2/wallet/{address}/orderChanges`
**Purpose**: Real-time order change updates for wallet

**Parameters**:
- `address`: Ethereum wallet address

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/wallet/0x6c51275fd01d5dbd2da194e92f920f8598306df2/orderChanges"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/wallet/0x6c51275fd01d5dbd2da194e92f920f8598306df2/orderChanges",
  "data": [
    {
      "exchangeId": 1,
      "symbol": "BTCRUSDPERP",
      "accountId": 12345,
      "orderId": "123456789-123123123",
      "qty": "1.0",
      "execQty": "0.5",
      "side": "B",
      "limitPx": "43000.00",
      "orderType": "LIMIT",
      "triggerPx": "50000.0",
      "timeInForce": "GTC",
      "reduceOnly": false,
      "status": "OPEN",
      "createdAt": 1747927089946,
      "lastUpdateAt": 1747927089946
    }
  ]
}
```

<details>
<summary><strong>Data Type - Order</strong></summary>

- `exchangeId` (integer): Exchange identifier
- `symbol` (string): Trading symbol
- `accountId` (integer): Account identifier
- `side` (Side): Order side (B=Buy, A=Sell)
- `limitPx` (string): Limit price
- `orderType` (OrderType): Order type (LIMIT, TP, SL)
- `status` (OrderStatus): Order status (OPEN, FILLED, CANCELLED, REJECTED)
- `createdAt` (integer): Creation timestamp (milliseconds)
- `lastUpdateAt` (integer): Last update timestamp (milliseconds)
- `orderId` (string): Order identifier
- `qty` (string, optional): Order quantity
- `execQty` (string, optional): Executed quantity in the current order update
- `cumQty` (string, optional): Total executed quantity across all fills
- `triggerPx` (string, optional): Trigger price for TP/SL orders
- `timeInForce` (TimeInForce, optional): Time in force (IOC, GTC)
- `reduceOnly` (boolean, optional): Reduce-only flag (exclusively for LIMIT IOC orders)

</details>

#### `/v2/wallet/{address}/perpExecutions`
**Purpose**: Real-time perpetual execution updates for a wallet

**Parameters**:
- `address`: Ethereum wallet address

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/wallet/0x6c51275fd01d5dbd2da194e92f920f8598306df2/perpExecutions"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/wallet/0x6c51275fd01d5dbd2da194e92f920f8598306df2/perpExecutions",
  "data": [
    {
      "exchangeId": 1,
      "symbol": "BTCRUSDPERP",
      "accountId": 12345,
      "qty": "1.0",
      "side": "B",
      "price": "43000.00",
      "fee": "0.50",
      "type": "ORDER_MATCH",
      "timestamp": 1747927089946,
      "sequenceNumber": 152954
    }
  ]
}
```

<details>
<summary><strong>Data Type - PerpExecution</strong></summary>

Same as above - see `/v2/market/{symbol}/perpExecutions` channel for complete field definitions.

</details>

#### `/v2/wallet/{address}/spotExecutions`
**Purpose**: Real-time spot execution updates for a wallet

**Parameters**:
- `address`: Ethereum wallet address

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/wallet/0x6c51275fd01d5dbd2da194e92f920f8598306df2/spotExecutions"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/wallet/0x6c51275fd01d5dbd2da194e92f920f8598306df2/spotExecutions",
  "data": [
    {
      "exchangeId": 1,
      "symbol": "ETHRUSD",
      "accountId": 12345,
      "makerAccountId": 67890,
      "orderId": "63552420354981888",
      "makerOrderId": "63552420037263360",
      "qty": "1.0",
      "side": "B",
      "price": "2500.00",
      "fee": "0.0",
      "type": "ORDER_MATCH",
      "timestamp": 1747927089946
    }
  ]
}
```

<details>
<summary><strong>Data Type - SpotExecution</strong></summary>

Same as above - see `/v2/market/{symbol}/spotExecutions` channel for complete field definitions.

</details>

#### `/v2/wallet/{address}/accountBalances`
**Purpose**: Real-time account balance updates for a wallet

**Parameters**:
- `address`: Ethereum wallet address

**Subscription**:
```json
{
  "type": "subscribe",
  "channel": "/v2/wallet/0x6c51275fd01d5dbd2da194e92f920f8598306df2/accountBalances"
}
```

**Message Structure**:
```json
{
  "type": "channel_data",
  "timestamp": 1747927089946,
  "channel": "/v2/wallet/0x6c51275fd01d5dbd2da194e92f920f8598306df2/accountBalances",
  "data": [
    {
      "accountId": 12345,
      "asset": "WSTETH",
      "realBalance": "1.25",
      "balanceDEPRECATED": "1.25"
    }
  ]
}
```

<details>
<summary><strong>Data Type - AccountBalance</strong></summary>

- `accountId` (integer): Account identifier
- `asset` (string): Asset symbol (e.g., WSTETH, RUSD)
- `realBalance` (string): Sum of account net deposits and realized PnL from closed positions
- `balanceDEPRECATED` (string): Sum of account net deposits only (deprecated, will be removed)

</details>

## Data Types & Schemas

### Enumeration Types

<details>
<summary><strong>Side</strong> - Order/position side indicator</summary>

- `B`: Buy/Bid
- `A`: Ask/Sell

</details>

<details>
<summary><strong>ExecutionType</strong> - Type of execution that occurred</summary>

- `ORDER_MATCH`: Regular order matching
- `LIQUIDATION`: Liquidation execution
- `ADL`: Auto-deleveraging execution

</details>

<details>
<summary><strong>OrderStatus</strong> - Current status of an order</summary>

- `OPEN`: Order is active and can be filled
- `FILLED`: Order has been completely filled
- `CANCELLED`: Order has been cancelled
- `REJECTED`: Order was rejected

</details>

<details>
<summary><strong>OrderType</strong> - Type of order placed</summary>

- `LIMIT`: Limit order
- `TP`: Take profit order
- `SL`: Stop loss order

</details>

<details>
<summary><strong>TimeInForce</strong> - Order duration specification</summary>

- `IOC`: Immediate or Cancel
- `GTC`: Good Till Cancel

</details>

<details>
<summary><strong>DepthType</strong> - Order book depth message type</summary>

- `SNAPSHOT`: Full order book snapshot
- `UPDATE`: Single level change update

</details>

<details>
<summary><strong>AccountType</strong> - Account type classification</summary>

- `MAINPERP`: Main perpetual trading account
- `SUBPERP`: Sub perpetual trading account
- `SPOT`: Spot trading only account

</details>

## Connection Management

### Heartbeat Management
The API implements a ping/pong heartbeat mechanism:

1. **Server Ping**: Server sends periodic ping messages
2. **Client Pong**: Client must respond with pong messages
3. **Connection Health**: Failure to respond may result in disconnection

### Connection Best Practices

1. **Implement Reconnection Logic**: Handle connection drops gracefully
2. **Manage Subscriptions**: Track active subscriptions for reconnection
3. **Handle Backpressure**: Process messages efficiently to avoid buffer overflow
4. **Monitor Latency**: Track message timestamps for performance monitoring
5. **Validate Messages**: Verify message structure and required fields

### Control Messages

#### Subscribe Message (Client → Server)
```json
{
  "type": "subscribe",
  "channel": "/v2/markets/summary",
  "id": "req123"
}
```

#### Subscribed Confirmation (Server → Client)
```json
{
  "type": "subscribed",
  "channel": "/v2/markets/summary",
  "contents": { /* optional initial data */ }
}
```

#### Unsubscribe Message (Client → Server)
```json
{
  "type": "unsubscribe",
  "channel": "/v2/markets/summary",
  "id": "req123"
}
```

#### Unsubscribed Confirmation (Server → Client)
```json
{
  "type": "unsubscribed",
  "channel": "/v2/markets/summary"
}
```

#### Error Message (Server → Client)
```json
{
  "type": "error",
  "message": "Invalid channel",
  "channel": "/v2/invalid/channel"
}
```
