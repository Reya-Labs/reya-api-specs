"""Exercise shared REST/WS schemas against real request payloads."""
import json
from pathlib import Path
import unittest

from jsonschema import Draft7Validator


SCHEMA = json.loads((Path(__file__).resolve().parent.parent / "trading-schemas.json").read_text())


class OrderRequestsTest(unittest.TestCase):
    def validator(self, operation):
        return Draft7Validator({**SCHEMA, "$ref": f"#/definitions/{operation}OrderRequest"})

    def payload(self, operation, order_type="STOP_LOSS", tif="GTC"):
        result = dict(
            exchangeId=1, symbol="ETHRUSDPERP", accountId=123,
            isBuy=False, limitPx="2490", orderType=order_type, timeInForce=tif,
            signature="0x" + "11" * 65, nonce="1",
            signerWallet="0x" + "11" * 20, deadline=1900000000,
        )
        if operation == "Modify":
            result["orderId"] = "123"
        if order_type == "LIMIT":
            result.update(qty="1", reduceOnly=False, postOnly=False)
        else:
            result["triggerPx"] = "2500"
        if tif == "GTT":
            result["expiresAfter"] = 1900000600
        return result

    def test_trigger_flags_must_be_absent(self):
        for operation in ("Create", "Modify"):
            validator = self.validator(operation)
            for order_type in ("STOP_LOSS", "TAKE_PROFIT"):
                for tif in ("IOC", "GTC", "GTT"):
                    payload = self.payload(operation, order_type, tif)
                    with self.subTest(operation=operation, order_type=order_type, tif=tif):
                        validator.validate(payload)
                        for field in ("reduceOnly", "postOnly"):
                            for value in (False, True, None, 0, "false"):
                                self.assertFalse(validator.is_valid({**payload, field: value}))
                        self.assertFalse(validator.is_valid({**payload, "reduceOnly": False, "postOnly": False}))

    def test_limit_modify_still_requires_both_booleans(self):
        validator = self.validator("Modify")
        payload = self.payload("Modify", "LIMIT")
        validator.validate(payload)
        for field in ("reduceOnly", "postOnly"):
            omitted = {key: value for key, value in payload.items() if key != field}
            self.assertFalse(validator.is_valid(omitted))
        validator.validate({**payload, "postOnly": True})

    def test_modify_variants_are_disjoint_and_preserve_common_requirements(self):
        Draft7Validator.check_schema(SCHEMA)
        variants = {
            name: Draft7Validator({**SCHEMA, "$ref": f"#/definitions/{name}"})
            for name in ("LimitModifyOrderRequest", "TriggerModifyOrderRequest")
        }
        validator = self.validator("Modify")
        for order_type in ("LIMIT", "STOP_LOSS", "TAKE_PROFIT"):
            payload = self.payload("Modify", order_type)
            expected = "LimitModifyOrderRequest" if order_type == "LIMIT" else "TriggerModifyOrderRequest"
            with self.subTest(order_type=order_type):
                self.assertEqual([name for name, v in variants.items() if v.is_valid(payload)], [expected])
                for field in ("exchangeId", "symbol", "accountId", "isBuy", "limitPx", "orderType", "timeInForce", "signature", "nonce", "signerWallet", "deadline"):
                    self.assertFalse(validator.is_valid({key: value for key, value in payload.items() if key != field}), field)
                no_target = {key: value for key, value in payload.items() if key != "orderId"}
                self.assertFalse(validator.is_valid(no_target))
                validator.validate({**no_target, "clientOrderId": "456"})
                # The existing API permits additional fields; the union must
                # not accidentally reject them while forbidding the flags.
                validator.validate({**payload, "futureField": "value"})
                self.assertFalse(validator.is_valid({**payload, "orderType": "UNKNOWN"}))


if __name__ == "__main__":
    unittest.main()
