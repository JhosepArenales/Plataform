// Mini-ejecutor de flujos n8n para tests: recorre el JSON real del flujo (conexiones, IF, Code, HTTP, Respond).
// No reemplaza una prueba en n8n, pero detecta errores de cableado, expresiones y lógica.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function evalExpr(v, ctx) {
  if (typeof v !== 'string' || v[0] !== '=') return v;
  const s = v.slice(1);
  const whole = s.match(/^\{\{([\s\S]*)\}\}$/);
  const run = (e) => new Function('$', '$json', 'return (' + e + ');')(ctx.$, ctx.$json);
  if (whole) return run(whole[1]);
  return s.replace(/\{\{([\s\S]*?)\}\}/g, (m, e) => String(run(e)));
}

async function runWorkflow(wf, { body, http, staticData = {}, helpersHttp }) {
  const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const out = {};
  const trace = [];
  const $ = (name) => {
    if (!out[name]) throw new Error('Nodo sin ejecutar referenciado: ' + name);
    return { first: () => out[name][0], all: () => out[name] };
  };
  let response = null;
  const queue = [['Webhook', null]];
  while (queue.length) {
    const [name, input] = queue.shift();
    const n = byName[name];
    if (!n) throw new Error('Conexión a nodo inexistente: ' + name);
    trace.push(name);
    let outputs; // array de salidas (cada una, lista de items)
    const first = input && input[0];
    const ctx = { $, $json: first ? first.json : {} };
    switch (n.type) {
      case 'n8n-nodes-base.webhook':
        outputs = [[{ json: { body, headers: {} } }]]; break;
      case 'n8n-nodes-base.code': {
        const $input = { first: () => input[0], all: () => input };
        // En n8n el código corre con this.helpers y $getWorkflowStaticData disponibles.
        const self = { helpers: { httpRequest: async (o) => {
          if (!helpersHttp) throw new Error('helpers.httpRequest no simulado');
          return helpersHttp(o);
        } } };
        const res = await new AsyncFunction('$', '$input', '$getWorkflowStaticData', n.parameters.jsCode).call(self, $, $input, () => staticData);
        outputs = [res]; break;
      }
      case 'n8n-nodes-base.if': {
        const c = n.parameters.conditions.conditions[0];
        outputs = evalExpr(c.leftValue, ctx) === true ? [input, []] : [[], input];
        break;
      }
      case 'n8n-nodes-base.httpRequest': {
        // Como en n8n: una petición por cada item de entrada.
        const items = [];
        for (const it of input) {
          const ictx = { $, $json: it.json };
          const url = evalExpr(n.parameters.url, ictx);
          const reqBody = JSON.parse(evalExpr(n.parameters.jsonBody, ictx));
          try {
            const r = await http({ node: name, url, body: reqBody, credential: Object.keys(n.credentials || {})[0] });
            (Array.isArray(r) ? r : [r]).forEach((j) => items.push({ json: j }));
          } catch (e) {
            if (n.onError !== 'continueRegularOutput') throw e;
            items.push({ json: { error: { message: e.message, httpCode: e.status } } });
          }
        }
        outputs = [items]; break;
      }
      case 'n8n-nodes-base.respondToWebhook':
        response = JSON.parse(evalExpr(n.parameters.responseBody, ctx));
        outputs = []; break;
      default: throw new Error('Tipo de nodo no soportado en el simulador: ' + n.type);
    }
    out[name] = n.type === 'n8n-nodes-base.if' ? input : (outputs[0] || []);
    const conns = (wf.connections[name] || { main: [] }).main;
    outputs.forEach((items, i) => {
      if (!items || !items.length) return;
      (conns[i] || []).forEach((c) => queue.push([c.node, items]));
    });
  }
  return { response, trace };
}

module.exports = { runWorkflow, evalExpr };
