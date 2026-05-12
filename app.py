from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from contextlib import contextmanager
import json
import mimetypes
import sqlite3
import sys


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "sportstore.db"
STATIC_DIR = BASE_DIR / "static"


@contextmanager
def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db():
    with get_connection() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category_id INTEGER NOT NULL,
                brand TEXT NOT NULL,
                price REAL NOT NULL CHECK (price >= 0),
                stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
                description TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (category_id) REFERENCES categories(id)
            );

            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                bonus_points INTEGER NOT NULL DEFAULT 0 CHECK (bonus_points >= 0)
            );

            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                status TEXT NOT NULL DEFAULT 'Оформлен',
                subtotal REAL NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
                discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
                total REAL NOT NULL DEFAULT 0 CHECK (total >= 0),
                bonus_spent INTEGER NOT NULL DEFAULT 0 CHECK (bonus_spent >= 0),
                bonus_added INTEGER NOT NULL DEFAULT 0 CHECK (bonus_added >= 0),
                closed_at TEXT,
                FOREIGN KEY (customer_id) REFERENCES customers(id)
            );

            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                price REAL NOT NULL CHECK (price >= 0),
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                FOREIGN KEY (product_id) REFERENCES products(id)
            );
            """
        )

        migrate_db(db)

        if db.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
            seed_database(db)


def migrate_db(db):
    order_columns = {row["name"] for row in db.execute("PRAGMA table_info(orders)")}
    migrations = {
        "subtotal": "ALTER TABLE orders ADD COLUMN subtotal REAL NOT NULL DEFAULT 0 CHECK (subtotal >= 0)",
        "discount": "ALTER TABLE orders ADD COLUMN discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0)",
        "bonus_spent": "ALTER TABLE orders ADD COLUMN bonus_spent INTEGER NOT NULL DEFAULT 0 CHECK (bonus_spent >= 0)",
        "bonus_added": "ALTER TABLE orders ADD COLUMN bonus_added INTEGER NOT NULL DEFAULT 0 CHECK (bonus_added >= 0)",
        "closed_at": "ALTER TABLE orders ADD COLUMN closed_at TEXT",
    }
    for column, statement in migrations.items():
        if column not in order_columns:
            db.execute(statement)
    db.execute("UPDATE orders SET subtotal = total WHERE subtotal = 0 AND total > 0")
    db.execute("UPDATE orders SET status = 'Оформлен' WHERE status = 'Новый'")


def seed_database(db):
    categories = ["Футбол", "Фитнес", "Бег", "Зимний спорт", "Туризм"]
    db.executemany("INSERT INTO categories (name) VALUES (?)", [(name,) for name in categories])

    category_ids = {row["name"]: row["id"] for row in db.execute("SELECT id, name FROM categories")}
    products = [
        ("Футбольный мяч Strike Pro", "Футбол", "Nordway", 3490, 24, "Матчевый мяч для тренировок и игр."),
        ("Бутсы Velocity FG", "Футбол", "Atemi", 6290, 13, "Легкие бутсы для натурального газона."),
        ("Гантели неопреновые 2 кг", "Фитнес", "Torres", 1190, 38, "Пара гантелей для домашних тренировок."),
        ("Коврик для йоги Balance", "Фитнес", "Demix", 1790, 21, "Нескользящий коврик толщиной 6 мм."),
        ("Кроссовки RunFlex 5", "Бег", "Jogel", 5790, 17, "Амортизация для ежедневных пробежек."),
        ("Поясная сумка Runner", "Бег", "Kiprun", 990, 31, "Компактная сумка для телефона и ключей."),
        ("Лыжные палки Arctic", "Зимний спорт", "Fischer", 2890, 9, "Алюминиевые палки для прогулочного катания."),
        ("Термобелье BaseWarm", "Зимний спорт", "Glissade", 3990, 15, "Комплект для активного отдыха зимой."),
        ("Рюкзак Trail 35", "Туризм", "Outventure", 7490, 8, "Туристический рюкзак с анатомической спинкой."),
        ("Термос Steel 1 л", "Туризм", "Stanley", 3290, 19, "Стальной термос для походов и поездок."),
    ]
    db.executemany(
        """
        INSERT INTO products (name, category_id, brand, price, stock, description)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [(name, category_ids[category], brand, price, stock, description) for name, category, brand, price, stock, description in products],
    )

    customers = [
        ("Иван Петров", "+7 900 111-22-33", "petrov@example.com", 240),
        ("Мария Соколова", "+7 901 222-33-44", "sokolova@example.com", 510),
        ("Алексей Орлов", "+7 902 333-44-55", "orlov@example.com", 120),
    ]
    db.executemany(
        "INSERT INTO customers (full_name, phone, email, bonus_points) VALUES (?, ?, ?, ?)",
        customers,
    )


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def read_json(handler):
    length = int(handler.headers.get("Content-Length", 0))
    if length == 0:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    return json.loads(raw)


