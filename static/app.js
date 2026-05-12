const state = {
  products: [],
  customers: [],
  orders: [],
  categories: [],
  cart: new Map(),
};

const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Ошибка запроса");
  }
  return payload;
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.style.background = isError ? "var(--red)" : "var(--green)";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function setView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });
}

async function refreshAll() {
  const search = encodeURIComponent($("#productSearch")?.value || "");
  const category = encodeURIComponent($("#categoryFilter")?.value || "");
  const [dashboard, products, customers, orders, categories] = await Promise.all([
    api("/api/dashboard"),
    api(`/api/products?search=${search}&category=${category}`),
    api("/api/customers"),
    api("/api/orders"),
    api("/api/categories"),
  ]);

  state.products = products;
  state.customers = customers;
  state.orders = orders;
  state.categories = categories;

  renderDashboard(dashboard);
  renderCategories();
  renderProducts();
  renderCustomers();
  renderOrders();
  renderCart();
}

function renderDashboard(data) {
  $("#statProducts").textContent = data.stats.products;
  $("#statCustomers").textContent = data.stats.customers;
  $("#statOrders").textContent = data.stats.orders;
  $("#statRevenue").textContent = currency.format(data.stats.revenue);

  $("#topProducts").innerHTML = data.top_products.length
    ? data.top_products.map((item) => listItem(item.name, `${item.sold} продано`)).join("")
    : empty("Продажи пока не зарегистрированы");

  $("#lowStock").innerHTML = data.low_stock.length
    ? data.low_stock.map((item) => listItem(item.name, `${item.category}, остаток: ${item.stock}`)).join("")
    : empty("Критичных остатков нет");
}

function renderCategories() {
  const select = $("#categoryFilter");
  const current = select.value;
  select.innerHTML = `<option value="">Все категории</option>${state.categories
    .map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`)
    .join("")}`;
  select.value = current;

  $("#categoryOptions").innerHTML = state.categories
    .map((category) => `<option value="${escapeHtml(category.name)}"></option>`)
    .join("");
}

function renderProducts() {
  $("#productsTable").innerHTML = state.products
    .map((product) => {
      const stockClass = product.stock <= 10 ? "stock-low" : "";
      return `
        <tr>
          <td>
            <strong>${escapeHtml(product.name)}</strong>
            <div class="subtext">${escapeHtml(product.description || "Без описания")}</div>
          </td>
          <td>${escapeHtml(product.category)}</td>
          <td>${escapeHtml(product.brand)}</td>
          <td>${currency.format(product.price)}</td>
          <td class="${stockClass}">${product.stock}</td>
          <td><button data-add="${product.id}" title="Добавить в заказ">+</button></td>
        </tr>`;
    })
    .join("");
}

function renderCustomers() {
  const selectedCustomerId = $("#orderCustomer").value;
  $("#orderCustomer").innerHTML = state.customers
    .map(
      (customer) =>
        `<option value="${customer.id}">${escapeHtml(customer.full_name)} · ${customer.bonus_points} бонусов</option>`,
    )
    .join("");
  if (selectedCustomerId) {
    $("#orderCustomer").value = selectedCustomerId;
  }

  $("#customersList").innerHTML = state.customers.length
    ? state.customers
        .map((customer) =>
          listItem(
            customer.full_name,
            `${escapeHtml(customer.phone)} · ${escapeHtml(customer.email || "email не указан")} · ${customer.bonus_points} бонусов`,
          ),
        )
        .join("")
    : empty("Клиенты пока не добавлены");
}

function renderOrders() {
  $("#ordersList").innerHTML = state.orders.length
    ? state.orders
        .map((order) =>
          listItem(
            `Заказ №${order.id} · ${currency.format(order.total)}`,
            `${escapeHtml(order.customer)} · ${escapeHtml(order.status)} · ${new Date(order.created_at).toLocaleString("ru-RU")}`,
          ),
        )
        .join("")
    : empty("Заказов пока нет");
}

function renderCart() {
  const cart = $("#cart");
  const selectedCustomer = state.customers.find((customer) => customer.id === Number($("#orderCustomer").value));
  const entries = [...state.cart.entries()]
    .map(([id, quantity]) => [state.products.find((product) => product.id === id), quantity])
    .filter(([product]) => product);

  cart.innerHTML = entries.length
    ? entries
        .map(
          ([product, quantity]) => `
            <div class="cart-row">
              <div>
                <strong>${escapeHtml(product.name)}</strong>
                <div class="subtext">${currency.format(product.price)} · на складе ${product.stock}</div>
              </div>
              <input type="number" min="1" max="${product.stock}" value="${quantity}" data-quantity="${product.id}">
              <button class="icon-button" data-remove="${product.id}" title="Удалить" aria-label="Удалить">×</button>
            </div>`,
        )
        .join("")
    : empty("Добавьте товары из каталога");

  const subtotal = entries.reduce((sum, [product, quantity]) => sum + product.price * quantity, 0);
  const bonusInput = $("#bonusSpend");
  const availableBonus = selectedCustomer?.bonus_points || 0;
  const maxBonusSpend = Math.floor(subtotal * 0.3);
  const discount = Math.min(Number(bonusInput.value || 0), availableBonus, maxBonusSpend);
  bonusInput.max = Math.min(availableBonus, maxBonusSpend);
  if (Number(bonusInput.value || 0) !== discount) {
    bonusInput.value = discount;
  }

  const total = subtotal - discount;
  const bonusEarned = Math.floor(total * 0.05);
  $("#cartSubtotal").textContent = currency.format(subtotal);
  $("#cartDiscount").textContent = currency.format(discount);
  $("#cartBonusEarned").textContent = `${bonusEarned} бонусов`;
  $("#cartTotal").textContent = currency.format(total);
}

function listItem(title, meta) {
  return `
    <article class="list-item">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <div class="subtext">${meta}</div>
      </div>
    </article>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

