/**
 * Carga .env por efecto lateral, antes que cualquier otro módulo.
 *
 * El SDK lee las credenciales del entorno del proceso y no abre archivos .env
 * por su cuenta. `process.loadEnvFile` es nativo desde Node 20.12, así que no
 * hace falta dependencia. Va en su propio módulo porque los imports de ESM se
 * evalúan en orden: importar esto primero garantiza que las variables existen
 * antes de que se inicialice el resto.
 */
try {
  process.loadEnvFile();
} catch {
  // Sin .env no pasa nada: las variables pueden venir del entorno o de la CI.
}