def product_list(query):
    search = query.get("search", [""])[0].strip()
    category = query.get("category", [""])[0].strip()
    params = []
    where = []

    if search:
        where.append("(p.name LIKE ? OR p.brand LIKE ? OR p.description LIKE ?)")
        params.extend([f"%{search}%"] * 3)
    if category:
        where.append("c.name = ?")
        params.append(category)

    sql = """
        SELECT p.id, p.name, p.brand, p.price, p.stock, p.description, c.name AS category
        FROM products p
        JOIN categories c ON c.id = p.category_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY p.name"

    with get_connection() as db:
        return rows_to_dicts(db.execute(sql, params))


def dashboard():
    with get_connection() as db:
        stats = dict(
            products=db.execute("SELECT COUNT(*) FROM products").fetchone()[0],
            customers=db.execute("SELECT COUNT(*) FROM customers").fetchone()[0],
            orders=db.execute("SELECT COUNT(*) FROM orders").fetchone()[0],
            revenue=db.execute(
                "SELECT COALESCE(SUM(total), 0) FROM orders WHERE status NOT IN ('Отменен', 'Возврат')"
            ).fetchone()[0],
            low_stock=db.execute("SELECT COUNT(*) FROM products WHERE stock <= 10").fetchone()[0],
        )
        top_products = rows_to_dicts(
            db.execute(
                """
                SELECT p.name, COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0) AS sold
                FROM products p
                LEFT JOIN order_items oi ON oi.product_id = p.id
                LEFT JOIN orders o ON o.id = oi.order_id AND o.status NOT IN ('Отменен', 'Возврат')
                GROUP BY p.id
                ORDER BY sold DESC, p.name
                LIMIT 5
                """
            )
        )
        low_stock = rows_to_dicts(
            db.execute(
                """
                SELECT p.id, p.name, p.stock, c.name AS category
                FROM products p
                JOIN categories c ON c.id = p.category_id
                WHERE p.stock <= 10
                ORDER BY p.stock ASC, p.name
                """
            )
        )
        return {"stats": stats, "top_products": top_products, "low_stock": low_stock}


def create_order(payload):
    customer_id = int(payload.get("customer_id", 0))
    items = payload.get("items", [])
    requested_bonus_spend = int(float(payload.get("bonus_to_spend", 0) or 0))
    if not customer_id or not items:
        raise ValueError("Не выбран покупатель или товары")
    if requested_bonus_spend < 0:
        raise ValueError("Количество бонусов для списания не может быть отрицательным")

    with get_connection() as db:
        customer = db.execute("SELECT id, bonus_points FROM customers WHERE id = ?", (customer_id,)).fetchone()
        if not customer:
            raise ValueError("Покупатель не найден")

        product_ids = [int(item["product_id"]) for item in items]
        placeholders = ",".join("?" for _ in product_ids)
        products = {
            row["id"]: dict(row)
            for row in db.execute(f"SELECT id, price, stock FROM products WHERE id IN ({placeholders})", product_ids)
        }

        normalized_items = []
        total = 0
        for item in items:
            product_id = int(item["product_id"])
            quantity = int(item["quantity"])
            product = products.get(product_id)
            if not product:
                raise ValueError("Один из товаров не найден")
            if quantity <= 0:
                raise ValueError("Количество должно быть больше нуля")
            if product["stock"] < quantity:
                raise ValueError("Недостаточно товара на складе")
            line_total = product["price"] * quantity
            total += line_total
            normalized_items.append((product_id, quantity, product["price"]))

        max_bonus_spend = int(total * 0.30)
        bonus_spent = min(requested_bonus_spend, customer["bonus_points"], max_bonus_spend)
        final_total = total - bonus_spent
        bonus_added = int(final_total * 0.05)

        cursor = db.execute(
            """
            INSERT INTO orders (customer_id, subtotal, discount, total, bonus_spent, bonus_added)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (customer_id, total, bonus_spent, final_total, bonus_spent, bonus_added),
        )
        order_id = cursor.lastrowid
        db.executemany(
            "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
            [(order_id, product_id, quantity, price) for product_id, quantity, price in normalized_items],
        )
        for product_id, quantity, _ in normalized_items:
            db.execute("UPDATE products SET stock = stock - ? WHERE id = ?", (quantity, product_id))
        db.execute(
            "UPDATE customers SET bonus_points = bonus_points - ? + ? WHERE id = ?",
            (bonus_spent, bonus_added, customer_id),
        )
        return {
            "id": order_id,
            "subtotal": total,
            "discount": bonus_spent,
            "total": final_total,
            "bonus_added": bonus_added,
        }


