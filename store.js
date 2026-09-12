import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { products as seedProducts } from "./data/products.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data", "store.json");

const empty = () => ({
  users: [],
  carts: {},
  orders: [],
});

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch {
    /* start fresh */
  }
  return empty();
}

function save(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

export const db = load();
export const catalog = seedProducts;

export function persist() {
  save(db);
}
