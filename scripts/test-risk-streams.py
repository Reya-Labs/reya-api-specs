"""Validate actual snapshot/update envelopes, including legacy position clients."""
import copy
import json
from pathlib import Path
import unittest

from jsonschema import Draft7Validator, ValidationError
import yaml

ROOT = Path(__file__).resolve().parent.parent
SPEC = yaml.safe_load((ROOT / "asyncapi-trading-v2.yaml").read_text())
SHARED = json.loads((ROOT / "trading-schemas.json").read_text())


def schema_document(value):
    # Resolve the shared document locally and translate OpenAPI nullable to JSON
    # Schema for payload validation. No remote schema fetches are needed.
    if isinstance(value, list):
        return [schema_document(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: schema_document(item) for key, item in value.items()}
    if "$ref" in result:
        result["$ref"] = result["$ref"].replace("./trading-schemas.json#", "#")
    if result.pop("nullable", False) and "type" in result:
        result["type"] = [result["type"], "null"]
    return result


DOCUMENT = schema_document({"components": SPEC["components"], "definitions": SHARED["definitions"]})
ADDRESS = "0x" + "11" * 20
SUMMARY = dict(
    accountId=42, settlementAsset="RUSD", collateralValue="1000",
    unrealizedPnl="0", marginBalance="1000", initialMarginRequirement="0",
    liquidationMarginRequirement="0", freeCollateral="1000",
    initialMarginRatio="0", liquidationMarginRatio="0", updatedAt=1700000000000,
    pricesUpdatedAt=None,
)
POSITION = dict(
    exchangeId=2, accountId=42, symbol="BTCRUSDPERP", side="B", qty="1",
    avgEntryPrice="50000", avgEntryFundingValue="0", lastTradeSequenceNumber=5,
)


class RiskStreamsTest(unittest.TestCase):
    def validator(self, name):
        return Draft7Validator({**DOCUMENT, "$ref": f"#/components/schemas/{name}"})

    def update(self, name, rows, unavailable=None):
        result = dict(type="channel_data", timestamp=1700000000000,
                      channel=f"/v2/wallet/{ADDRESS}/{name}", data=rows)
        if unavailable is not None:
            result["unavailableAccountIds"] = unavailable
        return result

    def test_summary_initial_snapshot_and_partial_availability(self):
        self.validator("AccountSummarySubscribedPayload").validate(dict(
            type="subscribed", channel=f"/v2/wallet/{ADDRESS}/accountSummaries",
            contents=dict(data=[SUMMARY], unavailableAccountIds=[43]),
        ))
        self.validator("AccountSummaryUpdatePayload").validate(
            self.update("accountSummaries", [SUMMARY], [43]))

    def test_empty_replacement_and_recovery_are_valid(self):
        validator = self.validator("AccountSummaryUpdatePayload")
        for rows, unavailable in [([], []), ([], [42]), ([SUMMARY], [])]:
            with self.subTest(rows=rows, unavailable=unavailable):
                validator.validate(self.update("accountSummaries", rows, unavailable))

    def test_summary_availability_is_required_and_ids_are_unique_unsigned_integers(self):
        validator = self.validator("AccountSummaryUpdatePayload")
        for unavailable in [None, [42, 42], [-1], ["42"]]:
            with self.subTest(unavailable=unavailable), self.assertRaises(ValidationError):
                validator.validate(self.update("accountSummaries", [], unavailable))

    def test_legacy_base_positions_and_zero_quantity_closures_remain_valid(self):
        validator = self.validator("PositionUpdatePayload")
        validator.validate(self.update("positions", [POSITION]))
        validator.validate(self.update("positions", [{**POSITION, "qty": "0"}], [42]))
        self.validator("PositionSubscribedPayload").validate(dict(
            type="subscribed", channel=f"/v2/wallet/{ADDRESS}/positions",
            contents=dict(data=[POSITION]),
        ))

    def test_enriched_position_and_account_wide_invalidation(self):
        position = {**POSITION, "markPrice": "51000", "notional": "51000",
                    "unrealizedPnl": "1000", "liquidationMarginRequirement": "2550",
                    "liquidationPrice": None, "hasCorrelatedCollateral": False,
                    "updatedAt": 1700000000000, "pricesUpdatedAt": 1699999999000}
        self.validator("PositionUpdatePayload").validate(self.update("positions", [position], []))
        self.validator("PositionUpdatePayload").validate(self.update("positions", [], [42]))

    def test_incomplete_summary_and_wrong_channel_are_rejected(self):
        incomplete = copy.deepcopy(SUMMARY)
        del incomplete["marginBalance"]
        validator = self.validator("AccountSummaryUpdatePayload")
        for payload in [self.update("accountSummaries", [incomplete], []),
                        self.update("positions", [SUMMARY], [])]:
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                validator.validate(payload)


if __name__ == "__main__":
    unittest.main()
