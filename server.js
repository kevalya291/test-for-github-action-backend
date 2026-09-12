import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { categories } from "./data/products.js";
import { db, catalog, persist } from "./store.js";

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "quickkart-dev-secret";

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] }));
app.use(express.json());

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Please login to continue" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Session expired. Please login again." });
  }
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, address: u.address };
}

function productWithDeal(p) {
  const discount = p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
  return {
    ...p,
    discount,
    express: p.express !== false && p.deliveryMins <= 15,
  };
}

function sendCart(req, res) {
  const items = hydrateCart(req.user.id);
  const itemCount = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const delivery = subtotal === 0 || subtotal >= 199 ? 0 : 25;
  res.json({ items, itemCount, subtotal, delivery, total: subtotal + delivery });
}

function hydrateCart(userId) {
  const items = db.carts[userId] || [];
  return items
    .map((item) => {
      const product = catalog.find((p) => p.id === item.productId);
      if (!product) return null;
      const p = productWithDeal(product);
      return { ...item, product: p, lineTotal: p.price * item.qty };
    })
    .filter(Boolean);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "QuickKart API" });
});

app.get("/api/categories", (_req, res) => {
  res.json(categories);
});

app.get("/api/products", (req, res) => {
  const { q, category, sort, min, max, express } = req.query;
  let list = catalog.map(productWithDeal);

  if (category && category !== "all") {
    list = list.filter((p) => p.category === category);
  }
  if (q) {
    const term = String(q).toLowerCase();
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.brand.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term)
    );
  }
  if (express === "true") list = list.filter((p) => p.express);
  if (min) list = list.filter((p) => p.price >= Number(min));
  if (max) list = list.filter((p) => p.price <= Number(max));

  if (sort === "price-asc") list.sort((a, b) => a.price - b.price);
  else if (sort === "price-desc") list.sort((a, b) => b.price - a.price);
  else if (sort === "rating") list.sort((a, b) => b.rating - a.rating);
  else if (sort === "discount") list.sort((a, b) => b.discount - a.discount);

  res.json(list);
});

app.get("/api/products/:id", (req, res) => {
  const product = catalog.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found" });
  const related = catalog
    .filter((p) => p.category === product.category && p.id !== product.id)
    .slice(0, 6)
    .map(productWithDeal);
  res.json({ product: productWithDeal(product), related });
});

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email and password are required" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }
  if (db.users.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ message: "An account with this email already exists" });
  }
  const user = {
    id: uuid(),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    phone: phone ? String(phone) : "",
    passwordHash: await bcrypt.hash(String(password), 10),
    address: "",
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  db.carts[user.id] = [];
  persist();
  res.status(201).json({ token: sign(user), user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find((u) => u.email === String(email || "").trim().toLowerCase());
  if (!user || !(await bcrypt.compare(String(password || ""), user.passwordHash))) {
    return res.status(401).json({ message: "Invalid email or password" });
  }
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get("/api/auth/me", auth, (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  res.json({ user: publicUser(user) });
});

app.patch("/api/auth/me", auth, (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: "User not found" });
  const { name, phone, address } = req.body || {};
  if (name) user.name = String(name).trim();
  if (phone !== undefined) user.phone = String(phone);
  if (address !== undefined) user.address = String(address);
  persist();
  res.json({ user: publicUser(user) });
});

app.get("/api/cart", auth, sendCart);

app.post("/api/cart", auth, (req, res) => {
  const { productId, qty = 1 } = req.body || {};
  const product = catalog.find((p) => p.id === productId);
  if (!product) return res.status(404).json({ message: "Product not found" });
  if (!db.carts[req.user.id]) db.carts[req.user.id] = [];
  const cart = db.carts[req.user.id];
  const existing = cart.find((i) => i.productId === productId);
  const nextQty = (existing?.qty || 0) + Number(qty);
  if (nextQty > product.stock) return res.status(400).json({ message: "Not enough stock" });
  if (existing) existing.qty = nextQty;
  else cart.push({ productId, qty: Number(qty) });
  persist();
  sendCart(req, res);
});

app.patch("/api/cart/:productId", auth, (req, res) => {
  const qty = Number(req.body?.qty);
  const cart = db.carts[req.user.id] || [];
  const item = cart.find((i) => i.productId === req.params.productId);
  if (!item) return res.status(404).json({ message: "Item not in cart" });
  if (qty <= 0) {
    db.carts[req.user.id] = cart.filter((i) => i.productId !== req.params.productId);
  } else {
    const product = catalog.find((p) => p.id === req.params.productId);
    if (product && qty > product.stock) return res.status(400).json({ message: "Not enough stock" });
    item.qty = qty;
  }
  persist();
  sendCart(req, res);
});

app.delete("/api/cart/:productId", auth, (req, res) => {
  db.carts[req.user.id] = (db.carts[req.user.id] || []).filter(
    (i) => i.productId !== req.params.productId
  );
  persist();
  sendCart(req, res);
});

app.get("/api/orders", auth, (req, res) => {
  const orders = db.orders
    .filter((o) => o.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(orders);
});

app.post("/api/orders", auth, (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  const items = hydrateCart(req.user.id);
  if (!items.length) return res.status(400).json({ message: "Your cart is empty" });
  const { address, paymentMethod = "cod" } = req.body || {};
  const shipTo = String(address || user.address || "").trim();
  if (!shipTo) return res.status(400).json({ message: "Delivery address is required" });
  if (address) user.address = shipTo;
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const delivery = subtotal >= 199 ? 0 : 25;
  const etaMins = Math.min(...items.map((i) => i.product.deliveryMins));
  const order = {
    id: `QK${Date.now().toString().slice(-8)}`,
    userId: user.id,
    items: items.map((i) => ({
      productId: i.productId,
      name: i.product.name,
      image: i.product.image,
      qty: i.qty,
      price: i.product.price,
      unit: i.product.unit,
    })),
    address: shipTo,
    paymentMethod,
    subtotal,
    delivery,
    total: subtotal + delivery,
    status: "confirmed",
    etaMins,
    createdAt: new Date().toISOString(),
  };
  db.orders.unshift(order);
  db.carts[user.id] = [];
  persist();
  res.status(201).json(order);
});

app.listen(PORT, () => {
  console.log(`QuickKart API running on http://localhost:${PORT}`);
});
