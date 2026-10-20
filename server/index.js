import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const { app } = createApp();

app.listen(port, () => {
  console.log(`Academia Plataform lista en http://localhost:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('Aviso: sin ANTHROPIC_API_KEY la generación de cursos usa el modo básico (sin IA).');
});
