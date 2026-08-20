import assert from "node:assert/strict";
import { test } from "node:test";
import { autorizarHerramientas } from "./agente.js";
import { cargarConfig } from "./config.js";
import { construirConectores } from "./conectores/index.js";
import { buscarPlaybook, playbooks } from "./playbooks/index.js";

const entornoFalso = {
  ASANA_TOKEN: "x",
  JIRA_SITE: "demo",
  JIRA_EMAIL: "a@b.c",
  JIRA_TOKEN: "x",
} as NodeJS.ProcessEnv;

const conectores = construirConectores(cargarConfig(entornoFalso));
const herramientasEscritura = new Set(conectores.flatMap((c) => c.herramientasEscritura));

function deEscritura(herramientas: string[]): string[] {
  return herramientas.filter((h) => herramientasEscritura.has(h));
}

/**
 * La garantía central del proyecto: en simulación el agente no *puede* escribir,
 * no es que le pidamos que se abstenga. Si esta prueba se rompe, una corrida de
 * prueba puede modificar datos reales de la empresa.
 */
test("en simulación no se autoriza ninguna herramienta de escritura", () => {
  for (const playbook of playbooks) {
    const autorizadas = autorizarHerramientas(playbook, conectores, false);
    assert.deepEqual(
      deEscritura(autorizadas),
      [],
      `el playbook "${playbook.id}" filtró escritura en simulación`,
    );
  }
});

test("--aplicar sí autoriza escritura, pero sólo a los playbooks que escriben", () => {
  for (const playbook of playbooks) {
    const autorizadas = deEscritura(autorizarHerramientas(playbook, conectores, true));
    if (playbook.escribe) {
      assert.equal(
        autorizadas.length,
        herramientasEscritura.size,
        `el playbook "${playbook.id}" debería tener toda la escritura disponible`,
      );
    } else {
      assert.deepEqual(
        autorizadas,
        [],
        `el playbook de sólo lectura "${playbook.id}" no debe recibir escritura`,
      );
    }
  }
});

test("las herramientas nativas del playbook se autorizan en ambos modos", () => {
  const reporte = buscarPlaybook("reporte-semanal");
  assert.ok(reporte, "falta el playbook reporte-semanal");
  for (const aplicar of [false, true]) {
    assert.ok(
      autorizarHerramientas(reporte, conectores, aplicar).includes("Write"),
      `reporte-semanal necesita Write también con aplicar=${aplicar}`,
    );
  }
});

test("cada playbook tiene id único y descripción", () => {
  const ids = playbooks.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "hay ids de playbook repetidos");
  for (const p of playbooks) {
    assert.ok(p.descripcion.length > 20, `descripción demasiado corta en "${p.id}"`);
  }
});

test("los conectores separan lectura y escritura sin solaparse", () => {
  for (const conector of conectores) {
    const lectura = new Set(conector.herramientasLectura);
    const solapadas = conector.herramientasEscritura.filter((h) => lectura.has(h));
    assert.deepEqual(solapadas, [], `${conector.id} clasifica herramientas en los dos grupos`);
    assert.ok(conector.herramientasLectura.length > 0, `${conector.id} sin herramientas de lectura`);
  }
});
