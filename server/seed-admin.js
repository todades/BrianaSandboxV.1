import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from './lib/db.js';

async function seedAdmin() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@briana.com').toLowerCase();
  const adminName = process.env.ADMIN_NAME || 'Administrador BRIANA';
  const adminCedula = process.env.ADMIN_CEDULA || '00000000';
  const adminPhone = process.env.ADMIN_PHONE || '00000000000';
  const adminPassword = process.env.ADMIN_PASSWORD || process.env.ADMIN_LOGIN_PASSWORD || 'briana-admin-2026';

  const existing = await db.prepare("SELECT id, email FROM users WHERE rol = 'administrador' LIMIT 1").get();
  if (existing) {
    console.log('Ya existe un administrador (' + existing.email + '). No se crea otro.');
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await db.prepare(
    "INSERT INTO users (nombre, email, telefono, cedula, password_hash, rol, is_active) VALUES (?, ?, ?, ?, ?, 'administrador', TRUE)"
  ).run(adminName, adminEmail, adminPhone, adminCedula, passwordHash);

  console.log('Administrador unico creado.');
  console.log('Email: ' + adminEmail);
  console.log('Contraseña: ' + adminPassword);
}

seedAdmin()
  .then(() => {
    console.log('Seed finalizado.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('ERROR en seed-admin:', err);
    process.exit(1);
  });