def get_order(order_id):
    with get_connection() as db:
        return get_order_from_db(db, order_id)


def get_order_from_db(db, order_id):
    order = db.execute(
        """
        SELECT o.id, o.created_at, o.closed_at, o.status, o.subtotal, o.discount, o.total,
               o.bonus_spent, o.bonus_added, c.full_name AS customer, c.phone AS customer_phone
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        WHERE o.id = ?
        """,
        (order_id,),
    ).fetchone()
    if not order:
        raise ValueError("Заказ не найден")
    items = rows_to_dicts(
        db.execute(
            """
            SELECT oi.product_id, p.name, p.brand, c.name AS category, oi.quantity, oi.price,
                   oi.quantity * oi.price AS line_total
            FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            JOIN categories c ON c.id = p.category_id
            WHERE oi.order_id = ?
            ORDER BY p.name
            """,
            (order_id,),
        )
    )
    return {"order": dict(order), "items": items}


def close_order(order_id, status):
    if status not in ("Отменен", "Возврат"):
        raise ValueError("Некорректный статус заказа")

    with get_connection() as db:
        order = db.execute(
            "SELECT id, customer_id, status, bonus_spent, bonus_added FROM orders WHERE id = ?",
            (order_id,),
        ).fetchone()
        if not order:
            raise ValueError("Заказ не найден")
        if order["status"] in ("Отменен", "Возврат"):
            raise ValueError("Заказ уже закрыт")

        items = rows_to_dicts(
            db.execute("SELECT product_id, quantity FROM order_items WHERE order_id = ?", (order_id,))
        )
        for item in items:
            db.execute(
                "UPDATE products SET stock = stock + ? WHERE id = ?",
                (item["quantity"], item["product_id"]),
            )
        db.execute(
            """
            UPDATE customers
            SET bonus_points = MAX(0, bonus_points + ? - ?)
            WHERE id = ?
            """,
            (order["bonus_spent"], order["bonus_added"], order["customer_id"]),
        )
        db.execute(
            "UPDATE orders SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, order_id),
        )
        return get_order_from_db(db, order_id)


def delete_order(order_id):
    with get_connection() as db:
        order = db.execute(
            "SELECT id, customer_id, status, bonus_spent, bonus_added FROM orders WHERE id = ?",
            (order_id,),
        ).fetchone()
        if not order:
            raise ValueError("Заказ не найден")

        if order["status"] not in ("Отменен", "Возврат"):
            items = rows_to_dicts(
                db.execute("SELECT product_id, quantity FROM order_items WHERE order_id = ?", (order_id,))
            )
            for item in items:
                db.execute(
                    "UPDATE products SET stock = stock + ? WHERE id = ?",
                    (item["quantity"], item["product_id"]),
                )
            db.execute(
                """
                UPDATE customers
                SET bonus_points = MAX(0, bonus_points + ? - ?)
                WHERE id = ?
                """,
                (order["bonus_spent"], order["bonus_added"], order["customer_id"]),
            )

        db.execute("DELETE FROM orders WHERE id = ?", (order_id,))
        return {"deleted": True, "id": order_id}


