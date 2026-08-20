/**
 * Configuración del agente. Todo viene de variables de entorno; no hay
 * secretos en el repositorio. Los conectores se activan solos cuando
 * encuentran sus credenciales, de modo que la empresa puede empezar con
 * Asana, con Jira, o con los dos.
 */

export type ConectorId = "asana" | "jira";

export interface ConfigAsana {
  token: string;
  workspaceGid?: string;
}

export interface ConfigJira {
  /** Subdominio: "miempresa" para https://miempresa.atlassian.net */
  site: string;
  email: string;
  token: string;
}

export interface Config {
  modelo: string;
  asana?: ConfigAsana;
  jira?: ConfigJira;
  /** Conectores con credenciales completas, en orden estable. */
  conectoresActivos: ConectorId[];
}

function limpiar(valor: string | undefined): string | undefined {
  const v = valor?.trim();
  return v ? v : undefined;
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const asanaToken = limpiar(env.ASANA_TOKEN);
  const asana: ConfigAsana | undefined = asanaToken
    ? { token: asanaToken, workspaceGid: limpiar(env.ASANA_WORKSPACE_GID) }
    : undefined;

  const jiraSite = limpiar(env.JIRA_SITE);
  const jiraEmail = limpiar(env.JIRA_EMAIL);
  const jiraToken = limpiar(env.JIRA_TOKEN);
  const jira: ConfigJira | undefined =
    jiraSite && jiraEmail && jiraToken
      ? { site: jiraSite, email: jiraEmail, token: jiraToken }
      : undefined;

  const conectoresActivos: ConectorId[] = [];
  if (asana) conectoresActivos.push("asana");
  if (jira) conectoresActivos.push("jira");

  return {
    modelo: limpiar(env.AGENTE_MODELO) ?? "claude-opus-5",
    asana,
    jira,
    conectoresActivos,
  };
}

/**
 * Credenciales de Jira parcialmente puestas: es un error de configuración
 * silencioso muy fácil de cometer, así que lo reportamos en `doctor`.
 */
export function jiraIncompleto(env: NodeJS.ProcessEnv = process.env): boolean {
  const partes = [env.JIRA_SITE, env.JIRA_EMAIL, env.JIRA_TOKEN].map((v) =>
    Boolean(limpiar(v)),
  );
  return partes.some(Boolean) && !partes.every(Boolean);
}

export function claveApiPresente(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(limpiar(env.ANTHROPIC_API_KEY) ?? limpiar(env.ANTHROPIC_AUTH_TOKEN));
}
