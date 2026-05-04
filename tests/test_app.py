import tempfile
import unittest
from pathlib import Path

import app


class SportStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = app.DB_PATH
        app.DB_PATH = Path(self.temp_dir.name) / "test.db"
        app.init_db()

    def tearDown(self):
        app.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_create_order_reduces_stock_and_adds_bonus_points(self):
        products = app.product_list({})
        product = products[0]
        with app.get_connection() as db:
            customer = db.execute("SELECT * FROM customers LIMIT 1").fetchone()

        result = app.create_order(
            {
                "customer_id": customer["id"],
                "items": [{"product_id": product["id"], "quantity": 2}],
            }
        )

        with app.get_connection() as db:
            updated_product = db.execute("SELECT stock FROM products WHERE id = ?", (product["id"],)).fetchone()
            updated_customer = db.execute("SELECT bonus_points FROM customers WHERE id = ?", (customer["id"],)).fetchone()

        self.assertGreater(result["total"], 0)
        self.assertEqual(updated_product["stock"], product["stock"] - 2)
        self.assertEqual(updated_customer["bonus_points"], customer["bonus_points"] + result["bonus_added"])

    def test_create_order_blocks_when_stock_is_not_enough(self):
        product = app.product_list({})[0]
        with app.get_connection() as db:
            customer = db.execute("SELECT * FROM customers LIMIT 1").fetchone()

        with self.assertRaises(ValueError):
            app.create_order(
                {
                    "customer_id": customer["id"],
                    "items": [{"product_id": product["id"], "quantity": product["stock"] + 1}],
                }
            )


if __name__ == "__main__":
    unittest.main()