def create_product(payload):
    required = ["name", "category", "brand", "price", "stock"]
    if any(str(payload.get(field, "")).strip() == "" for field in required):
        raise ValueError("Заполните все обязательные поля товара")

    with get_connection() as db:
        category_name = payload["category"].strip()
        category = db.execute("SELECT id FROM categories WHERE name = ?", (category_name,)).fetchone()
        if category is None:
            cursor = db.execute("INSERT INTO categories (name) VALUES (?)", (category_name,))
            category_id = cursor.lastrowid
        else:
            category_id = category["id"]

        cursor = db.execute(
            """
            INSERT INTO products (name, category_id, brand, price, stock, description)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                payload["name"].strip(),
                category_id,
                payload["brand"].strip(),
                float(payload["price"]),
                int(payload["stock"]),
                payload.get("description", "").strip(),
            ),
        )
        return {"id": cursor.lastrowid}


def create_customer(payload):
    if not payload.get("full_name") or not payload.get("phone"):
        raise ValueError("Укажите имя и телефон покупателя")
    with get_connection() as db:
        cursor = db.execute(
            "INSERT INTO customers (full_name, phone, email) VALUES (?, ?, ?)",
            (payload["full_name"].strip(), payload["phone"].strip(), payload.get("email", "").strip()),
        )
        return {"id": cursor.lastrowid}


class SportStoreHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/dashboard":
                self.send_json(dashboard())
            elif parsed.path == "/api/products":
                self.send_json(product_list(parse_qs(parsed.query)))
            elif parsed.path == "/api/categories":
                with get_connection() as db:
                    self.send_json(rows_to_dicts(db.execute("SELECT id, name FROM categories ORDER BY name")))
            elif parsed.path == "/api/customers":
                with get_connection() as db:
                    self.send_json(rows_to_dicts(db.execute("SELECT * FROM customers ORDER BY full_name")))
            elif parsed.path == "/api/orders":
                with get_connection() as db:
                    self.send_json(
                        rows_to_dicts(
                            db.execute(
                                """
                                SELECT o.id, o.created_at, o.closed_at, o.status, o.subtotal, o.discount,
                                       o.total, o.bonus_spent, o.bonus_added, c.full_name AS customer
                                FROM orders o
                                JOIN customers c ON c.id = o.customer_id
                                ORDER BY o.id DESC
                                """
                            )
                        )
                    )
            elif parsed.path.startswith("/api/orders/"):
                order_id = self.extract_order_id(parsed.path)
                self.send_json(get_order(order_id))
            else:
                self.serve_static(parsed.path)
        except ValueError as error:
            self.send_error_json(str(error), 404)
        except Exception as error:
            self.send_error_json(str(error), 500)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = read_json(self)
            if parsed.path == "/api/orders":
                self.send_json(create_order(payload), 201)
            elif parsed.path.startswith("/api/orders/") and parsed.path.endswith("/cancel"):
                order_id = self.extract_order_id(parsed.path)
                self.send_json(close_order(order_id, "Отменен"))
            elif parsed.path.startswith("/api/orders/") and parsed.path.endswith("/return"):
                order_id = self.extract_order_id(parsed.path)
                self.send_json(close_order(order_id, "Возврат"))
            elif parsed.path == "/api/products":
                self.send_json(create_product(payload), 201)
            elif parsed.path == "/api/customers":
                self.send_json(create_customer(payload), 201)
            else:
                self.send_error_json("Маршрут не найден", 404)
        except ValueError as error:
            self.send_error_json(str(error), 400)
        except Exception as error:
            self.send_error_json(str(error), 500)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path.startswith("/api/orders/"):
                order_id = self.extract_order_id(parsed.path)
                self.send_json(delete_order(order_id))
            else:
                self.send_error_json("Маршрут не найден", 404)
        except ValueError as error:
            self.send_error_json(str(error), 400)
        except Exception as error:
            self.send_error_json(str(error), 500)

    def extract_order_id(self, path):
        parts = path.strip("/").split("/")
        if len(parts) < 3 or parts[0] != "api" or parts[1] != "orders":
            raise ValueError("Маршрут не найден")
        return int(parts[2])

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        target = (STATIC_DIR / path.lstrip("/")).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())) or not target.exists() or not target.is_file():
            self.send_error_json("Файл не найден", 404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        content = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, payload, status=200):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def send_error_json(self, message, status):
        self.send_json({"error": message}, status)

    def log_message(self, format, *args):
        sys.stdout.write("%s - %s\n" % (self.address_string(), format % args))


def main():
    init_db()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("127.0.0.1", port), SportStoreHandler)
    print(f"SportStore IS запущена: http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
