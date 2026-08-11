/**
 * Innlogging med e-post og passord for Jarvis-backend.
 * Passord hashes med scrypt (node:crypto), økter er tilfeldige bearer-tokens.
 * Første registrerte bruker blir admin. Deretter må admin invitere.
 */
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { doc, saveDoc } from "./store.mjs";

const SESSION_DAYS = Number(process.env.AGENT_SESSION_DAYS || 30);

const users = () => doc("users", { list: [] });
const sessions = () => doc("sessions", { list: [] });

const normEmail = (e) => String(e || "").trim().toLowerCase();

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(String(password), salt, 64);
  const known = Buffer.from(hash, "hex");
  return test.length === known.length && timingSafeEqual(test, known);
}

export const userCount = () => users().list.length;

export function createUser({ email, password, role }) {
  const db = users();
  const mail = normEmail(email);
  if (!mail.includes("@")) throw new Error("Ugyldig e-postadresse");
  if (String(password || "").length < 8) throw new Error("Passordet må ha minst 8 tegn");
  if (db.list.some((u) => u.email === mail)) throw new Error("E-postadressen er allerede registrert");
  const user = {
    id: randomUUID(),
    email: mail,
    role: role || (db.list.length === 0 ? "admin" : "bruker"),
    password: hashPassword(password),
    created: Date.now(),
  };
  db.list.push(user);
  saveDoc("users", db);
  return publicUser(user);
}

export const publicUser = (u) => ({ id: u.id, email: u.email, role: u.role, created: u.created });

export function login(email, password) {
  const db = users();
  const user = db.list.find((u) => u.email === normEmail(email));
  if (!user || !verifyPassword(password, user.password)) throw new Error("Feil e-post eller passord");
  const s = sessions();
  const token = randomBytes(32).toString("hex");
  s.list = s.list.filter((x) => x.expires > Date.now());
  s.list.push({ token, userId: user.id, expires: Date.now() + SESSION_DAYS * 86_400_000 });
  saveDoc("sessions", s);
  return { token, user: publicUser(user) };
}

export function logout(token) {
  const s = sessions();
  s.list = s.list.filter((x) => x.token !== token);
  saveDoc("sessions", s);
}

/** Slår opp bruker fra Authorization-headeren. Returnerer null hvis ugyldig. */
export function userFromRequest(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const s = sessions();
  const hit = s.list.find((x) => x.token === token && x.expires > Date.now());
  if (!hit) return null;
  const user = users().list.find((u) => u.id === hit.userId);
  return user ? { ...publicUser(user), token } : null;
}

export function listUsers() {
  return users().list.map(publicUser);
}

export function deleteUser(id) {
  const db = users();
  const before = db.list.length;
  db.list = db.list.filter((u) => u.id !== id);
  saveDoc("users", db);
  const s = sessions();
  s.list = s.list.filter((x) => x.userId !== id);
  saveDoc("sessions", s);
  return before !== db.list.length;
}

export function changePassword(id, password) {
  const db = users();
  const user = db.list.find((u) => u.id === id);
  if (!user) throw new Error("Fant ikke brukeren");
  if (String(password || "").length < 8) throw new Error("Passordet må ha minst 8 tegn");
  user.password = hashPassword(password);
  saveDoc("users", db);
  return true;
}
