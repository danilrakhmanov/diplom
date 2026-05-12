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
      const stockClass = product.stock <= 10 ? "stock-low" : "stock-ok";
      return `
        <tr>
          <td>
            <strong>${escapeHtml(product.name)}</strong>
            <div class="subtext">${escapeHtml(product.description || "Без описания")}</div>
          </td>
          <td><span class="category-pill">${escapeHtml(product.category)}</span></td>
          <td><span class="brand-pill">${escapeHtml(product.brand)}</span></td>
          <td>${currency.format(product.price)}</td>
          <td><span class="stock-badge ${stockClass}">${stockLabel(product.stock)}</span></td>
          <td><button class="add-button" data-add="${product.id}" title="Добавить в заказ">+</button></td>
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
        .map((order) => {
          const isClosed = ["Отменен", "Возврат"].includes(order.status);
          return `
            <article class="order-card">
              <div>
                <div class="order-title">
                  <strong>Заказ №${order.id}</strong>
                  <span class="status ${statusClass(order.status)}">${escapeHtml(order.status)}</span>
                </div>
                <div class="subtext">
                  ${escapeHtml(order.customer)} · ${new Date(order.created_at).toLocaleString("ru-RU")}
                </div>
                <div class="order-money">${currency.format(order.total)}</div>
              </div>
              <div class="order-actions">
                <button data-view-order="${order.id}">Просмотр</button>
                <button data-cancel-order="${order.id}" ${isClosed ? "disabled" : ""}>Отменить</button>
                <button data-return-order="${order.id}" ${isClosed ? "disabled" : ""}>Возврат</button>
                <button class="danger-button" data-delete-order="${order.id}">Удалить</button>
              </div>
            </article>`;
        })
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
  const cartCount = entries.reduce((sum, [, quantity]) => sum + quantity, 0);
  $("#cartCount").textContent = cartCount;
  $("#cartCount").classList.toggle("active", cartCount > 0);
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

function statusClass(status) {
  if (status === "Отменен") return "status-cancelled";
  if (status === "Возврат") return "status-returned";
  return "status-active";
}

async function openOrder(orderId) {
  const details = await api(`/api/orders/${orderId}`);
  const order = details.order;
  $("#orderDialogTitle").textContent = `Заказ №${order.id}`;
  $("#orderDetails").innerHTML = `
    <div class="order-detail-head">
      <div>
        <span class="subtext">Покупатель</span>
        <strong>${escapeHtml(order.customer)}</strong>
        <div class="subtext">${escapeHtml(order.customer_phone)}</div>
      </div>
      <span class="status ${statusClass(order.status)}">${escapeHtml(order.status)}</span>
    </div>
    <div class="detail-grid">
      <div><span>Дата</span><strong>${new Date(order.created_at).toLocaleString("ru-RU")}</strong></div>
      <div><span>Сумма товаров</span><strong>${currency.format(order.subtotal)}</strong></div>
      <div><span>Скидка</span><strong>${currency.format(order.discount)}</strong></div>
      <div><span>Итого</span><strong>${currency.format(order.total)}</strong></div>
      <div><span>Списано бонусов</span><strong>${order.bonus_spent}</strong></div>
      <div><span>Начислено бонусов</span><strong>${order.bonus_added}</strong></div>
    </div>
    <div class="order-items">
      ${details.items
        .map(
          (item) => `
            <div class="order-item">
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <div class="subtext">${escapeHtml(item.category)} · ${escapeHtml(item.brand)}</div>
              </div>
              <div>${item.quantity} × ${currency.format(item.price)}</div>
              <strong>${currency.format(item.line_total)}</strong>
            </div>`,
        )
        .join("")}
    </div>
  `;
  $("#orderDialog").showModal();
}

async function closeOrder(orderId, action) {
  const text = action === "cancel" ? "отменить заказ" : "оформить возврат";
  if (!confirm(`Вы действительно хотите ${text} №${orderId}? Товары вернутся на склад.`)) return;
  const path = action === "cancel" ? "cancel" : "return";
  await api(`/api/orders/${orderId}/${path}`, { method: "POST" });
  await refreshAll();
  showToast(action === "cancel" ? "Заказ отменен" : "Возврат оформлен");
}

async function deleteOrder(orderId) {
  if (!confirm(`Удалить заказ №${orderId}? Если заказ активен, товары вернутся на склад.`)) return;
  await api(`/api/orders/${orderId}`, { method: "DELETE" });
  await refreshAll();
  showToast("Заказ удален");
}

function stockLabel(stock) {
  if (stock <= 0) return "нет в наличии";
  if (stock <= 5) return `${stock} · критично`;
  if (stock <= 10) return `${stock} · мало`;
  return `${stock} · в наличии`;
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
      renderCart();
      showToast(`${product.name} добавлен в заказ`);
    }
  }

  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) {
    state.cart.delete(Number(removeButton.dataset.remove));
    renderCart();
  }

  const viewOrderButton = event.target.closest("[data-view-order]");
  if (viewOrderButton) {
    try {
      await openOrder(Number(viewOrderButton.dataset.viewOrder));
    } catch (error) {
      showToast(error.message, true);
    }
  }

  const cancelOrderButton = event.target.closest("[data-cancel-order]");
  if (cancelOrderButton && !cancelOrderButton.disabled) {
    try {
      await closeOrder(Number(cancelOrderButton.dataset.cancelOrder), "cancel");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  const returnOrderButton = event.target.closest("[data-return-order]");
  if (returnOrderButton && !returnOrderButton.disabled) {
    try {
      await closeOrder(Number(returnOrderButton.dataset.returnOrder), "return");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  const deleteOrderButton = event.target.closest("[data-delete-order]");
  if (deleteOrderButton) {
    try {
      await deleteOrder(Number(deleteOrderButton.dataset.deleteOrder));
    } catch (error) {
      showToast(error.message, true);
    }
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
$("#closeOrderDialog").addEventListener("click", () => $("#orderDialog").close());

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
    renderCart();
    await refreshAll();
    showToast(`Заказ №${result.id} оформлен, начислено ${result.bonus_added} бонусов`);
  } catch (error) {
    showToast(error.message, true);
  }
});

refreshAll().catch((error) => showToast(error.message, true));
