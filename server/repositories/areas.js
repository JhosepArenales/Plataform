import { newId, now } from '../db.js';

// Lista controlada de áreas: evita variantes de texto libre ("Comercial" / "COMERCIAL")
// que después rompen filtros e indicadores.
export function createAreasRepo(db) {
  function list({ includeInactive = false } = {}) {
    return db.prepare(`SELECT a.*,
        (SELECT COUNT(*) FROM users u WHERE u.area_id = a.id AND u.active = 1) AS people,
        (SELECT COUNT(*) FROM course_areas ca JOIN courses c ON c.id = ca.course_id WHERE ca.area_id = a.id AND c.status = 'published') AS courses
      FROM areas a ${includeInactive ? '' : 'WHERE a.active = 1'} ORDER BY a.name COLLATE NOCASE`).all()
      .map((a) => ({ ...a, active: !!a.active }));
  }

  function byId(id) {
    return db.prepare('SELECT * FROM areas WHERE id = ?').get(id) ?? null;
  }

  function cleanName(name) {
    const n = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 40) throw Object.assign(new Error('El nombre del área debe tener entre 2 y 40 caracteres.'), { status: 400 });
    return n;
  }

  function assertUnique(name, exceptId = null) {
    const dup = db.prepare('SELECT id FROM areas WHERE name = ? COLLATE NOCASE AND id != ?').get(name, exceptId ?? '');
    if (dup) throw Object.assign(new Error(`Ya existe un área llamada "${name}".`), { status: 409 });
  }

  function create({ name, icon }) {
    const n = cleanName(name);
    assertUnique(n);
    const id = newId();
    db.prepare('INSERT INTO areas (id, name, icon, active, created_at) VALUES (?, ?, ?, 1, ?)').run(id, n, String(icon || '🏢').slice(0, 8), now());
    return byId(id);
  }

  function update(id, { name, icon, active }) {
    const current = byId(id);
    if (!current) throw Object.assign(new Error('Área no encontrada.'), { status: 404 });
    const n = name === undefined ? current.name : cleanName(name);
    assertUnique(n, id);
    db.prepare('UPDATE areas SET name = ?, icon = ?, active = ? WHERE id = ?')
      .run(n, icon === undefined ? current.icon : String(icon || '🏢').slice(0, 8), active === undefined ? current.active : (active ? 1 : 0), id);
    return byId(id);
  }

  function assertSelectable(id) {
    const a = byId(id);
    if (!a || !a.active) throw Object.assign(new Error('Elige un área válida.'), { status: 400 });
    return a;
  }

  return { list, byId, create, update, assertSelectable };
}
