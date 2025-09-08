# Reya API Specifications

This repository contains the API specifications for Reya Network's trading endpoints.

## Contents

- **`openapi-trading-v2.yaml`** - OpenAPI 3.0 specification for Reya DEX trading v2 REST API endpoints
- **`asyncapi-trading-v2.yaml`** - AsyncAPI specification for Reya DEX trading v2 WebSocket streams
- **`trading-schemas.json`** - JSON schemas used both openapi and asyncapi specifications

## Usage

These specifications can be used to:
- Generate client SDKs in various programming languages
- Generate API documentation


## Related Resources

### SDKs
- [Reya Python SDK](https://github.com/Reya-Labs/reya-python-sdk) - Official Python SDK for interacting with Reya Network

### Documentation
- [Reya DEX REST API Documentation](https://docs.reya.xyz/technical-docs/reya-dex-rest-api) 
  <!-- TODO: Update this link to point to the new API documentation once available -->

## Development

It's recommended to include this repo as a git submodule in your project. As an example, see how it's done in the [Reya Python SDK](https://github.com/Reya-Labs/reya-python-sdk).

### Generating monolithic yaml specs:

In order to generate a single monolithic openapi or asyncapi yaml spec, run:
```
npx @redocly/cli bundle openapi-trading-v2.yaml -o openapi-trading-v2-bundled.yaml
npx @redocly/cli bundle asyncapi-trading-v2.yaml -o asyncapi-trading-v2-bundled.yaml
```


## License

This project is licensed under the MIT License - see the LICENSE file for details.