document.addEventListener("click", async (event) => {
  const navButton = event.target.closest(".nav-button");
  if (navButton) setView(navButton.dataset.view);

  const addButton = event.target.closest("[data-add]");
  if (addButton) {
    const id = Number(addButton.dataset.add);
    const product = state.products.find((item) => item.id === id);
    if (product?.stock > 0) {
      state.cart.set(id, (state.cart.get(id) || 0) + 1);
      setView("orders");
      renderCart();
    }
  }

  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) {
    state.cart.delete(Number(removeButton.dataset.remove));
    renderCart();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-quantity]")) {
    state.cart.set(Number(event.target.dataset.quantity), Number(event.target.value));
    renderCart();
  }
  if (event.target.matches("#bonusSpend")) {
    renderCart();
  }
});

$("#orderCustomer").addEventListener("change", renderCart);

$("#refreshButton").addEventListener("click", () => refreshAll().then(() => showToast("Данные обновлены")));
$("#productSearch").addEventListener("input", () => refreshAll().catch((error) => showToast(error.message, true)));
$("#categoryFilter").addEventListener("change", () => refreshAll().catch((error) => showToast(error.message, true)));

$("#openProductForm").addEventListener("click", () => $("#productDialog").showModal());
$("#closeProductForm").addEventListener("click", () => $("#productDialog").close());

$("#productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/products", { method: "POST", body: JSON.stringify(formPayload(event.target)) });
    event.target.reset();
    $("#productDialog").close();
    await refreshAll();
    showToast("Товар добавлен");
  } catch (error) {
    showToast(error.message, true);
  }
});

$("#customerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/customers", { method: "POST", body: JSON.stringify(formPayload(event.target)) });
    event.target.reset();
    await refreshAll();
    showToast("Клиент добавлен");
  } catch (error) {
    showToast(error.message, true);
  }
});

$("#submitOrder").addEventListener("click", async () => {
  try {
    const items = [...state.cart.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
    const customerId = Number($("#orderCustomer").value);
    const bonusToSpend = Number($("#bonusSpend").value || 0);
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ customer_id: customerId, items, bonus_to_spend: bonusToSpend }),
    });
    state.cart.clear();
    $("#bonusSpend").value = 0;
    await refreshAll();
    showToast(`Заказ №${result.id} оформлен, начислено ${result.bonus_added} бонусов`);
  } catch (error) {
    showToast(error.message, true);
  }
});

refreshAll().catch((error) => showToast(error.message, true));
